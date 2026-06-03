import json
import tempfile
import unittest
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
ROOT_CONFIG_FILE = ROOT_DIR / "config.json"


class ConfigLoadingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._created_root_config = False
        if not ROOT_CONFIG_FILE.exists():
            ROOT_CONFIG_FILE.write_text(json.dumps({"auth-key": "test-auth"}), encoding="utf-8")
            cls._created_root_config = True

        from services import config as config_module

        cls.config_module = config_module

    @classmethod
    def tearDownClass(cls) -> None:
        if cls._created_root_config and ROOT_CONFIG_FILE.exists():
            ROOT_CONFIG_FILE.unlink()

    def test_load_settings_ignores_directory_config_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            base_dir = Path(tmp_dir)
            data_dir = base_dir / "data"
            config_dir = base_dir / "config.json"
            os_auth_key = "env-auth"

            config_dir.mkdir()

            module = self.config_module
            old_base_dir = module.BASE_DIR
            old_data_dir = module.DATA_DIR
            old_config_file = module.CONFIG_FILE
            old_env_auth_key = module.os.environ.get("CHATGPT2API_AUTH_KEY")
            try:
                module.BASE_DIR = base_dir
                module.DATA_DIR = data_dir
                module.CONFIG_FILE = config_dir
                module.os.environ["CHATGPT2API_AUTH_KEY"] = os_auth_key

                settings = module._load_settings()

                self.assertEqual(settings.auth_key, os_auth_key)
                self.assertEqual(settings.refresh_account_interval_minute, 5)
            finally:
                module.BASE_DIR = old_base_dir
                module.DATA_DIR = old_data_dir
                module.CONFIG_FILE = old_config_file
                if old_env_auth_key is None:
                    module.os.environ.pop("CHATGPT2API_AUTH_KEY", None)
                else:
                    module.os.environ["CHATGPT2API_AUTH_KEY"] = old_env_auth_key

    def test_auto_register_settings_default_to_50_enabled(self) -> None:
        settings = self.config_module._normalize_auto_register_settings({})

        self.assertTrue(settings["enabled"])
        self.assertEqual(settings["min_available"], 50)
        self.assertEqual(settings["target_available"], 50)
        self.assertEqual(settings["check_interval_seconds"], 30)
        self.assertEqual(settings["cooldown_seconds"], 300)

    def test_auto_register_settings_normalize_invalid_values(self) -> None:
        settings = self.config_module._normalize_auto_register_settings({
            "enabled": "off",
            "min_available": "-1",
            "target_available": "0",
            "check_interval_seconds": "1",
            "cooldown_seconds": "2",
        })

        self.assertFalse(settings["enabled"])
        self.assertEqual(settings["min_available"], 1)
        self.assertEqual(settings["target_available"], 1)
        self.assertEqual(settings["check_interval_seconds"], 5)
        self.assertEqual(settings["cooldown_seconds"], 30)

    def test_account_pool_max_total_accounts_defaults_from_legacy_auto_register_target(self) -> None:
        settings = self.config_module._normalize_account_pool_settings(
            {},
            {"target_available": "120"},
        )

        self.assertEqual(settings["max_total_accounts"], 120)

    def test_auth_settings_disable_username_login_by_default(self) -> None:
        settings = self.config_module._normalize_auth_settings({})

        self.assertFalse(settings["username_login_enabled"])

    def test_agnes_ai_settings_normalize_multiple_keys_and_legacy_key(self) -> None:
        settings = self.config_module._normalize_agnes_ai_settings({
            "base_url": "https://agnes.example/v1/",
            "api_key": "legacy-key",
            "api_keys": [
                {"name": "主 key", "api_key": "key-a", "enabled": True},
                {"name": "关闭 key", "api_key": "key-b", "enabled": False},
                {"name": "", "api_key": "  ", "enabled": True},
            ],
        })

        self.assertEqual(settings["base_url"], "https://agnes.example/v1")
        self.assertEqual(settings["api_key"], "legacy-key")
        self.assertEqual(settings["api_keys"], [
            {"name": "主 key", "api_key": "key-a", "enabled": True},
            {"name": "关闭 key", "api_key": "key-b", "enabled": False},
        ])

    def test_config_update_persists_agnes_ai_api_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.json"
            config_path.write_text(json.dumps({"auth-key": "test-admin"}), encoding="utf-8")

            store = self.config_module.ConfigStore(config_path)
            updated = store.update({
                "agnes_ai": {
                    "base_url": "https://agnes.example/v1/",
                    "api_keys": [
                        {"name": "主 key", "api_key": "key-a", "enabled": True},
                        {"name": "备用 key", "api_key": "key-b", "enabled": False},
                    ],
                }
            })

            self.assertEqual(updated["agnes_ai"]["base_url"], "https://agnes.example/v1")
            self.assertEqual(updated["agnes_ai"]["api_keys"], [
                {"name": "主 key", "api_key": "key-a", "enabled": True},
                {"name": "备用 key", "api_key": "key-b", "enabled": False},
            ])
            saved = json.loads(config_path.read_text(encoding="utf-8"))
            self.assertEqual(saved["agnes_ai"]["api_keys"][0]["api_key"], "key-a")

    def test_config_diagnostics_masks_secret_values_and_reports_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = Path(tmp_dir) / "config.json"
            config_path.write_text(
                json.dumps(
                    {
                        "auth-key": "config-secret",
                        "base_url": "https://from-config.example",
                        "backup": {
                            "secret_access_key": "r2-secret",
                            "passphrase": "backup-passphrase",
                        },
                        "ai_review": {"api_key": "sk-secret"},
                    }
                ),
                encoding="utf-8",
            )

            module = self.config_module
            old_env_auth_key = module.os.environ.get("CHATGPT2API_AUTH_KEY")
            old_env_base_url = module.os.environ.get("CHATGPT2API_BASE_URL")
            old_storage_backend = module.os.environ.get("STORAGE_BACKEND")
            old_postgres_sync_database_url = module.os.environ.get("POSTGRES_SYNC_DATABASE_URL")
            old_image_metadata_database_url = module.os.environ.get("IMAGE_METADATA_DATABASE_URL")
            try:
                module.os.environ["CHATGPT2API_AUTH_KEY"] = "env-secret"
                module.os.environ["CHATGPT2API_BASE_URL"] = "https://from-env.example/"
                module.os.environ["STORAGE_BACKEND"] = "sqlite"
                module.os.environ["POSTGRES_SYNC_DATABASE_URL"] = "postgresql://sync:secret@db.example:5432/app"
                module.os.environ["IMAGE_METADATA_DATABASE_URL"] = "postgresql://images:secret@db.example:5432/app"
                store = module.ConfigStore(config_path)

                diagnostics = store.diagnostics()
            finally:
                for key, value in {
                    "CHATGPT2API_AUTH_KEY": old_env_auth_key,
                    "CHATGPT2API_BASE_URL": old_env_base_url,
                    "STORAGE_BACKEND": old_storage_backend,
                    "POSTGRES_SYNC_DATABASE_URL": old_postgres_sync_database_url,
                    "IMAGE_METADATA_DATABASE_URL": old_image_metadata_database_url,
                }.items():
                    if value is None:
                        module.os.environ.pop(key, None)
                    else:
                        module.os.environ[key] = value

            items = {item["key"]: item for item in diagnostics["items"]}
            self.assertEqual(items["auth-key"]["source"], "env")
            self.assertEqual(items["auth-key"]["status"], "已设置")
            self.assertNotIn("value", items["auth-key"])
            self.assertEqual(items["base_url"]["source"], "env")
            self.assertEqual(items["base_url"]["value"], "https://from-env.example")
            self.assertEqual(items["storage.backend"]["source"], "env")
            self.assertEqual(items["storage.backend"]["value"], "sqlite")
            self.assertEqual(items["storage.postgres_sync_database_url"]["source"], "env")
            self.assertEqual(items["storage.postgres_sync_database_url"]["status"], "已设置")
            self.assertNotIn("value", items["storage.postgres_sync_database_url"])
            self.assertEqual(items["storage.image_metadata_database_url"]["source"], "env")
            self.assertEqual(items["storage.image_metadata_database_url"]["status"], "已设置")
            self.assertNotIn("value", items["storage.image_metadata_database_url"])
            self.assertNotIn("r2-secret", json.dumps(diagnostics, ensure_ascii=False))
            self.assertNotIn("backup-passphrase", json.dumps(diagnostics, ensure_ascii=False))
            self.assertNotIn("sk-secret", json.dumps(diagnostics, ensure_ascii=False))
            self.assertNotIn("sync:secret", json.dumps(diagnostics, ensure_ascii=False))
            self.assertNotIn("images:secret", json.dumps(diagnostics, ensure_ascii=False))


if __name__ == "__main__":
    unittest.main()
