"use client";

import localforage from "localforage";

export type ColaAuthRole = "guest" | "creator";

export type ColaAuthSession = {
  key: string;
  role: ColaAuthRole;
  subjectId: string;
  name: string;
  email?: string;
};

export type ColaAuthProfile = {
  id: string;
  key: string;
  name: string;
  email: string;
  createdAt: string;
};

export type ColaAuthStorageLike = {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<unknown>;
  removeItem(key: string): Promise<void>;
};

export const COLA_AUTH_KEY_STORAGE_KEY = "colaai_auth_key";
export const COLA_AUTH_SESSION_STORAGE_KEY = "colaai_auth_session";
export const COLA_AUTH_PROFILE_STORAGE_KEY = "colaai_auth_profile";

const colaAuthStorage = localforage.createInstance({
  name: "colaai",
  storeName: "auth",
});

function isDefaultStorage(storage: ColaAuthStorageLike) {
  return storage === colaAuthStorage;
}

function canUseStorage(storage: ColaAuthStorageLike) {
  return !isDefaultStorage(storage) || typeof window !== "undefined";
}

function clean(value: unknown) {
  return String(value || "").trim();
}

function createId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function normalizeSession(value: unknown, fallbackKey = ""): ColaAuthSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ColaAuthSession>;
  const key = clean(candidate.key || fallbackKey);
  const role = candidate.role === "creator" ? "creator" : null;
  if (!key || !role) {
    return null;
  }

  return {
    key,
    role,
    subjectId: clean(candidate.subjectId) || "cola-local-user",
    name: clean(candidate.name) || "Cola Creator",
    email: clean(candidate.email) || undefined,
  };
}

function normalizeProfile(value: unknown): ColaAuthProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ColaAuthProfile>;
  const key = clean(candidate.key);
  const name = clean(candidate.name);
  if (!key || !name) {
    return null;
  }

  return {
    id: clean(candidate.id) || createId("cola-user"),
    key,
    name,
    email: clean(candidate.email),
    createdAt: clean(candidate.createdAt) || new Date().toISOString(),
  };
}

export function createColaAuthProfile(input: { name: string; email?: string }): ColaAuthProfile {
  return {
    id: createId("cola-user"),
    key: createId("cola-local"),
    name: clean(input.name) || "Cola Creator",
    email: clean(input.email),
    createdAt: new Date().toISOString(),
  };
}

export function createColaAuthSessionFromProfile(profile: ColaAuthProfile): ColaAuthSession {
  return {
    key: profile.key,
    role: "creator",
    subjectId: profile.id,
    name: profile.name,
    email: profile.email || undefined,
  };
}

export async function getStoredColaAuthProfile(storage: ColaAuthStorageLike = colaAuthStorage) {
  if (!canUseStorage(storage)) {
    return null;
  }

  return normalizeProfile(await storage.getItem<ColaAuthProfile>(COLA_AUTH_PROFILE_STORAGE_KEY));
}

export async function setStoredColaAuthProfile(profile: ColaAuthProfile, storage: ColaAuthStorageLike = colaAuthStorage) {
  if (!canUseStorage(storage)) {
    return;
  }

  const normalizedProfile = normalizeProfile(profile);
  if (!normalizedProfile) {
    await storage.removeItem(COLA_AUTH_PROFILE_STORAGE_KEY);
    return;
  }

  await storage.setItem(COLA_AUTH_PROFILE_STORAGE_KEY, normalizedProfile);
}

export async function getStoredColaAuthSession(storage: ColaAuthStorageLike = colaAuthStorage) {
  if (!canUseStorage(storage)) {
    return null;
  }

  const [storedKey, storedSession] = await Promise.all([
    storage.getItem<string>(COLA_AUTH_KEY_STORAGE_KEY),
    storage.getItem<ColaAuthSession>(COLA_AUTH_SESSION_STORAGE_KEY),
  ]);
  const normalizedSession = normalizeSession(storedSession, clean(storedKey));

  if (normalizedSession) {
    if (normalizedSession.key !== clean(storedKey)) {
      await storage.setItem(COLA_AUTH_KEY_STORAGE_KEY, normalizedSession.key);
    }
    return normalizedSession;
  }

  if (clean(storedKey)) {
    await clearStoredColaAuthSession(storage);
  }
  return null;
}

export async function setStoredColaAuthSession(session: ColaAuthSession, storage: ColaAuthStorageLike = colaAuthStorage) {
  if (!canUseStorage(storage)) {
    return;
  }

  const normalizedSession = normalizeSession(session);
  if (!normalizedSession) {
    await clearStoredColaAuthSession(storage);
    return;
  }

  await Promise.all([
    storage.setItem(COLA_AUTH_KEY_STORAGE_KEY, normalizedSession.key),
    storage.setItem(COLA_AUTH_SESSION_STORAGE_KEY, normalizedSession),
  ]);
}

export async function clearStoredColaAuthSession(storage: ColaAuthStorageLike = colaAuthStorage) {
  if (!canUseStorage(storage)) {
    return;
  }

  await Promise.all([
    storage.removeItem(COLA_AUTH_KEY_STORAGE_KEY),
    storage.removeItem(COLA_AUTH_SESSION_STORAGE_KEY),
  ]);
}
