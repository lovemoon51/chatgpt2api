import { describe, expect, test } from "bun:test";

import { createStoredAuthSessionFromLoginResponse, getDefaultRouteForRole } from "./auth";

describe("shared auth route defaults", () => {
  test("sends ordinary users into ColaAI instead of the legacy studio", () => {
    expect(getDefaultRouteForRole("user")).toBe("/ColaAI");
  });

  test("keeps admins in the management dashboard", () => {
    expect(getDefaultRouteForRole("admin")).toBe("/accounts");
  });

  test("builds a stored ordinary user session from the backend login response", () => {
    expect(
      createStoredAuthSessionFromLoginResponse("raw-user-key", {
        role: "user",
        subject_id: "user-1",
        name: "Studio Guest",
        email: "creator@example.com",
        access_token: "sess-user-token",
        limits: {
          requests_per_day: 10,
          images_total: 40,
          images_used: 13,
          images_remaining: 27,
          concurrency: 2,
          models: ["gpt-image-2"],
        },
      }),
    ).toEqual({
      key: "sess-user-token",
      role: "user",
      subjectId: "user-1",
      name: "Studio Guest",
      email: "creator@example.com",
      limits: {
        requestsPerDay: 10,
        creditsTotal: 40,
        creditsUsed: 13,
        creditsRemaining: 27,
        imagesTotal: 40,
        imagesUsed: 13,
        imagesRemaining: 27,
        concurrency: 2,
        models: ["gpt-image-2"],
      },
    });
  });
});
