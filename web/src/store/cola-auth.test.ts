import { describe, expect, test } from "bun:test";

import {
  COLA_AUTH_KEY_STORAGE_KEY,
  COLA_AUTH_PROFILE_STORAGE_KEY,
  COLA_AUTH_SESSION_STORAGE_KEY,
  clearStoredColaAuthSession,
  getStoredColaAuthSession,
  setStoredColaAuthSession,
  type ColaAuthStorageLike,
} from "./cola-auth";
import {
  AUTH_KEY_STORAGE_KEY,
  AUTH_SESSION_STORAGE_KEY,
} from "./auth";

function createMemoryStorage(): ColaAuthStorageLike {
  const items = new Map<string, unknown>();
  return {
    async getItem<T>(key: string) {
      return (items.has(key) ? items.get(key) : null) as T | null;
    },
    async setItem<T>(key: string, value: T) {
      items.set(key, value);
    },
    async removeItem(key: string) {
      items.delete(key);
    },
  };
}

describe("cola auth store", () => {
  test("uses ColaAI-specific storage keys that do not collide with shared auth", () => {
    expect(COLA_AUTH_KEY_STORAGE_KEY).toBe("colaai_auth_key");
    expect(COLA_AUTH_SESSION_STORAGE_KEY).toBe("colaai_auth_session");
    expect(COLA_AUTH_PROFILE_STORAGE_KEY).toBe("colaai_auth_profile");
    expect(COLA_AUTH_KEY_STORAGE_KEY).not.toBe(AUTH_KEY_STORAGE_KEY);
    expect(COLA_AUTH_SESSION_STORAGE_KEY).not.toBe(AUTH_SESSION_STORAGE_KEY);
  });

  test("persists and clears a ColaAI creator session in the provided storage", async () => {
    const storage = createMemoryStorage();

    await setStoredColaAuthSession(
      {
        key: "cola-local-123",
        role: "creator",
        subjectId: "cola-user",
        name: "Cola Creator",
      },
      storage,
    );

    expect(await getStoredColaAuthSession(storage)).toEqual({
      key: "cola-local-123",
      role: "creator",
      subjectId: "cola-user",
      name: "Cola Creator",
    });

    await clearStoredColaAuthSession(storage);

    expect(await getStoredColaAuthSession(storage)).toBeNull();
  });
});
