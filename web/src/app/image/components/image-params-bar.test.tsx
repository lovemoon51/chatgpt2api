import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageParamsBar } from "./image-params-bar";

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, "image-params-bar.tsx"), "utf-8");
const noop = () => {};

describe("ImageParamsBar", () => {
  test("renders core quota, count, ratio, and task status controls", () => {
    const markup = renderToStaticMarkup(
      <ImageParamsBar
        imageCount="1"
        imageSize="1:1"
        availableQuota="100"
        activeTaskCount={3}
        dailyLimit={{ requests: 100, images: 200 }}
        concurrency={5}
        onImageCountChange={noop}
        onImageSizeChange={noop}
      />,
    );

    expect(markup).toContain("剩余额度：100");
    expect(markup).toContain("今日限制：请求 100 / 图片 200");
    expect(markup).toContain("并发：3 / 5");
    expect(markup).toContain("3 个任务");
    expect(markup).toContain("张数");
    expect(markup).toContain('value="1"');
    expect(markup).toContain("比例");
    expect(markup).toContain("1:1 正方形");
  });

  test("renders optional prompt market and optimize actions", () => {
    const markup = renderToStaticMarkup(
      <ImageParamsBar
        imageCount="2"
        imageSize="16:9"
        availableQuota="不限"
        activeTaskCount={0}
        onImageCountChange={noop}
        onImageSizeChange={noop}
        onOpenPromptMarket={noop}
        onOptimizePrompt={noop}
        canOptimizePrompt={false}
      />,
    );

    expect(markup).toContain("市场");
    expect(markup).toContain("优化");
    expect(markup).toContain("disabled");
  });

  test("keeps interactive callbacks wired in the component source", () => {
    expect(source).toContain("onImageCountChange(event.target.value)");
    expect(source).toContain("onImageSizeChange(option.value)");
    expect(source).toContain("onImageSizeChange(size)");
    expect(source).toContain("onOpenPromptMarket");
    expect(source).toContain("onOptimizePrompt");
    expect(source).toContain("setIsSizeMenuOpen((open) => !open)");
    expect(source).toContain("setIsParamsOpen((open) => !open)");
  });
});
