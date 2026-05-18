import unittest
from unittest import mock

from services.register import openai_register


class FakeResponse:
    def __init__(self, *, url="", status_code=200, headers=None, history=None, json_data=None, text=""):
        self.url = url
        self.status_code = status_code
        self.headers = headers or {}
        self.history = history or []
        self._json_data = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json_data


class FakeSession:
    def __init__(self, authorize_response):
        self.authorize_response = authorize_response
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append((method.upper(), url, kwargs))
        if "/api/accounts/authorize" in url:
            return self.authorize_response
        if "/api/accounts/password/verify" in url:
            raise AssertionError("password verify should not be called when authorize already returned OAuth code")
        raise AssertionError(f"unexpected request {method} {url}")


class OpenAIRegisterLoginFlowTests(unittest.TestCase):
    def test_extract_oauth_callback_params_from_response_uses_redirect_history_location(self):
        response = FakeResponse(
            url="https://auth.openai.com/authorize/done",
            history=[
                FakeResponse(headers={"Location": "https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid"}),
            ],
        )

        params = openai_register.extract_oauth_callback_params_from_response(response)

        self.assertEqual(params, {"code": "abc123", "state": "st", "scope": "openid"})

    def test_login_exchange_uses_authorize_callback_without_password_verify(self):
        response = FakeResponse(url="https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid")
        session = FakeSession(response)
        registrar = openai_register.PlatformRegistrar.__new__(openai_register.PlatformRegistrar)
        registrar.session = session
        registrar.device_id = "device-1"
        expected_tokens = {"access_token": "access", "refresh_token": "refresh", "id_token": "id"}

        with (
            mock.patch.object(openai_register, "exchange_oauth_callback_params", return_value=expected_tokens, create=True) as exchange,
            mock.patch.object(openai_register, "build_sentinel_token", return_value="sentinel"),
            mock.patch.object(openai_register, "step"),
        ):
            tokens = registrar._login_and_exchange_tokens("user@example.com", "Password1!", {}, 1)

        self.assertEqual(tokens, expected_tokens)
        exchange.assert_called_once()
        self.assertFalse(any("/api/accounts/password/verify" in url for _, url, _ in session.calls))

    def test_login_authorize_does_not_follow_platform_callback_redirect(self):
        response = FakeResponse(headers={"Location": "https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid"}, status_code=302)
        session = FakeSession(response)
        registrar = openai_register.PlatformRegistrar.__new__(openai_register.PlatformRegistrar)
        registrar.session = session
        registrar.device_id = "device-1"
        expected_tokens = {"access_token": "access", "refresh_token": "refresh", "id_token": "id"}

        with (
            mock.patch.object(openai_register, "exchange_oauth_callback_params", return_value=expected_tokens, create=True),
            mock.patch.object(openai_register, "build_sentinel_token", return_value="sentinel"),
            mock.patch.object(openai_register, "step"),
        ):
            tokens = registrar._login_and_exchange_tokens("user@example.com", "Password1!", {}, 1)

        self.assertEqual(tokens, expected_tokens)
        authorize_calls = [call for call in session.calls if "/api/accounts/authorize" in call[1]]
        self.assertEqual(len(authorize_calls), 1)
        self.assertFalse(authorize_calls[0][2]["allow_redirects"])

    def test_platform_authorize_does_not_follow_platform_callback_redirect(self):
        response = FakeResponse(headers={"Location": "https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid"}, status_code=302)
        session = FakeSession(response)
        session.cookies = mock.Mock()
        registrar = openai_register.PlatformRegistrar.__new__(openai_register.PlatformRegistrar)
        registrar.session = session
        registrar.device_id = "device-1"

        with mock.patch.object(openai_register, "step"):
            registrar._platform_authorize("user@example.com", 1)

        authorize_calls = [call for call in session.calls if "/api/accounts/authorize" in call[1]]
        self.assertEqual(len(authorize_calls), 1)
        self.assertFalse(authorize_calls[0][2]["allow_redirects"])

    def test_consent_session_returns_callback_url_without_fetching_platform(self):
        class NoNetworkSession:
            def get(self, *args, **kwargs):
                raise AssertionError("callback URL should be parsed, not fetched")

        params = openai_register.extract_oauth_callback_params_from_consent_session(
            NoNetworkSession(),
            "https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid",
            "device-1",
        )

        self.assertEqual(params, {"code": "abc123", "state": "st", "scope": "openid"})

    def test_consent_session_retries_transient_navigation_failure(self):
        class ConsentSession:
            def __init__(self):
                self.calls = 0

            def request(self, method, url, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise openai_register.requests.exceptions.ProxyError("proxy closed")
                return FakeResponse(
                    status_code=302,
                    headers={"Location": "https://platform.openai.com/auth/callback?code=abc123&state=st&scope=openid"},
                    url=url,
                )

        session = ConsentSession()

        with mock.patch.object(openai_register.time, "sleep"):
            params = openai_register.extract_oauth_callback_params_from_consent_session(session, "https://auth.openai.com/consent", "device-1")

        self.assertEqual(params, {"code": "abc123", "state": "st", "scope": "openid"})
        self.assertEqual(session.calls, 2)

    def test_exchange_oauth_callback_params_retries_transient_token_failure(self):
        class TokenSession:
            def __init__(self):
                self.calls = 0

            def request(self, method, url, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise openai_register.requests.exceptions.SSLError("unexpected eof")
                return FakeResponse(
                    status_code=200,
                    json_data={
                        "access_token": "header.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ.sig",
                        "refresh_token": "refresh",
                        "id_token": "header.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20ifQ.sig",
                    },
                )

            def close(self):
                pass

        session = TokenSession()

        with (
            mock.patch.object(openai_register, "create_session", return_value=session),
            mock.patch.object(openai_register.time, "sleep"),
        ):
            tokens = openai_register.exchange_oauth_callback_params("verifier", {"code": "abc123"})

        self.assertEqual(tokens["email"], "user@example.com")
        self.assertEqual(session.calls, 2)

    def test_request_with_local_retry_retries_transient_http_status(self):
        class RetrySession:
            def __init__(self):
                self.calls = 0

            def request(self, method, url, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    return FakeResponse(status_code=502, text="bad gateway")
                return FakeResponse(status_code=200)

        session = RetrySession()

        with mock.patch.object(openai_register.time, "sleep"):
            resp, error = openai_register.request_with_local_retry(session, "get", "https://auth.openai.com/x", retry_statuses=(502,))

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(error, "")
        self.assertEqual(session.calls, 2)

    def test_build_sentinel_token_retries_transient_ssl_failure(self):
        class SentinelResponse:
            status_code = 200

            def json(self):
                return {"token": "sentinel-token", "proofofwork": {"required": False}}

        class SentinelSession:
            def __init__(self):
                self.calls = 0

            def post(self, *args, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise openai_register.requests.exceptions.SSLError("unexpected eof")
                return SentinelResponse()

        session = SentinelSession()

        with mock.patch.object(openai_register.SentinelTokenGenerator, "generate_requirements_token", return_value="req-token"):
            token = openai_register.build_sentinel_token(session, "device-1", "password_verify")

        self.assertIn("sentinel-token", token)
        self.assertEqual(session.calls, 2)

    def test_registered_account_uploads_to_cpa_after_refresh_success(self):
        with (
            mock.patch.object(
                openai_register.account_service,
                "get_account",
                return_value={"access_token": "access", "email": "stored@example.com", "type": "free"},
            ),
            mock.patch.object(
                openai_register,
                "upload_account_to_configured_pools",
                return_value={"configured": 1, "uploaded": 1, "items": [], "errors": []},
            ) as upload,
            mock.patch.object(openai_register, "step"),
        ):
            result = openai_register.upload_registered_account_to_cpa(
                "access",
                {"email": "new@example.com", "id_token": "id", "refresh_token": "refresh"},
                {"refreshed": 1, "errors": []},
                1,
            )

        self.assertEqual(result["uploaded"], 1)
        upload.assert_called_once()
        payload = upload.call_args.args[0]
        self.assertEqual(payload["access_token"], "access")
        self.assertEqual(payload["email"], "new@example.com")
        self.assertEqual(payload["oauth_id_token"], "id")

    def test_registered_account_does_not_upload_to_cpa_when_refresh_failed(self):
        with (
            mock.patch.object(openai_register, "upload_account_to_configured_pools") as upload,
            mock.patch.object(openai_register, "step"),
        ):
            result = openai_register.upload_registered_account_to_cpa(
                "access",
                {"email": "new@example.com"},
                {"refreshed": 0, "errors": [{"error": "timeout"}]},
                1,
            )

        self.assertTrue(result["skipped"])
        upload.assert_not_called()

    def test_refresh_registered_account_logs_plain_account_type(self):
        with (
            mock.patch.object(openai_register.account_service, "refresh_accounts", return_value={"refreshed": 1, "errors": []}),
            mock.patch.object(openai_register.account_service, "get_account", return_value={"can_activate_plus": False}),
            mock.patch.object(openai_register, "step") as step,
        ):
            openai_register.refresh_registered_account("access", 1)

        self.assertTrue(any("账号类型：普通号" in call.args[1] for call in step.call_args_list))

    def test_refresh_registered_account_logs_plus_eligible_account_type(self):
        with (
            mock.patch.object(openai_register.account_service, "refresh_accounts", return_value={"refreshed": 1, "errors": []}),
            mock.patch.object(openai_register.account_service, "get_account", return_value={"can_activate_plus": True}),
            mock.patch.object(openai_register, "step") as step,
        ):
            openai_register.refresh_registered_account("access", 1)

        self.assertTrue(any("账号类型：可开通 Plus" in call.args[1] for call in step.call_args_list))

    def test_log_registration_ip_outputs_ip_and_country(self):
        with (
            mock.patch.object(
                openai_register,
                "detect_outbound_ip",
                return_value={"ok": True, "ip": "52.68.61.169", "country_code": "JP", "region": "Tokyo", "city": "Tokyo"},
            ),
            mock.patch.object(openai_register, "step") as step,
        ):
            result = openai_register.log_registration_ip(1, "http://127.0.0.1:7890")

        self.assertTrue(result["ok"])
        self.assertTrue(any("注册出口 IP：52.68.61.169" in call.args[1] for call in step.call_args_list))
        self.assertEqual(step.call_args.args[2], "green")

    def test_worker_removes_registered_account_when_refresh_failed(self):
        registrar = mock.Mock()
        registrar.register.return_value = {
            "email": "new@example.com",
            "access_token": "access-token",
            "refresh_token": "refresh-token",
            "id_token": "id-token",
        }
        registrar.close.return_value = None

        with (
            mock.patch.object(openai_register, "PlatformRegistrar", return_value=registrar),
            mock.patch.object(openai_register, "_record_mail_success"),
            mock.patch.object(openai_register, "_record_mail_failure", return_value={}),
            mock.patch.object(openai_register.account_service, "add_accounts") as add_accounts,
            mock.patch.object(openai_register.account_service, "delete_accounts") as delete_accounts,
            mock.patch.object(openai_register, "refresh_registered_account", return_value={"refreshed": 0, "errors": [{"error": "timeout"}]}),
            mock.patch.object(openai_register, "upload_registered_account_to_cpa") as upload,
            mock.patch.object(openai_register, "log_registration_ip", return_value={"ok": True, "ip": "52.68.61.169", "country_code": "JP"}),
            mock.patch.object(openai_register, "step"),
        ):
            result = openai_register.worker(1)

        self.assertFalse(result["ok"])
        self.assertIn("刷新失败", result["error"])
        add_accounts.assert_called_once_with(["access-token"])
        delete_accounts.assert_called_once_with(["access-token"])
        upload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
