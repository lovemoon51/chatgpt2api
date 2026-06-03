"use client";

import { login } from "@/lib/api";
import { clearStoredAuthSession, getStoredAuthSession, setStoredAuthSession, type StoredAuthSession } from "@/store/auth";

export async function getValidatedAuthSession(): Promise<StoredAuthSession | null> {
  const storedSession = await getStoredAuthSession();
  if (!storedSession) {
    return null;
  }

  try {
    const data = await login(storedSession.key);
    const nextSession: StoredAuthSession = {
      key: storedSession.key,
      role: data.role,
      subjectId: data.subject_id,
      name: data.name,
      email: data.email || storedSession.email,
      limits: data.limits
        ? {
            requestsPerDay: data.limits.requests_per_day,
            creditsTotal: data.limits.images_total,
            creditsUsed: data.limits.images_used,
            creditsRemaining: data.limits.images_remaining,
            imagesPerDay: data.limits.images_per_day,
            imagesTotal: data.limits.images_total,
            imagesUsed: data.limits.images_used,
            imagesRemaining: data.limits.images_remaining,
            concurrency: data.limits.concurrency,
            models: data.limits.models,
          }
        : storedSession.limits,
    };
    await setStoredAuthSession(nextSession);
    return nextSession;
  } catch {
    await clearStoredAuthSession();
    return null;
  }
}
