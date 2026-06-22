# ColaAI Landing Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ColaAI-native landing hero in front of `/ColaAI` discover mode, powered by the latest five managed images and snapping into the existing discover page while preserving the current discover workflow below.

**Architecture:** Introduce one small pure helper module to map managed images into a five-card landing dataset and one dedicated `LandingHero` presentation component. Keep `ColaAIWorkbench` as the orchestrator that loads managed images, renders the landing hero above `DiscoverHome`, and owns the scroll handoff behavior, while `DiscoverHome` continues to own the composer, feed, pull-to-refresh, and sticky composer logic.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Bun tests, existing `AuthenticatedImage`, existing `fetchManagedImages`, existing `getPreferredPreviewUrl()` / `getPreviewFallbackUrl()`, existing `cn()` utility.

---

## File Structure

- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero-state.ts`
  - Pure helper for mapping managed images into the approved five-slot landing dataset plus fallback items.
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts`
  - Unit tests for the five-slot landing dataset helper.
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero.tsx`
  - Dedicated presentation component for the new opening stage that renders one primary card, four orbit cards, headline, and discover CTA.
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero.test.tsx`
  - Static-render tests for landing-hero structure, card count, CTA, and “image not video” behavior.
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
  - Import the new landing helper/component, derive landing items from existing managed images, render the landing stack before `DiscoverHome`, and add scroll handoff logic.
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`
  - Extend discover-mode assertions to prove the landing hero appears before `DiscoverHome` and that the handoff markers exist.
- Modify: `web/src/app/globals.css`
  - Add landing hero orbit/stage styles, snap-motion helpers, and reduced-motion overrides.

Do not stage unrelated dirty files already present in this worktree. This repository already contains uncommitted changes in `cola-ai-workbench.tsx`, tests, and other ColaAI files; preserve them while applying only the landing integration work.

---

### Task 1: Add Five-Image Landing Dataset Helpers

**Files:**
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero-state.ts`
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `web/src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import type { ManagedImage } from "@/lib/api";
import {
  buildLandingHeroItems,
  landingHeroFallbackItems,
} from "./cola-ai-landing-hero-state";

const managed = (overrides: Partial<ManagedImage>): ManagedImage => ({
  rel: overrides.rel || "managed-default",
  path: overrides.path,
  name: overrides.name || "recent-image.png",
  date: overrides.date || "2026-06-02",
  size: overrides.size ?? 1024,
  url: overrides.url || "/images/recent-image.png",
  thumbnail_url: overrides.thumbnail_url,
  created_at: overrides.created_at || "2026-06-02T00:00:00Z",
  width: overrides.width,
  height: overrides.height,
  tags: overrides.tags,
});

describe("cola-ai-landing-hero-state", () => {
  test("maps the newest five managed images into landing hero items", () => {
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

    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      id: "managed-1",
      title: "night-castle",
      subtitle: "1536 x 1024",
      imageUrl: "/images/night-castle.png",
      imageFallbackUrl: "/image-thumbnails/night-castle.png",
      alt: "night-castle 最近生成作品",
    });
    expect(items.at(-1)?.id).toBe("managed-5");
  });

  test("falls back to thumbnail when the original image is unavailable", () => {
    const items = buildLandingHeroItems([
      managed({
        rel: "managed-thumb-only",
        name: "thumb-only.png",
        url: "",
        thumbnail_url: "/image-thumbnails/thumb-only.png",
      }),
    ]);

    expect(items[0]).toEqual({
      id: "managed-thumb-only",
      title: "thumb-only",
      subtitle: "最近作品",
      imageUrl: "/image-thumbnails/thumb-only.png",
      imageFallbackUrl: undefined,
      alt: "thumb-only 最近生成作品",
    });
  });

  test("pads with ColaAI fallback items when fewer than five managed images exist", () => {
    const items = buildLandingHeroItems([
      managed({
        rel: "managed-hero",
        name: "hero.png",
        url: "/images/hero.png",
      }),
    ]);

    expect(items).toHaveLength(5);
    expect(items[0].id).toBe("managed-hero");
    expect(items[1].id).toBe(landingHeroFallbackItems[0].id);
    expect(items[4].id).toBe(landingHeroFallbackItems[3].id);
  });

  test("returns the ColaAI fallback dataset when no managed images exist", () => {
    expect(buildLandingHeroItems([])).toEqual(landingHeroFallbackItems);
    expect(landingHeroFallbackItems).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run the helper tests and verify they fail**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts
```

