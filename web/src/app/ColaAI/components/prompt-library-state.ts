import type { PromptTemplate, PromptTemplateScope, PromptTemplateStats } from "@/lib/api";

export type TagCount = { tag: string; count: number };

export const PAGE_SIZE = 20;

export const SCOPE_LABELS: Record<PromptTemplateScope, string> = {
  public: "公共",
  private: "我的私有",
  favorites: "我的收藏",
  submissions: "我的投稿",
  review: "审核",
};

export function aggregateTagCounts(items: PromptTemplate[], limit = 12): TagCount[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      const normalized = tag.trim();
      if (normalized) {
        freq.set(normalized, (freq.get(normalized) ?? 0) + 1);
      }
    }
  }
  return Array.from(freq.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function paginateItems<T>(items: T[], page: number, pageSize = PAGE_SIZE): T[] {
  return items.slice(0, page * pageSize);
}

export function filterByTag(items: PromptTemplate[], tag: string): PromptTemplate[] {
  if (!tag) return items;
  return items.filter((item) => item.tags.includes(tag));
}

export function getTotalPublicCount(stats: PromptTemplateStats): number {
  return stats.public;
}

export function getScopeCount(stats: PromptTemplateStats, scope: PromptTemplateScope): number {
  if (scope === "review") return stats.review ?? 0;
  return stats[scope] ?? 0;
}
