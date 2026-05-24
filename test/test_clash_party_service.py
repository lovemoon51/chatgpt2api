import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from services import clash_party_service
from services.register_service import RegisterService, _normalize


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, text=None):
        self.status_code = status_code
        self._json_data = json_data if json_data is not None else {}
        self.text = text if text is not None else "{}"

    def json(self):
        return self._json_data


class ClashPartyServiceTests(unittest.TestCase):
    def test_switch_to_japan_selects_matching_proxy_from_controller(self):
        calls = []

        def fake_request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if method == "GET":
                if url.endswith("/proxies/GLOBAL"):
                    return FakeResponse(json_data={"now": "JP Tokyo 01"})
                return FakeResponse(
                    json_data={
                        "proxies": {
                            "GLOBAL": {"type": "Selector", "all": ["DIRECT", "US 01", "JP Tokyo 01"]},
                            "JP Tokyo 01": {"type": "Shadowsocks"},
                        }
                    }
                )
            return FakeResponse(text="")

        with (
            mock.patch.object(clash_party_service, "discover_local_settings", return_value={}),
            mock.patch.object(clash_party_service.requests, "request", side_effect=fake_request),
        ):
            result = clash_party_service.switch_to_japan(
                {
                    "enabled": True,
                    "controller_url": "127.0.0.1:9090",
                    "secret": "secret-token",
                    "proxy": "http://127.0.0.1:7890",
                }
            )

        self.assertEqual(result["group"], "GLOBAL")
        self.assertEqual(result["proxy"], "JP Tokyo 01")
        self.assertEqual(result["active_proxy"], "JP Tokyo 01")
        self.assertEqual(calls[1][0], "PUT")
        self.assertEqual(calls[1][1], "http://127.0.0.1:9090/proxies/GLOBAL")
        self.assertEqual(calls[1][2]["json"], {"name": "JP Tokyo 01"})
        self.assertEqual(calls[0][2]["headers"]["Authorization"], "Bearer secret-token")

    def test_switch_to_japan_can_read_controller_from_local_config(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.yaml"
            config_path.write_text(
                "external-controller: :19090\nsecret: local-secret\nmixed-port: 17890\n",
                encoding="utf-8",
            )

            def fake_request(method, url, **kwargs):
                if method == "GET":
                    if url.endswith("/proxies/%E8%8A%82%E7%82%B9%E9%80%89%E6%8B%A9"):
                        return FakeResponse(json_data={"now": "日本 Osaka"})
                    return FakeResponse(
                        json_data={
                            "proxies": {
                                "节点选择": {"type": "Selector", "all": ["日本 Osaka"]},
                                "日本 Osaka": {"type": "Trojan"},
                            }
                        }
                    )
                return FakeResponse(text="")

            with (
                mock.patch.object(clash_party_service, "_candidate_config_paths", return_value=[config_path]),
                mock.patch.object(clash_party_service.requests, "request", side_effect=fake_request) as request,
            ):
                result = clash_party_service.switch_to_japan({"enabled": True, "controller_url": "", "proxy": ""})

        self.assertEqual(result["controller_url"], "http://127.0.0.1:19090")
        self.assertEqual(result["proxy_url"], "http://127.0.0.1:17890")
        self.assertEqual(request.call_args_list[0].kwargs["headers"]["Authorization"], "Bearer local-secret")

    def test_get_current_selection_reads_without_switching(self):
        calls = []

        def fake_request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if method == "GET" and url.endswith("/proxies/%E8%B5%94%E9%92%B1%E6%9C%BA%E5%9C%BA"):
                return FakeResponse(json_data={"now": "日本东京01"})
            return FakeResponse(json_data={"proxies": {}})

        with (
            mock.patch.object(clash_party_service, "discover_local_settings", return_value={}),
            mock.patch.object(clash_party_service.requests, "request", side_effect=fake_request),
        ):
            result = clash_party_service.get_current_selection(
                {
                    "enabled": True,
                    "controller_url": "127.0.0.1:9097",
                    "secret": "secret-token",
                    "group": "赔钱机场",
                    "proxy": "http://127.0.0.1:7890",
                }
            )

        self.assertEqual(result["group"], "赔钱机场")
        self.assertEqual(result["active_proxy"], "日本东京01")
        self.assertFalse(any(call[0] == "PUT" for call in calls))

    def test_list_proxy_groups_returns_nodes_for_dropdown(self):
        def fake_request(method, url, **kwargs):
            self.assertEqual(method, "GET")
            self.assertTrue(url.endswith("/proxies"))
            return FakeResponse(
                json_data={
                    "proxies": {
                        "赔钱机场": {"type": "Selector", "now": "日本东京01", "all": ["DIRECT", "日本东京01", "美国01"]},
                        "自动选择": {"type": "URLTest", "now": "日本东京01", "all": ["日本东京01", "美国01"]},
                        "日本东京01": {"type": "Trojan", "history": [{"delay": 128}]},
                        "美国01": {"type": "Shadowsocks"},
                    }
                }
            )

        with (
            mock.patch.object(clash_party_service, "discover_local_settings", return_value={}),
            mock.patch.object(clash_party_service.requests, "request", side_effect=fake_request),
        ):
            result = clash_party_service.list_proxy_groups(
                {
                    "enabled": True,
                    "controller_url": "127.0.0.1:9097",
                    "secret": "secret-token",
                    "group": "赔钱机场",
                    "proxy": "http://127.0.0.1:7890",
                }
            )

        self.assertEqual(result["group"], "赔钱机场")
        self.assertEqual(result["active_proxy"], "日本东京01")
        groups = {group["name"]: group for group in result["groups"]}
        self.assertIn("赔钱机场", groups)
        self.assertEqual(groups["赔钱机场"]["nodes"][1]["name"], "日本东京01")
        self.assertEqual(groups["赔钱机场"]["nodes"][1]["delay"], 128)

    def test_select_proxy_switches_requested_node(self):
        calls = []

        def fake_request(method, url, **kwargs):
            calls.append((method, url, kwargs))
            if method == "GET":
                if url.endswith("/proxies/%E8%B5%94%E9%92%B1%E6%9C%BA%E5%9C%BA"):
                    return FakeResponse(json_data={"now": "日本东京02"})
                return FakeResponse(
                    json_data={
                        "proxies": {
                            "赔钱机场": {"type": "Selector", "now": "日本东京01", "all": ["日本东京01", "日本东京02"]},
                            "日本东京01": {"type": "Trojan"},
                            "日本东京02": {"type": "Trojan"},
                        }
                    }
                )
            return FakeResponse(text="")

        with (
            mock.patch.object(clash_party_service, "discover_local_settings", return_value={}),
            mock.patch.object(clash_party_service.requests, "request", side_effect=fake_request),
        ):
            result = clash_party_service.select_proxy(
                {
                    "enabled": True,
                    "controller_url": "127.0.0.1:9097",
                    "secret": "secret-token",
                    "proxy": "http://127.0.0.1:7890",
                },
                "赔钱机场",
                "日本东京02",
            )

        self.assertEqual(result["group"], "赔钱机场")
        self.assertEqual(result["proxy"], "日本东京02")
        self.assertEqual(result["active_proxy"], "日本东京02")
        put_calls = [call for call in calls if call[0] == "PUT"]
        self.assertEqual(len(put_calls), 1)
        self.assertEqual(put_calls[0][1], "http://127.0.0.1:9097/proxies/%E8%B5%94%E9%92%B1%E6%9C%BA%E5%9C%BA")
        self.assertEqual(put_calls[0][2]["json"], {"name": "日本东京02"})

    def test_register_config_uses_clash_proxy_when_enabled(self):
        cfg = _normalize(
            {
                "proxy": "",
                "clash": {
                    "enabled": True,
                    "proxy": "http://127.0.0.1:7890",
                },
            }
        )

        self.assertEqual(cfg["proxy"], "http://127.0.0.1:7890")
        self.assertTrue(cfg["clash"]["enabled"])

    def test_register_available_mode_uses_total_account_cap(self):
        service = RegisterService.__new__(RegisterService)
        service._lock = threading.RLock()
        service._logs = []
        service._config = _normalize({"mode": "available", "target_available": 50})
        service._bump = mock.Mock()

        with (
            mock.patch("services.register_service.account_service.list_accounts", return_value=[{"status": "正常", "quota": 0}] * 50),
            mock.patch("services.register_service.account_service.available_account_count", return_value=0),
        ):
            self.assertTrue(service._target_reached({"mode": "available", "target_available": 50}, 0, pending=0))

        with (
            mock.patch("services.register_service.account_service.list_accounts", return_value=[{"status": "正常", "quota": 0}] * 48),
            mock.patch("services.register_service.account_service.available_account_count", return_value=0),
        ):
            self.assertFalse(service._target_reached({"mode": "available", "target_available": 50}, 36, pending=0))
            self.assertTrue(service._target_reached({"mode": "available", "target_available": 50}, 36, pending=2))

        with (
            mock.patch("services.register_service.account_service.list_accounts", return_value=[{"status": "正常", "quota": 0}] * 48),
            mock.patch("services.register_service.account_service.available_account_count", return_value=0),
        ):
            self.assertFalse(service._target_reached({"mode": "available", "target_available": 50}, 36, pending=1))

    def test_prepare_clash_route_reads_current_selection_and_logs(self):
        service = RegisterService.__new__(RegisterService)
        service._lock = threading.RLock()
        service._logs = []
        service._config = _normalize(
            {
                "proxy": "",
                "clash": {
                    "enabled": True,
                    "proxy": "http://127.0.0.1:7890",
                },
            }
        )

        with mock.patch(
            "services.register_service.get_current_selection",
            return_value={
                "group": "赔钱机场",
                "proxy": "日本东京01",
                "active_proxy": "日本东京01",
                "proxy_url": "http://127.0.0.1:7890",
            },
        ):
            ok = service._prepare_clash_route()

        self.assertTrue(ok)
        self.assertEqual(service._config["proxy"], "http://127.0.0.1:7890")
        self.assertIn("Clash 当前选择", service._logs[0]["text"])

    def test_prepare_clash_route_switches_selected_proxy_before_registering(self):
        service = RegisterService.__new__(RegisterService)
        service._lock = threading.RLock()
        service._logs = []
        service._config = _normalize(
            {
                "proxy": "",
                "clash": {
                    "enabled": True,
                    "group": "赔钱机场",
                    "selected_proxy": "日本东京02",
                    "proxy": "http://127.0.0.1:7890",
                },
            }
        )

        with mock.patch(
            "services.register_service.select_proxy",
            return_value={
                "group": "赔钱机场",
                "proxy": "日本东京02",
                "active_proxy": "日本东京02",
                "proxy_url": "http://127.0.0.1:7890",
            },
        ) as switch:
            ok = service._prepare_clash_route()

        self.assertTrue(ok)
        switch.assert_called_once()
        self.assertEqual(service._config["clash"]["selected_proxy"], "日本东京02")
        self.assertIn("Clash 已切换到页面选择", service._logs[0]["text"])

    def test_log_outbound_ip_marks_japan(self):
        service = RegisterService.__new__(RegisterService)
        service._lock = threading.RLock()
        service._logs = []
        service._config = {"proxy": "http://127.0.0.1:7890"}

        with mock.patch(
            "services.register_service.detect_outbound_ip",
            return_value={"ok": True, "ip": "203.0.113.10", "country_code": "JP", "country": "Japan", "region": "Tokyo", "city": "Tokyo"},
        ):
            service._log_outbound_ip()

        self.assertIn("当前注册出口已是日本 IP", service._logs[0]["text"])
        self.assertEqual(service._logs[0]["level"], "green")

    def test_prepare_clash_route_continues_when_controller_unavailable(self):
        service = RegisterService.__new__(RegisterService)
        service._lock = threading.RLock()
        service._logs = []
        service._config = _normalize(
            {
                "proxy": "",
                "clash": {
                    "enabled": True,
                    "proxy": "http://127.0.0.1:7890",
                },
            }
        )

        with mock.patch("services.register_service.get_current_selection", side_effect=clash_party_service.ClashPartyError("connection refused")):
            ok = service._prepare_clash_route()

        self.assertTrue(ok)
        self.assertTrue(any("Clash 节点准备失败" in item["text"] for item in service._logs))

    def test_detect_outbound_ip_uses_proxy(self):
        class IpResponse(FakeResponse):
            status_code = 200

        with mock.patch.object(
            clash_party_service.curl_requests,
            "get",
            return_value=IpResponse(json_data={"ip": "203.0.113.10", "country": "JP", "region": "Tokyo", "city": "Tokyo"}),
        ) as get:
            result = clash_party_service.detect_outbound_ip("http://127.0.0.1:7890")

        self.assertTrue(result["ok"])
        self.assertEqual(result["country_code"], "JP")
        self.assertEqual(get.call_args.kwargs["proxy"], "http://127.0.0.1:7890")


if __name__ == "__main__":
    unittest.main()
