from __future__ import annotations

import json
import unittest
from unittest import mock

from fastapi import HTTPException

import api.support as support_module
from services.usage_limit_service import UsageLimitError


class OpenAIErrorFormatTests(unittest.TestCase):
    def test_openai_error_response_uses_openai_shape(self) -> None:
        response = support_module.openai_error_response(
            "model is required",
            status_code=400,
            type="invalid_request_error",
            param="model",
            code="missing_required_parameter",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            json.loads(response.body),
            {
                "error": {
                    "message": "model is required",
                    "type": "invalid_request_error",
                    "param": "model",
                    "code": "missing_required_parameter",
                }
            },
        )

    def test_openai_http_exception_detail_uses_openai_shape(self) -> None:
        exc = support_module.openai_http_exception("not allowed", status_code=403, type="permission_error")

        self.assertIsInstance(exc, HTTPException)
        self.assertEqual(exc.status_code, 403)
        self.assertEqual(
            exc.detail,
            {
                "error": {
                    "message": "not allowed",
                    "type": "permission_error",
                    "param": None,
                    "code": None,
                }
            },
        )

    def test_openai_usage_limit_exception_uses_rate_limit_type(self) -> None:
        exc = support_module.openai_usage_limit_exception(UsageLimitError("request daily limit exceeded", status_code=429))

        self.assertEqual(exc.status_code, 429)
        self.assertEqual(
            exc.detail,
            {
                "error": {
                    "message": "request daily limit exceeded",
                    "type": "rate_limit_error",
                    "param": None,
                    "code": "usage_limit_exceeded",
                }
            },
        )

    def test_require_identity_keeps_existing_management_error_shape(self) -> None:
        with (
            mock.patch.object(support_module, "_legacy_admin_identity", return_value=None),
            mock.patch.object(support_module.auth_service, "authenticate", return_value=None),
        ):
            with self.assertRaises(HTTPException) as caught:
                support_module.require_identity("Bearer bad-key")

        self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(caught.exception.detail, {"error": "密钥无效或已失效，请重新登录"})

    def test_require_admin_keeps_existing_management_error_shape(self) -> None:
        with mock.patch.object(
            support_module,
            "require_identity",
            return_value={"id": "user-1", "name": "Alice", "role": "user"},
        ):
            with self.assertRaises(HTTPException) as caught:
                support_module.require_admin("Bearer user-key")

        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(caught.exception.detail, {"error": "需要管理员权限才能执行这个操作"})


if __name__ == "__main__":
    unittest.main()
