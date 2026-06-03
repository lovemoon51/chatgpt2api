import { describe, expect, test } from "bun:test";

import {
  colaButtonClass,
  colaCardClass,
  colaFocusClass,
  colaInputShellClass,
  colaPanelClass,
  colaShellClass,
  colaSurfaceClass,
} from "./cola-ai-style";

describe("cola-ai-style", () => {
  test("defines the clear studio shell without warm beige defaults", () => {
    expect(colaShellClass).toContain("rgba(240,249,255,0.92)");
    expect(colaShellClass).toContain("rgba(236,253,245,0.9)");
    expect(colaShellClass).toContain("text-slate-950");
    expect(colaShellClass).not.toContain("245, 239, 231");
    expect(colaShellClass).not.toContain("beige");
    expect(colaShellClass).not.toContain("stone");
  });

  test("uses consistent panel, card, input, and focus classes", () => {
    expect(colaFocusClass).toContain("focus-visible:outline-none");
    expect(colaFocusClass).toContain("focus-visible:ring-cyan-400/70");
    expect(colaFocusClass).toContain("focus-visible:ring-offset-white");
    expect(colaPanelClass).toContain("border-slate-200/80");
    expect(colaPanelClass).toContain("bg-white/84");
    expect(colaPanelClass).toContain("backdrop-blur-xl");
    expect(colaCardClass).toContain("rounded-[20px]");
    expect(colaCardClass).toContain("hover:-translate-y-0.5");
    expect(colaInputShellClass).toContain("rounded-[20px]");
    expect(colaInputShellClass).toContain("bg-white/86");
    expect(colaInputShellClass).toContain("backdrop-blur-xl");
  });

  test("keeps primary buttons high contrast and reusable variants intact", () => {
    const primary = colaButtonClass("primary");
    const secondary = colaButtonClass("secondary");
    const ghost = colaButtonClass("ghost");
    const danger = colaButtonClass("danger");

    expect(primary).toContain("bg-slate-950");
    expect(primary).toContain("text-white");
    expect(primary).not.toContain("gradient");
    expect(secondary).toContain("bg-white/82");
    expect(secondary).toContain("border-slate-200/80");
    expect(ghost).toContain("bg-transparent");
    expect(ghost).toContain("focus-visible:ring-cyan-400/70");
    expect(danger).toContain("text-rose-700");
  });

  test("surface helper returns known variants without warm defaults", () => {
    expect(colaSurfaceClass("raised")).toContain("shadow-[0_24px_70px_-54px_rgba(15,23,42,0.48)]");
    expect(colaSurfaceClass("flat")).toContain("bg-slate-50/80");
    expect(colaSurfaceClass("overlay")).toContain("bg-white/96");
    expect(colaSurfaceClass("overlay")).not.toContain("bg-stone");
  });
});