Expected: FAIL because `cola-ai-landing-hero-state.ts` does not exist yet.

- [ ] **Step 3: Implement the landing dataset helper**

Create `web/src/app/ColaAI/components/cola-ai-landing-hero-state.ts`:

```ts
import type { ManagedImage } from "@/lib/api";
import { getPreferredPreviewUrl, getPreviewFallbackUrl } from "@/lib/image-fetch";

export type LandingHeroItem = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  imageFallbackUrl?: string;
  alt: string;
};

function cleanImageName(name: string, index: number) {
  const cleaned = name.replace(/\.[^.]+$/, "").trim();
  return cleaned || `最近作品 ${index + 1}`;
}

function subtitleFromImage(image: ManagedImage) {
  if (image.width && image.height) {
    return `${image.width} x ${image.height}`;
  }
  return "最近作品";
}

export const landingHeroFallbackItems: LandingHeroItem[] = [
  {
    id: "landing-fallback-poster",
    title: "光影角色海报",
    subtitle: "ColaAI 灵感",
    imageUrl: "",
    imageFallbackUrl: undefined,
    alt: "光影角色海报 ColaAI 灵感示意图",
  },
  {
    id: "landing-fallback-product",
    title: "夏日产品主视觉",
    subtitle: "ColaAI 灵感",
    imageUrl: "",
    imageFallbackUrl: undefined,
    alt: "夏日产品主视觉 ColaAI 灵感示意图",
  },
  {
    id: "landing-fallback-card",
    title: "镭射收藏卡牌",
    subtitle: "ColaAI 灵感",
    imageUrl: "",
    imageFallbackUrl: undefined,
    alt: "镭射收藏卡牌 ColaAI 灵感示意图",
  },
  {
    id: "landing-fallback-cover",
    title: "小红书封面",
    subtitle: "ColaAI 灵感",
    imageUrl: "",
    imageFallbackUrl: undefined,
    alt: "小红书封面 ColaAI 灵感示意图",
  },
  {
    id: "landing-fallback-architecture",
    title: "建筑拆解图",
    subtitle: "ColaAI 灵感",
    imageUrl: "",
    imageFallbackUrl: undefined,
    alt: "建筑拆解图 ColaAI 灵感示意图",
  },
];

function managedImageToLandingItem(image: ManagedImage, index: number): LandingHeroItem {
  const title = cleanImageName(image.name, index);
  return {
    id: image.rel || image.url || `landing-image-${index + 1}`,
    title,
    subtitle: subtitleFromImage(image),
    imageUrl: getPreferredPreviewUrl(image, "preferOriginal"),
    imageFallbackUrl: getPreviewFallbackUrl(image, "preferOriginal"),
    alt: `${title} 最近生成作品`,
  };
}

export function buildLandingHeroItems(images: ManagedImage[]): LandingHeroItem[] {
  const mapped = images.slice(0, 5).map(managedImageToLandingItem);
  if (mapped.length === 0) {
    return landingHeroFallbackItems;
  }
  if (mapped.length === 5) {
    return mapped;
  }
  return [...mapped, ...landingHeroFallbackItems.slice(0, 5 - mapped.length)];
}
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-landing-hero-state.ts web/src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts
git commit -m "feat(colaai): add landing hero state helpers"
```

---

### Task 2: Create The Dedicated Landing Hero Component

**Files:**
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero.tsx`
- Create: `web/src/app/ColaAI/components/cola-ai-landing-hero.test.tsx`

- [ ] **Step 1: Write the failing landing-hero render tests**

Create `web/src/app/ColaAI/components/cola-ai-landing-hero.test.tsx`:

```tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ColaAILandingHero } from "./cola-ai-landing-hero";
import type { LandingHeroItem } from "./cola-ai-landing-hero-state";

