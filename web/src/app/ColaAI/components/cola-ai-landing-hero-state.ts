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

export type LandingHeroStageState = "idle" | "handoff";

export type LandingHeroScrollMotion = {
  progress: number;
  coreProgress: number;
  orbitProgress: number;
  titleProgress: number;
  timelineProgress: number;
  exitProgress: number;
  stageState: LandingHeroStageState;
};

type PublicDiscoverLandingImage = {
  id: string;
  title: string;
  subtitle?: string;
  prompt?: string;
  imageUrl: string;
  imageFallbackUrl?: string;
};

function looksOpaqueGeneratedName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return (
    /^\d{8,}[_-][a-f0-9]{12,}$/.test(normalized) ||
    /^[a-f0-9]{24,}$/.test(normalized) ||
    normalized.split(/[_-]/).every((part) => /^\d+$/.test(part) || /^[a-f0-9]{8,}$/.test(part))
  );
}

function cleanImageName(name: string, index: number) {
  const cleaned = name.replace(/\.[^.]+$/, "").trim();
  if (!cleaned || looksOpaqueGeneratedName(cleaned)) {
    return `最近作品 ${index + 1}`;
  }
  return cleaned;
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

function publicDiscoverImageToLandingItem(image: PublicDiscoverLandingImage, index: number): LandingHeroItem {
  const title = image.title.trim() || `公共精选 ${index + 1}`;
  const subtitle = image.subtitle?.trim() || "ColaAI 公共精选";
  return {
    id: image.id || `public-discover-${index + 1}`,
    title,
    subtitle,
    imageUrl: image.imageUrl,
    imageFallbackUrl: image.imageFallbackUrl,
    alt: `${title} ${subtitle}`,
  };
}

export function buildPublicDiscoverLandingHeroItems(images: PublicDiscoverLandingImage[]): LandingHeroItem[] {
  const mapped = images.slice(0, 5).map(publicDiscoverImageToLandingItem);
  if (mapped.length === 0) {
    return landingHeroFallbackItems;
  }
  if (mapped.length === 5) {
    return mapped;
  }
  return [...mapped, ...landingHeroFallbackItems.slice(0, 5 - mapped.length)];
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function progressBetween(value: number, start: number, end: number) {
  if (end <= start) {
    return value >= end ? 1 : 0;
  }
  return clamp01((value - start) / (end - start));
}

export function getLandingHeroScrollMotion({
  scrollY,
  heroHeight,
  viewportHeight,
}: {
  scrollY: number;
  heroHeight: number;
  viewportHeight: number;
}): LandingHeroScrollMotion {
  const scrollRange = Math.max(heroHeight - viewportHeight, viewportHeight * 0.82, 1);
  const progress = clamp01(scrollY / scrollRange);

  return {
    progress,
    coreProgress: progressBetween(progress, 0, 0.22),
    orbitProgress: progressBetween(progress, 0.08, 0.32),
    titleProgress: progressBetween(progress, 0.23, 0.62),
    timelineProgress: progressBetween(progress, 0.12, 0.56),
    exitProgress: progressBetween(progress, 0.62, 1),
    stageState: progress >= 0.12 ? "handoff" : "idle",
  };
}

export function shouldSnapLandingHeroToDiscover({
  goingDown,
  snapLocked,
  heroScrollY,
  heroHeight,
  viewportHeight,
  discoverViewportTop,
}: {
  goingDown: boolean;
  snapLocked: boolean;
  heroScrollY: number;
  heroHeight: number;
  viewportHeight: number;
  discoverViewportTop: number;
}) {
  if (!goingDown || snapLocked) {
    return false;
  }

  const motion = getLandingHeroScrollMotion({
    scrollY: heroScrollY,
    heroHeight,
    viewportHeight,
  });
  const snapWindowTop = viewportHeight * 0.66;

  return motion.progress >= 0.96 && discoverViewportTop > 0 && discoverViewportTop <= snapWindowTop;
}
