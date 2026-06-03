import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const pageSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf-8");

describe("ImageManagerPage public visibility controls", () => {
  test("renders controls that publish or unpublish the current filtered gallery", () => {
    expect(pageSource).toContain("updateManagedImagesPublicVisibility");
    expect(pageSource).toContain('handleUpdateFilteredPublicVisibility(true)');
    expect(pageSource).toContain('handleUpdateFilteredPublicVisibility(false)');
    expect(pageSource).toContain("公开筛选结果");
    expect(pageSource).toContain("取消公开筛选结果");
  });

  test("sends the current filters instead of selected page rows", () => {
    expect(pageSource).toContain("start_date: startDate");
    expect(pageSource).toContain("end_date: endDate");
    expect(pageSource).toContain("q: query.trim()");
    expect(pageSource).toContain("tags: selectedTags");
    expect(pageSource).not.toContain("publicVisibilityMode");
  });
});
