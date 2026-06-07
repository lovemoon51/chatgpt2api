import { describe, expect, test } from "bun:test";

import type { ManagedImage } from "@/lib/api";
import {
  buildPublicDiscoverLandingHeroItems,
  buildLandingHeroItems,
  getLandingHeroScrollMotion,
  landingHeroFallbackItems,
  shouldSnapLandingHeroToDiscover,
} from "./cola-ai-landing-hero-state";

const managed = (overrides: Partial<ManagedImage>): ManagedImage => ({
  rel: overrides.rel || "managed-default",
  path: overrides.path,
  name: overrides.name || "recent-image.png",
  date: overrides.date || "2026-06-02",
  size: overrides.size ?? 1024,
  url: overrides.url ?? "/images/recent-image.png",
  thumbnail_url: overrides.thumbnail_url,
  created_at: overrides.created_at || "2026-06-02T00:00:00Z",
  width: overrides.width,
  height: overrides.height,
  tags: overrides.tags,
});

describe("cola-ai-landing-hero-state", () => {
  test("keeps the fixed five landing hero items instead of using managed images", () => {
    const items = buildLandingHeroItems([
      managed({
        rel: "managed-1",
        name: "night-castle.png",
        url: "/images/night-castle.png",
        thumbnail_url: "/image-thumbnails/night-castle.png",
        width: 1536,
        height: 1024,
      }),
      managed({
        rel: "managed-2",
        name: "product-shot.png",
        url: "/images/product-shot.png",
        thumbnail_url: "/image-thumbnails/product-shot.png",
      }),
      managed({ rel: "managed-3", name: "card.png", url: "/images/card.png" }),
      managed({ rel: "managed-4", name: "cover.png", url: "/images/cover.png" }),
      managed({ rel: "managed-5", name: "plan.png", url: "/images/plan.png" }),
      managed({ rel: "managed-6", name: "ignored.png", url: "/images/ignored.png" }),
    ]);

    expect(items).toEqual(landingHeroFallbackItems);
    expect(items).toHaveLength(5);
    expect(items.some((item) => item.id.startsWith("managed-"))).toBe(false);
  });

  test("returns the ColaAI fallback dataset when no managed images exist", () => {
    expect(buildLandingHeroItems([])).toEqual(landingHeroFallbackItems);
    expect(landingHeroFallbackItems).toHaveLength(5);
  });

  test("maps public discover images into landing hero items for public preview", () => {
    const items = buildPublicDiscoverLandingHeroItems([
      {
        id: "public-discover-1",
        title: "公共角色海报",
        subtitle: "ColaAI 公共精选",
        prompt: "公共角色海报提示词",
        imageUrl: "/public-images/public-discover-1.png?signature=test",
        imageFallbackUrl: "/public-images/public-discover-1-thumb.png?signature=test",
      },
    ]);

    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      id: "public-discover-1",
      title: "公共角色海报",
      subtitle: "ColaAI 公共精选",
      imageUrl: "/public-images/public-discover-1-thumb.png?signature=test",
      imageFallbackUrl: "/public-images/public-discover-1.png?signature=test",
      alt: "公共角色海报 ColaAI 公共精选",
    });
    expect(items[1].id).toBe(landingHeroFallbackItems[0].id);
  });

  test("uses thumbnails as the landing hero primary source for faster first paint", () => {
    const items = buildPublicDiscoverLandingHeroItems([
      {
        id: "public-discover-thumb",
        title: "快速首屏图",
        imageUrl: "/public-images/original-large.png?signature=test",
        imageFallbackUrl: "/public-images/thumb-small.webp?signature=test",
      },
    ]);

    expect(items[0].imageUrl).toBe("/public-images/thumb-small.webp?signature=test");
    expect(items[0].imageFallbackUrl).toBe("/public-images/original-large.png?signature=test");
  });

  test("calculates staged scroll progress for the orbit handoff animation", () => {
    const start = getLandingHeroScrollMotion({
      scrollY: 0,
      heroHeight: 1800,
      viewportHeight: 800,
    });
    const mid = getLandingHeroScrollMotion({
      scrollY: 500,
      heroHeight: 1800,
      viewportHeight: 800,
    });
    const end = getLandingHeroScrollMotion({
      scrollY: 1000,
      heroHeight: 1800,
      viewportHeight: 800,
    });

    expect(start).toEqual({
      progress: 0,
      coreProgress: 0,
      orbitProgress: 0,
      titleProgress: 0,
      timelineProgress: 0,
      exitProgress: 0,
      stageState: "idle",
    });
    expect(mid.progress).toBeGreaterThan(0);
    expect(mid.progress).toBeLessThan(1);
    expect(mid.coreProgress).toBe(1);
    expect(mid.orbitProgress).toBe(1);
    expect(mid.timelineProgress).toBeGreaterThan(0);
    expect(mid.titleProgress).toBeGreaterThan(mid.exitProgress);
    expect(mid.stageState).toBe("handoff");
    expect(end).toEqual({
      progress: 1,
      coreProgress: 1,
      orbitProgress: 1,
      titleProgress: 1,
      timelineProgress: 1,
      exitProgress: 1,
      stageState: "handoff",
    });
  });

  test("snaps to discover once the orbit handoff has visually completed", () => {
    expect(
      shouldSnapLandingHeroToDiscover({
        goingDown: true,
        snapLocked: false,
        heroScrollY: 1560,
        heroHeight: 1974,
        viewportHeight: 897,
        discoverViewportTop: 414,
      }),
    ).toBe(true);

    expect(
      shouldSnapLandingHeroToDiscover({
        goingDown: true,
        snapLocked: false,
        heroScrollY: 1460,
        heroHeight: 1974,
        viewportHeight: 897,
        discoverViewportTop: 514,
      }),
    ).toBe(true);

    expect(
      shouldSnapLandingHeroToDiscover({
        goingDown: true,
        snapLocked: false,
        heroScrollY: 420,
        heroHeight: 1974,
        viewportHeight: 897,
        discoverViewportTop: 1554,
      }),
    ).toBe(false);
  });

  test("does not keep snapping after the discover page has reached the viewport top", () => {
    expect(
      shouldSnapLandingHeroToDiscover({
        goingDown: true,
        snapLocked: false,
        heroScrollY: 1974,
        heroHeight: 1974,
        viewportHeight: 897,
        discoverViewportTop: 0,
      }),
    ).toBe(false);

    expect(
      shouldSnapLandingHeroToDiscover({
        goingDown: true,
        snapLocked: false,
        heroScrollY: 1974,
        heroHeight: 1974,
        viewportHeight: 897,
        discoverViewportTop: -120,
      }),
    ).toBe(false);
  });
});
