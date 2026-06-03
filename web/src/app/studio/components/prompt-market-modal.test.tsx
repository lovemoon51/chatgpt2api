import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PromptMarketEmptyState,
  PromptMarketStats,
  PromptMarketTabs,
  PromptTemplateCard,
  PromptTemplateForm,
} from "./prompt-market-modal";
import type { PromptTemplate, PromptTemplateStats } from "@/lib/api";

const template: PromptTemplate = {
  id: "template-1",
  title: "电影感人像",
  description: "柔和轮廓光，适合头像",
  prompt: "cinematic portrait, soft rim light",
  model: "gpt-image-2",
  size: "1:1",
  count: 2,
  tags: ["人像", "电影感"],
  preview_image: { url: "/images/portrait.png" },
  owner_id: "alice",
  owner_name: "Alice",
  visibility: "public",
  review_status: "approved",
  review_reason: "",
  reviewed_by: "admin",
  reviewed_at: "2026-05-26T00:00:00+00:00",
  created_at: "2026-05-26T00:00:00+00:00",
  updated_at: "2026-05-26T00:00:00+00:00",
  is_favorited: false,
};

const stats: PromptTemplateStats = {
  public: 12,
  private: 3,
  favorites: 8,
  submissions: 1,
  review: 2,
};

describe("PromptMarketModal components", () => {
  test("template card renders preview, metadata, tags, apply, and favorite actions", () => {
    const markup = renderToStaticMarkup(
      <PromptTemplateCard
        template={template}
        activeScope="public"
        darkMode={false}
        isAdmin={false}
        onApply={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onFavorite={() => undefined}
        onReview={() => undefined}
      />,
    );

    expect(markup).toContain("电影感人像");
    expect(markup).toContain("gpt-image-2");
    expect(markup).toContain("1:1");
    expect(markup).toContain("人像");
    expect(markup).toContain("套用");
    expect(markup).toContain("收藏");
  });

  test("review tab is only present for admins", () => {
    const userTabs = renderToStaticMarkup(<PromptMarketTabs activeScope="public" isAdmin={false} onChange={() => undefined} stats={{ public: 0, private: 0, favorites: 0, submissions: 0 }} />);
    const adminTabs = renderToStaticMarkup(<PromptMarketTabs activeScope="review" isAdmin onChange={() => undefined} stats={{ public: 0, private: 0, favorites: 0, submissions: 0, review: 2 }} />);

    expect(userTabs).not.toContain("审核");
    expect(adminTabs).toContain("审核");
  });

  test("compact stats render scope counts as chips", () => {
    const markup = renderToStaticMarkup(<PromptMarketStats stats={stats} isAdmin darkMode={false} />);

    expect(markup).toContain("公共 12");
    expect(markup).toContain("私有 3");
    expect(markup).toContain("收藏 8");
    expect(markup).toContain("投稿 1");
    expect(markup).toContain("待审核 2");
    expect(markup).toContain("data-market-stats=\"chips\"");
  });

  test("empty states are scope aware and private scope offers create action", () => {
    const publicEmpty = renderToStaticMarkup(<PromptMarketEmptyState scope="public" onCreate={() => undefined} />);
    const privateEmpty = renderToStaticMarkup(<PromptMarketEmptyState scope="private" onCreate={() => undefined} />);

    expect(publicEmpty).toContain("暂无公共模板");
    expect(privateEmpty).toContain("暂无私有模板");
    expect(privateEmpty).toContain("新建模板");
  });

  test("form renders grouped sections and intent specific submit label", () => {
    const markup = renderToStaticMarkup(
      <PromptTemplateForm
        values={{
          title: "",
          description: "",
          prompt: "",
          model: "gpt-image-2",
          size: "1:1",
          count: 1,
          tags: [],
          previewImage: { url: "" },
          visibility: "public",
        }}
        darkMode={false}
        editing={false}
        saving={false}
        error=""
        onChange={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(markup).toContain("基础信息");
    expect(markup).toContain("提示词");
    expect(markup).toContain("参数");
    expect(markup).toContain("提交审核");
  });

  test("form exposes a visible top cancel action for create and edit modes", () => {
    const createMarkup = renderToStaticMarkup(
      <PromptTemplateForm
        values={{
          title: "",
          description: "",
          prompt: "",
          model: "gpt-image-2",
          size: "1:1",
          count: 1,
          tags: [],
          previewImage: { url: "" },
          visibility: "private",
        }}
        darkMode={false}
        editing={false}
        saving={false}
        error=""
        onChange={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    const editMarkup = renderToStaticMarkup(
      <PromptTemplateForm
        values={{
          title: "已有模板",
          description: "",
          prompt: "",
          model: "gpt-image-2",
          size: "1:1",
          count: 1,
          tags: [],
          previewImage: { url: "" },
          visibility: "private",
        }}
        darkMode={false}
        editing
        saving={false}
        error=""
        onChange={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(createMarkup).toContain("data-template-form-header=\"true\"");
    expect(createMarkup).toContain("新建模板");
    expect(createMarkup).toContain("取消新建");
    expect(editMarkup).toContain("编辑模板");
    expect(editMarkup).toContain("取消编辑");
  });

  test("form preview is width constrained so empty previews do not dominate the modal", () => {
    const markup = renderToStaticMarkup(
      <PromptTemplateForm
        values={{
          title: "",
          description: "",
          prompt: "",
          model: "gpt-image-2",
          size: "1:1",
          count: 1,
          tags: [],
          previewImage: { url: "" },
          visibility: "private",
        }}
        darkMode={false}
        editing={false}
        saving={false}
        error=""
        onChange={() => undefined}
        onCancel={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(markup).toContain("data-template-preview=\"compact\"");
    expect(markup).toContain("max-w-[220px]");
  });
});
