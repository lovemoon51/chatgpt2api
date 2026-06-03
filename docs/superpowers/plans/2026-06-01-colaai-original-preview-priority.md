# ColaAI Original Preview Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ColaAI work-preview surfaces prefer original images while keeping prompt-template cover cards on thumbnail-first behavior.

**Architecture:** Add a shared preview-priority helper in the image utility layer, then route ColaAI work-preview surfaces through the new helper while leaving template-cover selection explicit and thumbnail-first. Keep existing fallback behavior so original-image failures can still degrade gracefully.

**Tech Stack:** Next.js, React, TypeScript, Bun test

---

### Task 1: Add preview-priority helper coverage

**Files:**
- Create: `web/src/lib/image-fetch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "bun:test";

import {
  getPreferredPreviewUrl,
  getPreviewFallbackUrl,
} from "./image-fetch";

describe("image preview priority helpers", () => {
  test("preferOriginal uses original image before thumbnail", () => {
    expect(getPreferredPreviewUrl({
      url: "/images/original.png",
      thumbnail_url: "/image-thumbnails/original.png",
    }, "preferOriginal")).toBe("/images/original.png");
  });

  test("preferOriginal falls back to thumbnail when original is missing", () => {
    expect(getPreferredPreviewUrl({
      thumbnail_url: "/image-thumbnails/original.png",
    }, "preferOriginal")).toBe("/image-thumbnails/original.png");
  });

  test("preferThumbnail keeps template covers on thumbnail first", () => {
    expect(getPreferredPreviewUrl({
      url: "/images/original.png",
      thumbnail_url: "/image-thumbnails/original.png",
    }, "preferThumbnail")).toBe("/image-thumbnails/original.png");
  });

  test("preferOriginal uses thumbnail as fallback source when original is selected", () => {
    expect(getPreviewFallbackUrl({
      url: "/images/original.png",
      thumbnail_url: "/image-thumbnails/original.png",
    }, "preferOriginal")).toBe("/image-thumbnails/original.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./src/lib/image-fetch.test.ts`
Expected: FAIL because `getPreferredPreviewUrl` and `getPreviewFallbackUrl` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type PreviewPriority = "preferOriginal" | "preferThumbnail";

export function getPreferredPreviewUrl(image: PreviewImageSource, priority: PreviewPriority) {
  // choose the first available URL based on priority
}

export function getPreviewFallbackUrl(image: PreviewImageSource, priority: PreviewPriority) {
  // choose the next-best fallback URL for the selected priority
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./src/lib/image-fetch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/image-fetch.ts web/src/lib/image-fetch.test.ts
git commit -m "feat: add preview priority helpers"
```

### Task 2: Switch recent creations to original-first previews

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
test("uses original images for recent creations before thumbnails", () => {
  const markup = renderToStaticMarkup(
    <CreationFeed
      creations={[{
        id: "recent-image-1",
        title: "最近创作 1",
        subtitle: "1024 x 1024",
        prompt: "复用这张作品的视觉风格继续创作。",
        imageUrl: "/images/original.png",
        imageFallbackUrl: "/image-thumbnails/original.png",
      }]}
      onOpen={() => undefined}
      onUsePrompt={() => undefined}
      onCopyPrompt={() => undefined}
    />,
  );

  expect(markup).toContain('src="/images/original.png"');
  expect(markup).toContain("image-thumbnails/original.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx --test-name-pattern "uses original images for recent creations before thumbnails"`
Expected: FAIL because recent creation items do not expose a fallback field and `CreationFeed` does not pass one.

- [ ] **Step 3: Write minimal implementation**

```ts
type CreationItem = {
  // ...
  imageUrl: string;
  imageFallbackUrl?: string;
};

function buildCreations(images: ManagedImage[]) {
  return images.slice(0, 12).map((image, index) => ({
    // ...
    imageUrl: getPreferredPreviewUrl(image, "preferOriginal"),
    imageFallbackUrl: getPreviewFallbackUrl(image, "preferOriginal"),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx --test-name-pattern "uses original images for recent creations before thumbnails"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat: prefer originals in recent creations"
```

### Task 3: Switch assets workspace cards to original-first previews

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("uses original images in the assets workspace before thumbnails", () => {
  const markup = renderToStaticMarkup(
    <AssetsWorkspace
      images={[{
        rel: "image-1.png",
        name: "image-1.png",
        date: "2026-06-01",
        size: 123,
        url: "/images/original.png",
        thumbnail_url: "/image-thumbnails/original.png",
        created_at: "2026-06-01T00:00:00Z",
      }]}
      creations={[]}
      onOpenCreation={() => undefined}
      onCopyImage={() => undefined}
      onDownloadImage={() => undefined}
    />,
  );

  expect(markup).toContain('src="/images/original.png"');
  expect(markup).toContain("image-thumbnails/original.png");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx --test-name-pattern "uses original images in the assets workspace before thumbnails"`
Expected: FAIL because the assets workspace still prefers `thumbnail_url`.

- [ ] **Step 3: Write minimal implementation**

```ts
<AuthenticatedImage
  src={getPreferredPreviewUrl(image, "preferOriginal")}
  fallbackSrc={getPreviewFallbackUrl(image, "preferOriginal")}
  alt={image.name}
  className="h-full w-full object-cover"
  loadingMotion="static"
/>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx --test-name-pattern "uses original images in the assets workspace before thumbnails"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat: prefer originals in assets previews"
```

### Task 4: Preserve template-cover thumbnail behavior and verify broader ColaAI coverage

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Keep template cards explicit about thumbnail-first behavior**

```ts
previewUrl: getPreferredPreviewUrl(previewImage, "preferThumbnail"),
previewFallbackUrl: getPreviewFallbackUrl(previewImage, "preferThumbnail"),
```

- [ ] **Step 2: Run the existing prompt-template fallback test**

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx --test-name-pattern "falls back to the original prompt template preview when a thumbnail is present"`
Expected: PASS and still uses thumbnail as the primary card image.

- [ ] **Step 3: Run focused regression coverage**

Run: `bun test ./src/lib/image-fetch.test.ts`
Expected: PASS

Run: `bun test ./src/app/ColaAI/components/cola-ai-workbench.test.tsx`
Expected: PASS, or only unrelated pre-existing failures are reported explicitly.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/image-fetch.ts web/src/lib/image-fetch.test.ts web/src/app/ColaAI/components/cola-ai-workbench.tsx web/src/app/ColaAI/components/cola-ai-workbench.test.tsx
git commit -m "feat: prioritize original work previews in colaai"
```