const items: LandingHeroItem[] = [
  {
    id: "hero-primary",
    title: "夜色城堡",
    subtitle: "1536 x 1024",
    imageUrl: "https://example.com/images/hero-primary.png",
    imageFallbackUrl: "https://example.com/images/hero-primary-thumb.png",
    alt: "夜色城堡 最近生成作品",
  },
  {
    id: "hero-orbit-1",
    title: "产品主视觉",
    subtitle: "最近作品",
    imageUrl: "https://example.com/images/hero-orbit-1.png",
    alt: "产品主视觉 最近生成作品",
  },
  {
    id: "hero-orbit-2",
    title: "收藏卡牌",
    subtitle: "最近作品",
    imageUrl: "https://example.com/images/hero-orbit-2.png",
    alt: "收藏卡牌 最近生成作品",
  },
  {
    id: "hero-orbit-3",
    title: "封面设计",
    subtitle: "最近作品",
    imageUrl: "https://example.com/images/hero-orbit-3.png",
    alt: "封面设计 最近生成作品",
  },
  {
    id: "hero-orbit-4",
    title: "建筑拆解图",
    subtitle: "最近作品",
    imageUrl: "https://example.com/images/hero-orbit-4.png",
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
    expect(markup).toContain('data-cola-stage="orbit-images"');
    expect(markup).toContain('data-cola-state="idle"');
    expect(markup).toContain('data-cola-card-role="primary"');
    expect(markup.match(/data-cola-card-role="orbit"/g)?.length).toBe(4);
    expect(markup).toContain('data-cola-action="scroll-to-discover"');
    expect(markup).toContain("将最近生成的灵感");
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

    expect(markup).toContain('src="https://example.com/images/hero-primary.png"');
    expect(markup).not.toContain("<video");
    expect(markup).not.toContain("data-lazy-load");
  });
});
```

- [ ] **Step 2: Run the landing-hero tests and verify they fail**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-landing-hero.test.tsx
```

Expected: FAIL because `cola-ai-landing-hero.tsx` does not exist yet.

- [ ] **Step 3: Implement the landing-hero component**

Create `web/src/app/ColaAI/components/cola-ai-landing-hero.tsx`:

```tsx
"use client";

import { ArrowDown, Sparkles } from "lucide-react";
import type { RefObject } from "react";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { cn } from "@/lib/utils";
import { colaButtonClass, colaCardClass } from "./cola-ai-style";
import type { LandingHeroItem } from "./cola-ai-landing-hero-state";

type ColaAILandingHeroProps = {
  items: LandingHeroItem[];
  stageState: "idle" | "handoff";
  onScrollToDiscover: () => void;
  heroRef?: RefObject<HTMLElement | null>;
};

const orbitCardClasses = [
  "landing-hero__card--orbit-one",
  "landing-hero__card--orbit-two",
  "landing-hero__card--orbit-three",
  "landing-hero__card--orbit-four",
];

function LandingHeroCard({
  item,
  role,
  orbitClassName,
}: {
  item: LandingHeroItem;
  role: "primary" | "orbit";
  orbitClassName?: string;
}) {
  return (
    <article
      data-cola-card-role={role}
      data-cola-card-id={item.id}
      className={cn("landing-hero__card overflow-hidden p-2.5 text-left", colaCardClass, orbitClassName)}
    >
      <div className="mb-2 flex items-center justify-between gap-3 rounded-[18px] border border-white/75 bg-white/76 px-3 py-2 text-[11px] font-medium text-slate-600">
        <span className="truncate">{item.title}</span>
        <span className="shrink-0 text-slate-400">{item.subtitle}</span>
      </div>
      <div className="landing-hero__media relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_top,rgba(226,232,240,0.92),rgba(248,250,252,0.98))]">
        {item.imageUrl ? (
          <AuthenticatedImage
            src={item.imageUrl}
            fallbackSrc={item.imageFallbackUrl}
            alt={item.alt}
            loadingMotion="static"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            data-cola-visual="landing-fallback-art"
            className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.26),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,249,255,0.9)_54%,rgba(236,253,245,0.86))]"
          />
        )}
      </div>
    </article>
  );
}

export function ColaAILandingHero({
  items,
  stageState,
  onScrollToDiscover,
  heroRef,
}: ColaAILandingHeroProps) {
  const [primary, ...orbit] = items;

  return (
    <section
      ref={heroRef}
      data-cola-panel="landing-hero"
      data-cola-stage="orbit-images"
      data-cola-state={stageState}
      className="landing-hero relative z-10 flex min-h-dvh items-center justify-center px-4 pb-14 pt-[88px] md:pl-[104px] md:pr-8 md:pt-[44px]"
    >
      <div className="landing-hero__stage relative mx-auto w-full max-w-[1240px]">
        <div className="landing-hero__copy relative z-20 mx-auto flex max-w-[680px] flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-100/90 bg-white/84 px-4 py-2 text-xs font-semibold text-cyan-700 shadow-[0_18px_44px_-30px_rgba(15,23,42,0.28)]">
            <Sparkles className="size-3.5" />
            将最近生成的灵感直接带回 ColaAI
          </div>
          <h1 className="mt-6 max-w-[920px] text-[clamp(44px,8vw,88px)] font-semibold leading-[0.96] tracking-[-0.055em] text-slate-950">
            把最近的作品
            <span className="block text-cyan-700">重新带回发现页</span>
          </h1>
          <p className="mt-5 max-w-[620px] text-sm leading-7 text-slate-600 sm:text-base">
            用 ColaAI 的最新五张生成图片做开场，沿着灵感舞台继续下滑，直接进入你熟悉的发现页创作体验。
          </p>
          <button
            type="button"
            data-cola-action="scroll-to-discover"
            className={colaButtonClass("primary", "mt-8 h-11 px-5")}
            onClick={onScrollToDiscover}
          >
            进入发现页
            <ArrowDown className="size-4" />
          </button>
        </div>

        {primary ? (
          <div className="landing-hero__primary-wrap relative z-10 mx-auto mt-12 flex w-full justify-center md:mt-0">
            <LandingHeroCard item={primary} role="primary" orbitClassName="landing-hero__card--primary" />
          </div>
        ) : null}

        {orbit.map((item, index) => (
          <LandingHeroCard
            key={item.id}
            item={item}
            role="orbit"
            orbitClassName={orbitCardClasses[index] || "landing-hero__card--orbit-four"}
          />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the landing-hero tests and verify they pass**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-landing-hero.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-landing-hero.tsx web/src/app/ColaAI/components/cola-ai-landing-hero.test.tsx
git commit -m "feat(colaai): add landing hero component"
```

