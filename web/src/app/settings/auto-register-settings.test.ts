import { describe, expect, test } from "bun:test";

import { buildAutoRegisterSettingsPatch, normalizeAutoRegisterSettings } from "./auto-register-settings";

describe("auto register settings helpers", () => {
  test("builds a settings patch with only auto_register", () => {
    expect(buildAutoRegisterSettingsPatch({
      enabled: true,
      min_available: "0",
      target_available: "12",
      check_interval_seconds: "3",
      cooldown_seconds: "8",
    })).toEqual({
      auto_register: {
        enabled: true,
        min_available: 1,
        target_available: 12,
        check_interval_seconds: 5,
        cooldown_seconds: 30,
      },
    });
  });

  test("normalizes missing settings to defaults", () => {
    expect(normalizeAutoRegisterSettings(undefined)).toEqual({
      enabled: true,
      min_available: 50,
      target_available: 50,
      check_interval_seconds: 30,
      cooldown_seconds: 300,
    });
  });
});
