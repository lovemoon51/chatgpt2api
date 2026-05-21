from __future__ import annotations

import unittest
from unittest import mock

import api.support as support_module


class FakeAccountPool:
    def __init__(self, available: int, *, tokens: list[str] | None = None, refreshed_available: int | None = None):
        self.available = available
        self.tokens = tokens or []
        self.refreshed_available = refreshed_available
        self.refresh_calls: list[tuple[list[str], str]] = []

    def list_tokens(self) -> list[str]:
        return list(self.tokens)

    def refresh_accounts(self, access_tokens: list[str], log_title: str = "批量刷新账号") -> dict:
        self.refresh_calls.append((list(access_tokens), log_title))
        if self.refreshed_available is not None:
            self.available = self.refreshed_available
        return {"refreshed": len(access_tokens), "errors": [], "items": []}

    def available_account_count(self) -> int:
        return self.available


class FakeRegistrar:
    def __init__(self, enabled: bool = False):
        self.enabled = enabled
        self.updates: list[dict] = []
        self.started = 0

    def get(self) -> dict:
        return {"enabled": self.enabled}

    def update(self, updates: dict) -> dict:
        self.updates.append(dict(updates))
        return self.get()

    def start(self) -> dict:
        self.started += 1
        self.enabled = True
        return self.get()


class AutoRegisterWatcherTests(unittest.TestCase):
    def test_starts_register_when_available_accounts_below_threshold(self) -> None:
        registrar = FakeRegistrar(enabled=False)
        account_pool = FakeAccountPool(available=3, tokens=["token-a", "token-b"])
        with mock.patch.object(
            support_module.config,
            "get_auto_register_settings",
            return_value={
                "enabled": True,
                "min_available": 100,
                "target_available": 100,
                "check_interval_seconds": 30,
                "cooldown_seconds": 300,
            },
        ), mock.patch.object(support_module.log_service, "add") as add_log:
            last_triggered_at, triggered = support_module.run_auto_register_check(
                0,
                now=1000,
                account_pool=account_pool,
                registrar=registrar,
            )

        self.assertEqual(account_pool.refresh_calls, [
            (["token-a", "token-b"], "一键刷新所有账号信息和额度"),
        ])
        self.assertTrue(triggered)
        self.assertEqual(last_triggered_at, 1000)
        self.assertEqual(registrar.started, 1)
        self.assertEqual(registrar.updates[0]["mode"], "available")
        self.assertEqual(registrar.updates[0]["target_available"], 100)
        self.assertEqual(registrar.updates[0]["total"], 97)
        self.assertEqual(add_log.call_args.args[0], support_module.LOG_TYPE_ACCOUNT)
        self.assertEqual(add_log.call_args.args[1], "图片健康号池巡检触发补池")
        self.assertTrue(add_log.call_args.args[2]["triggered"])

    def test_refreshes_all_accounts_before_deciding_whether_to_register(self) -> None:
        settings = {
            "enabled": True,
            "min_available": 100,
            "target_available": 120,
            "check_interval_seconds": 30,
            "cooldown_seconds": 300,
        }
        account_pool = FakeAccountPool(
            available=3,
            tokens=["token-a", "token-b", "token-c"],
            refreshed_available=101,
        )
        registrar = FakeRegistrar(enabled=False)
        with (
            mock.patch.object(support_module.config, "get_auto_register_settings", return_value=settings),
            mock.patch.object(support_module.log_service, "add") as add_log,
        ):
            last_triggered_at, triggered = support_module.run_auto_register_check(
                0,
                now=1000,
                account_pool=account_pool,
                registrar=registrar,
            )

        self.assertEqual(account_pool.refresh_calls, [
            (["token-a", "token-b", "token-c"], "一键刷新所有账号信息和额度"),
        ])
        self.assertFalse(triggered)
        self.assertEqual(last_triggered_at, 0)
        self.assertEqual(registrar.started, 0)
        self.assertEqual(add_log.call_args.args[1], "图片健康号池巡检")
        self.assertEqual(add_log.call_args.args[2]["available"], 101)
        self.assertEqual(add_log.call_args.args[2]["reason"], "enough_available_accounts")

    def test_does_not_start_during_cooldown_or_when_running(self) -> None:
        settings = {
            "enabled": True,
            "min_available": 100,
            "target_available": 100,
            "check_interval_seconds": 30,
            "cooldown_seconds": 300,
        }
        with (
            mock.patch.object(support_module.config, "get_auto_register_settings", return_value=settings),
            mock.patch.object(support_module.log_service, "add") as add_log,
        ):
            cooldown_registrar = FakeRegistrar(enabled=False)
            last_triggered_at, triggered = support_module.run_auto_register_check(
                900,
                now=1000,
                account_pool=FakeAccountPool(available=3),
                registrar=cooldown_registrar,
            )
            running_registrar = FakeRegistrar(enabled=True)
            _last, running_triggered = support_module.run_auto_register_check(
                0,
                now=1000,
                account_pool=FakeAccountPool(available=3),
                registrar=running_registrar,
            )

        self.assertFalse(triggered)
        self.assertEqual(last_triggered_at, 900)
        self.assertEqual(cooldown_registrar.started, 0)
        self.assertFalse(running_triggered)
        self.assertEqual(running_registrar.started, 0)
        reasons = [call.args[2]["reason"] for call in add_log.call_args_list]
        self.assertEqual(reasons, ["cooldown", "register_already_running"])

    def test_logs_when_available_accounts_are_enough(self) -> None:
        settings = {
            "enabled": True,
            "min_available": 100,
            "target_available": 120,
            "check_interval_seconds": 30,
            "cooldown_seconds": 300,
        }
        registrar = FakeRegistrar(enabled=False)
        with (
            mock.patch.object(support_module.config, "get_auto_register_settings", return_value=settings),
            mock.patch.object(support_module.log_service, "add") as add_log,
        ):
            last_triggered_at, triggered = support_module.run_auto_register_check(
                0,
                now=1000,
                account_pool=FakeAccountPool(available=101),
                registrar=registrar,
            )

        self.assertFalse(triggered)
        self.assertEqual(last_triggered_at, 0)
        self.assertEqual(registrar.started, 0)
        self.assertEqual(add_log.call_args.args[1], "图片健康号池巡检")
        self.assertEqual(add_log.call_args.args[2]["reason"], "enough_available_accounts")
        self.assertEqual(add_log.call_args.args[2]["available"], 101)


if __name__ == "__main__":
    unittest.main()