---

### Task 3: Integrate The Landing Hero Into Discover Mode

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Add failing discover-mode integration tests**

In `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`, update imports:

```ts
import { ColaAILandingHero } from "./cola-ai-landing-hero";
import { buildLandingHeroItems } from "./cola-ai-landing-hero-state";
```

Append these tests inside `describe("ColaAIWorkbench", () => { ... })`:

```tsx
  test("builds a five-item landing dataset from recent managed images", () => {
    const items = buildLandingHeroItems([
      {
        rel: "managed-1",
        name: "hero-1.png",
        date: "2026-06-02",
        size: 1024,
        url: "/images/hero-1.png",
        thumbnail_url: "/image-thumbnails/hero-1.png",
        created_at: "2026-06-02T00:00:00Z",
      },
      {
        rel: "managed-2",
        name: "hero-2.png",
        date: "2026-06-02",
        size: 1024,
        url: "/images/hero-2.png",
        created_at: "2026-06-02T00:01:00Z",
      },
    ]);

    expect(items).toHaveLength(5);
    expect(items[0].id).toBe("managed-1");
    expect(items[1].id).toBe("managed-2");
  });

  test("renders the landing hero before discover home in discover mode", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={session} />);

    expect(markup).toContain('data-cola-panel="discover-stack"');
    expect(markup).toContain('data-cola-panel="landing-hero"');
    expect(markup).toContain('data-cola-action="scroll-to-discover"');
    expect(markup).toContain('data-cola-panel="discover-handoff"');
    expect(markup).toContain('data-cola-panel="discover-home"');
    expect(markup.indexOf('data-cola-panel="landing-hero"')).toBeLessThan(
      markup.indexOf('data-cola-panel="discover-home"'),
    );
  });
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "landing hero"
```

Expected: FAIL because `ColaAIWorkbench` does not render the new landing hero or discover stack yet.

- [ ] **Step 3: Import the landing helper and component**

At the top of `web/src/app/ColaAI/components/cola-ai-workbench.tsx`, add:

```ts
import { ColaAILandingHero } from "./cola-ai-landing-hero";
import { buildLandingHeroItems } from "./cola-ai-landing-hero-state";
```

- [ ] **Step 4: Derive landing hero items from existing managed images**

