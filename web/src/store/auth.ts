"use client";

import localforage from "localforage";

export type AuthRole = "admin" | "user";

export type StoredAuthLimits = {
  requestsPerDay?: number | null;
  creditsTotal?: number | null;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  imagesPerDay?: number | null;
  imagesTotal?: number | null;
  imagesUsed?: number | null;
  imagesRemaining?: number | null;
  concurrency?: number | null;
  models?: string[];
};

export type StoredAuthSession = {
  key: string;
  role: AuthRole;
  subjectId: string;
  name: string;
  email?: string;
  limits?: StoredAuthLimits | null;
};

type LoginResponseLike = {
  role?: unknown;
  subject_id?: unknown;
  name?: unknown;
  email?: unknown;
  access_token?: unknown;
  limits?: unknown;
};

export const AUTH_KEY_STORAGE_KEY = "chatgpt2api_auth_key";
export const AUTH_SESSION_STORAGE_KEY = "chatgpt2api_auth_session";

const authStorage = localforage.createInstance({
  name: "chatgpt2api",
  storeName: "auth",
});

function normalizeSession(value: unknown, fallbackKey = ""): StoredAuthSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredAuthSession>;
  const key = String(candidate.key || fallbackKey || "").trim();
  const role = candidate.role === "admin" || candidate.role === "user" ? candidate.role : null;
  if (!key || !role) {
    return null;
  }

  return {
    key,
    role,
    subjectId: String(candidate.subjectId || "").trim(),
    name: String(candidate.name || "").trim(),
    email: String(candidate.email || "").trim() || undefined,
    limits: normalizeLimits(candidate.limits),
  };
}

function normalizeLimitNumber(value: unknown) {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeLimits(value: unknown): StoredAuthLimits | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StoredAuthLimits>;
  const limits: StoredAuthLimits = {};
  const requestsPerDay = normalizeLimitNumber(candidate.requestsPerDay);
  const creditsTotal = normalizeLimitNumber(candidate.creditsTotal);
  const creditsUsed = normalizeLimitNumber(candidate.creditsUsed);
  const creditsRemaining = normalizeLimitNumber(candidate.creditsRemaining);
  const imagesPerDay = normalizeLimitNumber(candidate.imagesPerDay);
  const imagesTotal = normalizeLimitNumber(candidate.imagesTotal);
  const imagesUsed = normalizeLimitNumber(candidate.imagesUsed);
  const imagesRemaining = normalizeLimitNumber(candidate.imagesRemaining);
  const concurrency = normalizeLimitNumber(candidate.concurrency);
  if (requestsPerDay !== undefined) {
    limits.requestsPerDay = requestsPerDay;
  }
  if (imagesPerDay !== undefined) {
    limits.imagesPerDay = imagesPerDay;
  }
  const totalCredits = creditsTotal !== undefined ? creditsTotal : imagesTotal;
  const usedCredits = creditsUsed !== undefined ? creditsUsed : imagesUsed;
  const remainingCredits = creditsRemaining !== undefined ? creditsRemaining : imagesRemaining;
  if (totalCredits !== undefined) {
    limits.creditsTotal = totalCredits;
    limits.imagesTotal = totalCredits;
  }
  if (usedCredits !== undefined) {
    limits.creditsUsed = usedCredits;
    limits.imagesUsed = usedCredits;
  }
  if (remainingCredits !== undefined) {
    limits.creditsRemaining = remainingCredits;
    limits.imagesRemaining = remainingCredits;
  }
  if (concurrency !== undefined) {
    limits.concurrency = concurrency;
  }
  if (Array.isArray(candidate.models)) {
    limits.models = candidate.models.map((model) => String(model).trim()).filter(Boolean);
  }

  return Object.keys(limits).length > 0 ? limits : null;
}

export function getDefaultRouteForRole(role: AuthRole) {
  return role === "admin" ? "/accounts" : "/ColaAI";
}

export function createStoredAuthSessionFromLoginResponse(loginValue: string, data: LoginResponseLike): StoredAuthSession {
  return {
    key: String(data.access_token || loginValue || "").trim(),
    role: data.role === "admin" ? "admin" : "user",
    subjectId: String(data.subject_id || "").trim(),
    name: String(data.name || "").trim(),
    email: String(data.email || "").trim() || undefined,
    limits: normalizeLimits({
      requestsPerDay: (data.limits as { requests_per_day?: unknown } | null | undefined)?.requests_per_day,
      imagesPerDay: (data.limits as { images_per_day?: unknown } | null | undefined)?.images_per_day,
      creditsTotal: (data.limits as { images_total?: unknown } | null | undefined)?.images_total,
      creditsUsed: (data.limits as { images_used?: unknown } | null | undefined)?.images_used,
      creditsRemaining: (data.limits as { images_remaining?: unknown } | null | undefined)?.images_remaining,
      imagesTotal: (data.limits as { images_total?: unknown } | null | undefined)?.images_total,
      imagesUsed: (data.limits as { images_used?: unknown } | null | undefined)?.images_used,
      imagesRemaining: (data.limits as { images_remaining?: unknown } | null | undefined)?.images_remaining,
      concurrency: (data.limits as { concurrency?: unknown } | null | undefined)?.concurrency,
      models: (data.limits as { models?: unknown } | null | undefined)?.models,
    }),
  };
}

export async function getStoredAuthKey() {
  if (typeof window === "undefined") {
    return "";
  }
  const value = await authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY);
  return String(value || "").trim();
}

export async function getStoredAuthSession() {
  if (typeof window === "undefined") {
    return null;
  }

  const [storedKey, storedSession] = await Promise.all([
    authStorage.getItem<string>(AUTH_KEY_STORAGE_KEY),
    authStorage.getItem<StoredAuthSession>(AUTH_SESSION_STORAGE_KEY),
  ]);

  const normalizedSession = normalizeSession(storedSession, String(storedKey || ""));
  if (normalizedSession) {
    if (normalizedSession.key !== String(storedKey || "").trim()) {
      await authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key);
    }
    return normalizedSession;
  }

  if (String(storedKey || "").trim()) {
    await clearStoredAuthSession();
  }
  return null;
}

export async function setStoredAuthSession(session: StoredAuthSession) {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession) {
    await clearStoredAuthSession();
    return;
  }

  await Promise.all([
    authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedSession.key),
    authStorage.setItem(AUTH_SESSION_STORAGE_KEY, normalizedSession),
  ]);
}

export async function setStoredAuthKey(authKey: string) {
  const normalizedAuthKey = String(authKey || "").trim();
  if (!normalizedAuthKey) {
    await clearStoredAuthSession();
    return;
  }
  await authStorage.setItem(AUTH_KEY_STORAGE_KEY, normalizedAuthKey);
}

export async function clearStoredAuthSession() {
  if (typeof window === "undefined") {
    return;
  }
  await Promise.all([
    authStorage.removeItem(AUTH_KEY_STORAGE_KEY),
    authStorage.removeItem(AUTH_SESSION_STORAGE_KEY),
  ]);
}

export async function clearStoredAuthKey() {
  await clearStoredAuthSession();
}
