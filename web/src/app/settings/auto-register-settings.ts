import type { AutoRegisterSettings, SettingsConfig } from "../../lib/api";

export const DEFAULT_AUTO_REGISTER_SETTINGS: AutoRegisterSettings = {
  enabled: true,
  min_available: 50,
  target_available: 50,
  check_interval_seconds: 30,
  cooldown_seconds: 300,
};

function positiveNumber(value: unknown, fallback: number, minimum: number) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(minimum, normalized);
}

export function normalizeAutoRegisterSettings(value: unknown): AutoRegisterSettings {
  const source = typeof value === "object" && value ? value as Partial<AutoRegisterSettings> : {};
  return {
    enabled: Boolean(source.enabled ?? DEFAULT_AUTO_REGISTER_SETTINGS.enabled),
    min_available: positiveNumber(source.min_available, Number(DEFAULT_AUTO_REGISTER_SETTINGS.min_available), 1),
    target_available: positiveNumber(source.target_available, Number(DEFAULT_AUTO_REGISTER_SETTINGS.target_available), 1),
    check_interval_seconds: positiveNumber(
      source.check_interval_seconds,
      Number(DEFAULT_AUTO_REGISTER_SETTINGS.check_interval_seconds),
      5,
    ),
    cooldown_seconds: positiveNumber(source.cooldown_seconds, Number(DEFAULT_AUTO_REGISTER_SETTINGS.cooldown_seconds), 30),
  };
}

export function buildAutoRegisterSettingsPatch(value: unknown): Pick<SettingsConfig, "auto_register"> {
  return {
    auto_register: normalizeAutoRegisterSettings(value),
  };
}