Inside `ColaAIWorkbench`, add the landing dataset and refs near the other discover-mode state:

```ts
  const [landingHeroState, setLandingHeroState] = useState<"idle" | "handoff">("idle");
  const landingHeroRef = useRef<HTMLElement | null>(null);
  const landingHeroItems = useMemo(() => buildLandingHeroItems(images), [images]);
```

Add the discover CTA callback below `loadRecentCreations`:

```ts
  const scrollToDiscoverHero = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (typeof window === "undefined") {
      return;
    }
    const discoverHero = document.getElementById("cola-discover-hero");
    if (!discoverHero) {
      return;
    }
    discoverHero.scrollIntoView({ behavior, block: "start" });
  }, []);
```

- [ ] **Step 5: Render the landing stack before `DiscoverHome`**

Replace the current discover-mode branch:

```tsx
        {mode === "discover" && (
          <DiscoverHome
            prompt={prompt}
            count={count}
            quality={quality}
            ratio={ratio}
            imageModel={imageModel}
            publicMode={publicMode}
            referenceImage={referenceImage}
            isGenerating={isGenerating}
            stickyVisible={stickyVisible}
            creations={creationFeedStatus === "loading" && images.length === 0 ? [] : creations}
            creationFeedStatus={creationFeedStatus}
            onPromptChange={setPrompt}
            onCountChange={setCount}
            onQualityChange={setQuality}
            onRatioChange={setRatio}
            onImageModelChange={setImageModel}
            onPublicChange={setPublicMode}
            onReferenceFileChange={handleReferenceFileChange}
            onOpenPrompts={openPromptMarket}
            onGenerate={handleGenerate}
            onOpenCreation={setSelectedCreation}
            onUsePrompt={handleUsePrompt}
            onCopyPrompt={handleCopyPrompt}
            onRefreshCreations={loadRecentCreations}
          />
        )}
```

with:

```tsx
        {mode === "discover" && (
          <div
            data-cola-panel="discover-stack"
            data-cola-behavior="landing-to-discover-flow"
            className="relative flex flex-col"
          >
            <ColaAILandingHero
              items={landingHeroItems}
              stageState={landingHeroState}
              heroRef={landingHeroRef}
              onScrollToDiscover={() => scrollToDiscoverHero("smooth")}
            />
            <div data-cola-panel="discover-handoff" className="landing-hero__handoff relative">
              <DiscoverHome
                prompt={prompt}
                count={count}
                quality={quality}
                ratio={ratio}
                imageModel={imageModel}
                publicMode={publicMode}
                referenceImage={referenceImage}
                isGenerating={isGenerating}
                stickyVisible={stickyVisible}
                creations={creationFeedStatus === "loading" && images.length === 0 ? [] : creations}
                creationFeedStatus={creationFeedStatus}
                onPromptChange={setPrompt}
                onCountChange={setCount}
                onQualityChange={setQuality}
                onRatioChange={setRatio}
                onImageModelChange={setImageModel}
                onPublicChange={setPublicMode}
                onReferenceFileChange={handleReferenceFileChange}
                onOpenPrompts={openPromptMarket}
                onGenerate={handleGenerate}
                onOpenCreation={setSelectedCreation}
                onUsePrompt={handleUsePrompt}
                onCopyPrompt={handleCopyPrompt}
                onRefreshCreations={loadRecentCreations}
              />
            </div>
          </div>
        )}
```

- [ ] **Step 6: Run the targeted workbench tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "landing hero"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat(colaai): render landing hero before discover mode"
```

---

### Task 4: Add Scroll Handoff And Landing Hero Motion

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add a failing render marker test for the handoff behavior**

Append this test to `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`:

```tsx
  test("renders the discover handoff markers for landing-to-discover snapping", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);

    expect(markup).toContain('data-cola-behavior="landing-to-discover-flow"');
    expect(markup).toContain('data-cola-panel="discover-handoff"');
    expect(markup).toContain('data-cola-state="idle"');
  });
```

- [ ] **Step 2: Run the handoff test and verify it fails**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "landing-to-discover"
```

Expected: FAIL because the workbench does not yet manage hero exit state or snapping.

- [ ] **Step 3: Add the scroll handoff effect**

In `web/src/app/ColaAI/components/cola-ai-workbench.tsx`, add refs near the landing state:

