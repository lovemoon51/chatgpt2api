import { describe, expect, test } from "bun:test";

import type { PromptTemplate, PromptTemplateStats } from "@/lib/api";
import {
  aggregateTagCounts,
  filterByTag,
  getScopeCount,
  paginateItems,
  PAGE_SIZE,
} from "./prompt-library-state";

function createTemplate(id: string, tags: string[]): PromptTemplate {
  return {
    id,
    title: id,
    description: "",
    prompt: "",
    model: "gpt-image-2",
    size: "1:1",
    count: 1,
    tags,
    preview_image: { url: "" },
    owner_id: "u1",
    owner_name: "user",
    visibility: "public",
    review_status: "approved",
    created_at: "",
    updated_at: "",
  };
}

describe("aggregateTagCounts", () => {
  test("counts tag frequency and sorts desc", () => {
    const items = [
      createTemplate("a", ["portrait", "product"]),
      createTemplate("b", ["portrait", "ui"]),
      createTemplate("c", ["portrait"]),
      createTemplate("d", ["product"]),
    ];
    expect(aggregateTagCounts(items)).toEqual([
      { tag: "portrait", count: 3 },
      { tag: "product", count: 2 },
      { tag: "ui", count: 1 },
    ]);
  });

  test("limits the result to top N", () => {
    const items = Array.from({ length: 20 }, (_, i) => createTemplate(String(i), [`tag-${i}`]));
    expect(aggregateTagCounts(items, 5)).toHaveLength(5);
  });

  test("ignores blank tags", () => {
    const items = [createTemplate("a", ["", " ", "ui"])];
    expect(aggregateTagCounts(items)).toEqual([{ tag: "ui", count: 1 }]);
  });
});

describe("filterByTag", () => {
  test("returns all when tag is empty", () => {
    const items = [createTemplate("a", ["x"]), createTemplate("b", ["y"])];
    expect(filterByTag(items, "")).toHaveLength(2);
  });

  test("filters by exact tag match", () => {
    const items = [
      createTemplate("a", ["portrait"]),
      createTemplate("b", ["product"]),
      createTemplate("c", ["portrait", "product"]),
    ];
    expect(filterByTag(items, "portrait").map((item) => item.id)).toEqual(["a", "c"]);
  });
});

describe("paginateItems", () => {
  test("returns first page * pageSize items", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(paginateItems(items, 1, 20)).toHaveLength(20);
    expect(paginateItems(items, 2, 20)).toHaveLength(40);
    expect(paginateItems(items, 3, 20)).toHaveLength(50);
  });

  test("uses default page size", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    expect(paginateItems(items, 1)).toHaveLength(PAGE_SIZE);
  });
});

describe("getScopeCount", () => {
  const stats: PromptTemplateStats = { public: 10, private: 3, favorites: 4, submissions: 2, review: 5 };

  test("returns scope value", () => {
    expect(getScopeCount(stats, "public")).toBe(10);
    expect(getScopeCount(stats, "favorites")).toBe(4);
    expect(getScopeCount(stats, "review")).toBe(5);
  });

  test("returns 0 when review missing", () => {
    expect(getScopeCount({ public: 1, private: 0, favorites: 0, submissions: 0 }, "review")).toBe(0);
  });
});
