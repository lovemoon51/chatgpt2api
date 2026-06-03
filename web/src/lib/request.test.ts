import { describe, expect, test } from "bun:test";

import { getUnauthorizedRedirectPath, getUnauthorizedRedirectPlan } from "./request";

describe("unauthorized redirect routing", () => {
  test("keeps ColaAI unauthorized redirects inside ColaAI auth", () => {
    expect(getUnauthorizedRedirectPath("/ColaAI")).toBe("/ColaAI/login");
    expect(getUnauthorizedRedirectPath("/ColaAI/assets")).toBe("/ColaAI/login");
    expect(getUnauthorizedRedirectPath("/ColaAI/register")).toBe("/ColaAI/login");
    expect(getUnauthorizedRedirectPlan("/ColaAI/assets")).toEqual({
      redirectPath: "/ColaAI/login",
      clearColaAuth: true,
    });
  });

  test("does not redirect when already on a login page", () => {
    expect(getUnauthorizedRedirectPath("/login")).toBe("");
    expect(getUnauthorizedRedirectPath("/ColaAI/login")).toBe("");
    expect(getUnauthorizedRedirectPlan("/ColaAI/login")).toEqual({
      redirectPath: "",
      clearColaAuth: false,
    });
  });

  test("uses the shared login page outside ColaAI", () => {
    expect(getUnauthorizedRedirectPath("/studio")).toBe("/login");
    expect(getUnauthorizedRedirectPath("/accounts")).toBe("/login");
    expect(getUnauthorizedRedirectPlan("/studio")).toEqual({
      redirectPath: "/login",
      clearColaAuth: false,
    });
  });
});