```ts
  const landingSnapLockRef = useRef(false);
  const lastDiscoverScrollYRef = useRef(0);
```

Add this effect below the existing sticky-composer observer effect:

```ts
  useEffect(() => {
    if (mode !== "discover" || typeof window === "undefined") {
      setLandingHeroState("idle");
      return;
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const updateDiscoverHandoff = () => {
      const hero = landingHeroRef.current;
      const discoverHero = document.getElementById("cola-discover-hero");
      if (!hero || !discoverHero) {
        return;
      }

      const currentScrollY = window.scrollY;
      const goingDown = currentScrollY > lastDiscoverScrollYRef.current;
      lastDiscoverScrollYRef.current = currentScrollY;

      const heroHeight = Math.max(hero.offsetHeight, window.innerHeight);
      const handoffThreshold = Math.round(heroHeight * 0.52);
      const discoverTop = currentScrollY + discoverHero.getBoundingClientRect().top;

      setLandingHeroState(currentScrollY > heroHeight * 0.18 ? "handoff" : "idle");

      if (
        goingDown &&
        !landingSnapLockRef.current &&
        currentScrollY >= handoffThreshold &&
        currentScrollY < discoverTop - 24
      ) {
        landingSnapLockRef.current = true;
        scrollToDiscoverHero(reduceMotion ? "auto" : "smooth");
        window.setTimeout(() => {
          landingSnapLockRef.current = false;
        }, reduceMotion ? 0 : 360);
      }

      if (!goingDown && currentScrollY < heroHeight * 0.28) {
        landingSnapLockRef.current = false;
      }
    };

    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateDiscoverHandoff);
    };

    updateDiscoverHandoff();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [mode, scrollToDiscoverHero]);
```

- [ ] **Step 4: Add landing-specific stage and reduced-motion styles**

Append to `web/src/app/globals.css`:

```css
.landing-hero__stage {
  min-height: clamp(620px, 92vh, 920px);
}

.landing-hero__copy,
.landing-hero__card {
  transition:
    transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 260ms ease,
    box-shadow 260ms ease;
  will-change: transform, opacity;
}

.landing-hero__card {
  position: absolute;
  width: min(24vw, 296px);
}

.landing-hero__card--primary {
  position: relative;
  width: min(34vw, 460px);
  transform: translateY(6px);
}

.landing-hero__media {
  aspect-ratio: 4 / 5;
}

.landing-hero__card--orbit-one {
  left: 2%;
  top: 10%;
  transform: rotate(-11deg);
}

.landing-hero__card--orbit-two {
  right: 4%;
  top: 6%;
  transform: rotate(9deg);
}

.landing-hero__card--orbit-three {
  left: 6%;
  bottom: 4%;
  transform: rotate(7deg);
}

.landing-hero__card--orbit-four {
  right: 6%;
  bottom: 0;
  transform: rotate(-8deg);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__copy {
  opacity: 0.76;
  transform: translateY(-18px);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__card--primary {
  transform: translateY(-12px) scale(0.985);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__card--orbit-one {
  transform: translate3d(-10px, -22px, 0) rotate(-14deg) scale(0.98);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__card--orbit-two {
  transform: translate3d(12px, -24px, 0) rotate(12deg) scale(0.98);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__card--orbit-three {
  transform: translate3d(-8px, -8px, 0) rotate(9deg) scale(0.98);
}

[data-cola-panel="landing-hero"][data-cola-state="handoff"] .landing-hero__card--orbit-four {
  transform: translate3d(10px, -10px, 0) rotate(-10deg) scale(0.98);
}

.landing-hero__handoff {
  position: relative;
  z-index: 10;
}

@media (max-width: 1023px) {
  .landing-hero__stage {
    min-height: auto;
  }

  .landing-hero__card {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: 340px;
    margin-inline: auto;
  }

  .landing-hero__primary-wrap {
    margin-top: 1.75rem;
  }

  .landing-hero__card--orbit-one,
  .landing-hero__card--orbit-two,
  .landing-hero__card--orbit-three,
  .landing-hero__card--orbit-four {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .landing-hero__copy,
  .landing-hero__card {
    transition: none;
  }
}
```

- [ ] **Step 5: Run the targeted tests**

Run:

```bash
cd web
bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "landing-to-discover"
bun test src/app/ColaAI/components/cola-ai-landing-hero.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx web/src/app/globals.css
git commit -m "feat(colaai): add landing to discover handoff motion"
```

