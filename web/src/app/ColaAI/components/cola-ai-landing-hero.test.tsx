import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ColaAILandingHero } from "./cola-ai-landing-hero";
import type { LandingHeroItem } from "./cola-ai-landing-hero-state";

const items: LandingHeroItem[] = [
  {
    id: "hero-primary",
    title: "夜色城堡",
    subtitle: "1536 x 1024",
    imageUrl: "https://example.com/assets/hero-primary.png",
    imageFallbackUrl: "https://example.com/assets/hero-primary-thumb.png",
    alt: "夜色城堡 最近生成作品",
  },
  {
    id: "hero-orbit-1",
    title: "产品主视觉",
    subtitle: "最近作品",
    imageUrl: "https://example.com/assets/hero-orbit-1.png",
    alt: "产品主视觉 最近生成作品",
  },
  {
    id: "hero-orbit-2",
    title: "收藏卡牌",
    subtitle: "最近作品",
    imageUrl: "https://example.com/assets/hero-orbit-2.png",
    alt: "收藏卡牌 最近生成作品",
  },
  {
    id: "hero-orbit-3",
    title: "封面设计",
    subtitle: "最近作品",
    imageUrl: "https://example.com/assets/hero-orbit-3.png",
    alt: "封面设计 最近生成作品",
  },
  {
    id: "hero-orbit-4",
    title: "建筑拆解图",
    subtitle: "最近作品",
    imageUrl: "https://example.com/assets/hero-orbit-4.png",
    alt: "建筑拆解图 最近生成作品",
  },
];

describe("ColaAILandingHero", () => {
  test("renders the ColaAI landing stage with one primary card and four orbit cards", () => {
    const markup = renderToStaticMarkup(
      <ColaAILandingHero
        items={items}
        stageState="idle"
        onScrollToDiscover={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-panel="landing-hero"');
    expect(markup).toContain('data-cola-stage="reference-orbit-hero"');
    expect(markup).toContain('data-cola-motion="scroll-progress"');
    expect(markup).toContain('data-cola-state="idle"');
    expect(markup).toContain('data-cola-pin-state="before"');
    expect(markup).toContain("chapter_evolution");
    expect(markup).toContain("pin_wrapper");
    expect(markup).toContain("orbit_stage");
    expect(markup).toContain("h1_box");
    expect(markup).toContain("headline_box");
    expect(markup).toContain("core_video");
    expect(markup).toContain('data-cola-visual="landing-core-media"');
    expect(markup).toContain("timeline_line");
    expect(markup).toContain('data-cola-card-role="primary"');
    expect(markup.match(/data-cola-card-role="orbit"/g)?.length).toBe(4);
    expect(markup.match(/orbit_card/g)?.length).toBe(4);
    expect(markup).toContain('data-cola-action="scroll-to-discover"');
    expect(markup).toContain('data-cola-copy="hero-primary-title"');
    expect(markup).toContain('data-title-variant="primary"');
    expect(markup).toContain('data-cola-copy="hero-secondary-title"');
    expect(markup).toContain('data-title-variant="secondary"');
    expect(markup).toContain('data-cola-visual="timeline-ruler"');
    expect(markup).toContain('data-cola-visual="timeline-cursor-layer"');
    expect(markup).toContain("接着上次灵感");
    expect(markup).toContain("最近作品已就位");
    expect(markup).toContain("最近 5 张作品先亮相");
    expect(markup).toContain("挑一张继续改图");
    expect(markup).toContain("进入发现页");
  });

  test("renders images instead of video elements", () => {
    const markup = renderToStaticMarkup(
      <ColaAILandingHero
        items={items}
        stageState="handoff"
        onScrollToDiscover={() => undefined}
      />,
    );

    expect(markup).toContain('src="https://example.com/assets/hero-primary.png"');
    expect(markup).not.toContain("<video");
    expect(markup).not.toContain("data-lazy-load");
  });

  test("renders landing image cards without visible title or corner metadata", () => {
    const markup = renderToStaticMarkup(
      <ColaAILandingHero
        items={items}
        stageState="idle"
        onScrollToDiscover={() => undefined}
      />,
    );

    expect(markup).toContain('data-cola-card-id="hero-primary"');
    expect(markup).toContain('data-cola-card-id="hero-orbit-4"');
    expect(markup).toContain('src="https://example.com/assets/hero-primary.png"');
    expect(markup).toContain('alt="夜色城堡 最近生成作品"');
    expect(markup).not.toContain(">夜色城堡</span>");
    expect(markup).not.toContain(">1536 x 1024</span>");
    expect(markup).not.toContain(">产品主视觉</span>");
    expect(markup).not.toContain(">最近作品</span>");
  });

  test("avoids black first-paint media blocks while landing images resolve", () => {
    const markup = renderToStaticMarkup(
      <ColaAILandingHero
        items={items}
        stageState="idle"
        onScrollToDiscover={() => undefined}
      />,
    );

    expect(markup).not.toContain("bg-black");
    expect(markup).toContain("landing-hero__media-placeholder");
    expect(markup).toContain('loading="eager"');
    expect(markup).toContain('fetchPriority="high"');
  });
});