---

### Task 5: Full Verification And Browser Polish

**Files:**
- Modify only the files above if verification exposes defects.

- [ ] **Step 1: Run the focused landing integration tests**

Run:

```bash
cd web
bun test \
  src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts \
  src/app/ColaAI/components/cola-ai-landing-hero.test.tsx \
  src/app/ColaAI/components/cola-ai-workbench.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd web
bun run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
cd web
bun run lint
```

Expected: PASS, or only unrelated pre-existing warnings. Fix any new issues in the touched files before continuing.

- [ ] **Step 4: Verify desktop in the browser**

Open `http://127.0.0.1:3000/ColaAI/` and verify:

- the first viewport shows the new landing hero
- the hero shows image cards instead of video elements
- the shared ColaAI background still renders behind the hero
- the CTA scrolls to the discover composer
- downward scroll snaps into the discover page top
- once snapped, the existing discover hero, feed, and sticky composer continue to work

- [ ] **Step 5: Verify mobile in the browser**

Resize to approximately `390x844` and reload `http://127.0.0.1:3000/ColaAI/`.

Verify:

- the hero headline stays readable above the fold
- the primary card remains visible
- orbit cards collapse away without broken whitespace
- bottom navigation does not cover the CTA
- discover handoff still lands cleanly at the discover hero

- [ ] **Step 6: Apply concrete visual fixes if needed**

If a desktop card overlaps the headline, patch the landing card positions in `web/src/app/globals.css`:

```css
.landing-hero__card--orbit-one {
  left: 1%;
  top: 14%;
}
```

If the mobile CTA is covered by bottom navigation, patch the hero bottom spacing in `web/src/app/ColaAI/components/cola-ai-landing-hero.tsx`:

```tsx
className="landing-hero relative z-10 flex min-h-dvh items-center justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-[88px] md:pl-[104px] md:pr-8 md:pt-[44px]"
```

If snapping feels too eager, patch the threshold in `web/src/app/ColaAI/components/cola-ai-workbench.tsx`:

```ts
const handoffThreshold = Math.round(heroHeight * 0.62);
```

- [ ] **Step 7: Re-run tests after any polish fixes**

Run:

```bash
cd web
bun test \
  src/app/ColaAI/components/cola-ai-landing-hero-state.test.ts \
  src/app/ColaAI/components/cola-ai-landing-hero.test.tsx \
  src/app/ColaAI/components/cola-ai-workbench.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Capture verification artifacts**

Save screenshots locally:

- `colaai-landing-hero-desktop.png`
- `colaai-landing-handoff-desktop.png`
- `colaai-landing-mobile.png`

Do not commit screenshots unless the user explicitly asks for them to be tracked.

- [ ] **Step 9: Final commit**

If Step 6 required fixes:

```bash
git add web/src/app/ColaAI/components/cola-ai-landing-hero.tsx web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/globals.css web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "fix(colaai): polish landing hero handoff"
```

If Step 6 required no changes, do not create an empty commit.

---

## Plan Self-Review

Spec coverage:

- New `/ColaAI` opening experience with old-hero composition: Tasks 2, 3, 4.
- Replace hero videos with the latest five managed images: Task 1 and Task 3.
- Keep ColaAI ambient background style: Tasks 2 and 3 preserve `RovaMediaBackground`; Task 4 adds only landing-specific CSS.
- Scroll downward into the existing ColaAI discover page and keep discover as the stable main surface: Tasks 3, 4, 5.
- Preserve existing discover composer/feed/sticky logic: Task 3 keeps `DiscoverHome` in place and only wraps it.
- Desktop and mobile behavior: Tasks 2, 4, 5.
- Reduced-motion handling: Task 4 and Task 5.

Placeholder scan:

- No `TBD`, `TODO`, or “implement later” markers remain.
- Every code-changing step includes concrete code or an exact patch target.
- Verification steps include exact commands and expected outcomes.

Type consistency:

- `LandingHeroItem` is defined in Task 1 and used consistently in Tasks 2 and 3.
- `ColaAILandingHero` is introduced in Task 2 before being imported in Task 3.
- `landingHeroState` uses the same `"idle" | "handoff"` values across Task 2, Task 3, and Task 4.
