"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Grid2X2, Heart, List, LoaderCircle, Plus, RefreshCw, Search, Send, Sparkles, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createPromptTemplate,
  deletePromptTemplate,
  favoritePromptTemplate,
  fetchPromptTemplateStats,
  fetchPromptTemplates,
  reviewPromptTemplate,
  unfavoritePromptTemplate,
  updatePromptTemplate,
  type PromptTemplate,
  type PromptTemplateApplyPayload,
  type PromptTemplateInput,
  type PromptTemplateScope,
  type PromptTemplateStats,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  buildPromptTemplateApplyPayload,
  createEmptyPromptTemplateValues,
  formatPromptTemplateTags,
  getPromptTemplatePreviewUrl,
  getPromptTemplateStatusLabel,
  parsePromptTemplateTags,
  type PromptTemplateFormValues,
  type PromptTemplateSeed,
} from "./prompt-market-utils";

type DisplayMode = "grid" | "list";
type DensityMode = "comfortable" | "compact";

type PromptMarketModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  darkMode?: boolean;
  createSeed?: PromptTemplateSeed | null;
  onCreateSeedConsumed?: () => void;
  onApplyTemplate: (payload: PromptTemplateApplyPayload) => void;
};

type PromptTemplateCardProps = {
  template: PromptTemplate;
  activeScope: PromptTemplateScope;
  darkMode?: boolean;
  isAdmin: boolean;
  displayMode?: DisplayMode;
  onApply: (template: PromptTemplate) => void;
  onEdit: (template: PromptTemplate) => void;
  onDelete: (template: PromptTemplate) => void;
  onFavorite: (template: PromptTemplate) => void;
  onReview: (template: PromptTemplate, action: "approve" | "reject", reason?: string) => void;
};

type PromptMarketTabsProps = {
  activeScope: PromptTemplateScope;
  isAdmin: boolean;
  stats: PromptTemplateStats;
  onChange: (scope: PromptTemplateScope) => void;
};

const emptyStats: PromptTemplateStats = {
  public: 0,
  private: 0,
  favorites: 0,
  submissions: 0,
};

const scopeTitles: Record<PromptTemplateScope, string> = {
  public: "公共模板",
  private: "我的私有",
  favorites: "我的收藏",
  submissions: "我的投稿",
  review: "审核",
};

const emptyStateMessages: Record<PromptTemplateScope, string> = {
  public: "暂无公共模板",
  private: "暂无私有模板",
  favorites: "还没有收藏模板",
  submissions: "还没有投稿模板",
  review: "暂无待审核模板",
};

function templateInputFromValues(values: PromptTemplateFormValues): PromptTemplateInput {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    prompt: values.prompt.trim(),
    model: values.model.trim() || "gpt-image-2",
    size: values.size.trim() || "1:1",
    count: Math.max(1, Math.min(8, Number(values.count || 1))),
    tags: values.tags,
    preview_image: values.previewImage,
    visibility: values.visibility,
  };
}

export function PromptMarketTabs({ activeScope, isAdmin, stats, onChange }: PromptMarketTabsProps) {
  const tabs: Array<{ scope: PromptTemplateScope; label: string; count: number }> = [
    { scope: "public", label: "公共", count: stats.public },
    { scope: "private", label: "私有", count: stats.private },
    { scope: "favorites", label: "收藏", count: stats.favorites },
    { scope: "submissions", label: "投稿", count: stats.submissions },
  ];
  if (isAdmin) {
    tabs.push({ scope: "review", label: "审核", count: stats.review || 0 });
  }

  return (
    <div className="flex min-w-0 gap-1 overflow-x-auto rounded-full bg-slate-100 p-1 dark:bg-slate-900">
      {tabs.map((tab) => (
        <button
          key={tab.scope}
          type="button"
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium transition",
            activeScope === tab.scope
              ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-500 hover:bg-white/65 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100",
          )}
          onClick={() => onChange(tab.scope)}
        >
          <span>{tab.label}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            {tab.count}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PromptMarketStats({
  stats,
  isAdmin,
  darkMode = false,
}: {
  stats: PromptTemplateStats;
  isAdmin: boolean;
  darkMode?: boolean;
}) {
  const chips = [
    ["公共", stats.public],
    ["私有", stats.private],
    ["收藏", stats.favorites],
    ["投稿", stats.submissions],
  ] as const;

  return (
    <div data-market-stats="chips" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {chips.map(([label, value]) => (
        <span
          key={label}
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-2.5 text-xs font-medium",
            darkMode ? "border-slate-800 bg-slate-900 text-slate-300" : "border-slate-200 bg-white text-slate-600",
          )}
        >
          {label} {value}
        </span>
      ))}
      {isAdmin ? (
        <span
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-2.5 text-xs font-medium",
            darkMode ? "border-blue-900/60 bg-blue-950/35 text-blue-200" : "border-blue-200 bg-blue-50 text-blue-700",
          )}
        >
          待审核 {stats.review || 0}
        </span>
      ) : null}
    </div>
  );
}

export function PromptMarketEmptyState({
  scope,
  darkMode = false,
  onCreate,
}: {
  scope: PromptTemplateScope;
  darkMode?: boolean;
  onCreate: () => void;
}) {
  const canCreate = scope === "private";

  return (
    <div
      className={cn(
        "grid min-h-56 place-items-center rounded-2xl border border-dashed px-4 text-center",
        darkMode ? "border-slate-800 bg-slate-950/35 text-slate-400" : "border-slate-300 bg-white/55 text-slate-500",
      )}
    >
      <div>
        <Sparkles className="mx-auto mb-3 size-8 text-slate-400" />
        <div className="font-medium">{emptyStateMessages[scope]}</div>
        {canCreate ? (
          <Button type="button" size="sm" className="mt-4 rounded-full" onClick={onCreate}>
            <Plus className="size-4" />
            新建模板
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PromptTemplateCard({
  template,
  activeScope,
  darkMode = false,
  isAdmin,
  displayMode = "grid",
  onApply,
  onEdit,
  onDelete,
  onFavorite,
  onReview,
}: PromptTemplateCardProps) {
  const previewUrl = getPromptTemplatePreviewUrl(template);
  const isList = displayMode === "list";
  const canReview = isAdmin && activeScope === "review";
  const canManage = activeScope === "private" || activeScope === "submissions" || (isAdmin && activeScope === "review");

  const handleReject = () => {
    const reason = typeof window === "undefined" ? "" : window.prompt("请输入驳回原因") || "";
    onReview(template, "reject", reason);
  };

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        darkMode ? "border-slate-800 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-950",
        isList && "grid gap-0 sm:grid-cols-[220px_1fr]",
      )}
    >
      <div className={cn("relative bg-slate-100 dark:bg-slate-800", isList ? "min-h-48 sm:min-h-full" : "aspect-[4/3]")}>
        {previewUrl ? (
          <AuthenticatedImage src={previewUrl} alt={template.title} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full min-h-48 place-items-center text-slate-400">
            <Sparkles className="size-8" />
          </div>
        )}
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm dark:bg-slate-950/90 dark:text-slate-200">
            {getPromptTemplateStatusLabel(template.review_status)}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 text-base font-semibold leading-6">{template.title}</h3>
            <button
              type="button"
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-full border transition",
                template.is_favorited
                  ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/45 dark:text-rose-200"
                  : "border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200",
              )}
              onClick={() => onFavorite(template)}
              aria-label={template.is_favorited ? "取消收藏" : "收藏"}
              title={template.is_favorited ? "取消收藏" : "收藏"}
            >
              <Heart className={cn("size-4", template.is_favorited && "fill-current")} />
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {template.owner_name || "未知作者"} · {template.model} · {template.size || "auto"} · {template.count} 张
          </div>
        </div>

        {template.description ? (
          <p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{template.description}</p>
        ) : (
          <p className="line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{template.prompt}</p>
        )}

        {template.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {template.tags.slice(0, 5).map((tag) => (
              <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {template.review_status === "rejected" && template.review_reason ? (
          <div className="rounded-2xl bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:bg-rose-950/35 dark:text-rose-200">
            {template.review_reason}
          </div>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" size="sm" className="rounded-full" onClick={() => onApply(template)}>
            <Sparkles className="size-4" />
            套用
          </Button>
          {canManage ? (
            <>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => onEdit(template)}>
                <Edit3 className="size-4" />
                编辑
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => onDelete(template)} aria-label="删除模板">
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : null}
          {canReview ? (
            <>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => onReview(template, "approve")}>
                <Check className="size-4" />
                通过
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={handleReject}>
                <XCircle className="size-4" />
                驳回
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function PromptTemplateForm({
  values,
  darkMode,
  editing,
  saving,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  values: PromptTemplateFormValues;
  darkMode: boolean;
  editing: boolean;
  saving: boolean;
  error: string;
  onChange: (values: PromptTemplateFormValues) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const previewUrl = values.previewImage.thumbnail_url || values.previewImage.url || "";
  const fieldClass = darkMode ? "border-slate-700 bg-slate-900 text-slate-100" : "";
  const title = editing ? "编辑模板" : "新建模板";
  const cancelLabel = editing ? "取消编辑" : "取消新建";

  return (
    <div className={cn("border-b px-5 py-4 sm:px-6", darkMode ? "border-slate-800 bg-slate-950" : "border-slate-200 bg-white")}>
      <div data-template-form-header="true" className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</div>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onCancel}>
          <X className="size-4" />
          {cancelLabel}
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div
          data-template-preview="compact"
          className="w-full max-w-[220px] overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-900"
        >
          {previewUrl ? (
            <AuthenticatedImage src={previewUrl} alt="模板预览" className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="grid aspect-[4/3] place-items-center text-slate-400">
              <Sparkles className="size-8" />
            </div>
          )}
        </div>
        <div className="grid gap-4">
          <section className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">基础信息</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={values.title}
                onChange={(event) => onChange({ ...values, title: event.target.value })}
                placeholder="模板标题"
                className={cn("rounded-xl", fieldClass)}
              />
              <Input
                value={formatPromptTemplateTags(values.tags)}
                onChange={(event) => onChange({ ...values, tags: parsePromptTemplateTags(event.target.value) })}
                placeholder="标签，用逗号或空格分隔"
                className={cn("rounded-xl", fieldClass)}
              />
            </div>
            <Input
              value={values.description}
              onChange={(event) => onChange({ ...values, description: event.target.value })}
              placeholder="简短描述"
              className={cn("rounded-xl", fieldClass)}
            />
          </section>

          <section className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">提示词</div>
            <Textarea
              value={values.prompt}
              onChange={(event) => onChange({ ...values, prompt: event.target.value })}
              placeholder="提示词"
              className={cn("min-h-24 rounded-xl", fieldClass)}
            />
          </section>

          <section className="grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">参数</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Input
                value={values.model}
                onChange={(event) => onChange({ ...values, model: event.target.value })}
                placeholder="模型"
                className={cn("rounded-xl", fieldClass)}
              />
              <Input
                value={values.size}
                onChange={(event) => onChange({ ...values, size: event.target.value })}
                placeholder="比例"
                className={cn("rounded-xl", fieldClass)}
              />
              <Input
                type="number"
                min={1}
                max={8}
                value={values.count}
                onChange={(event) => onChange({ ...values, count: Math.max(1, Math.min(8, Number(event.target.value) || 1)) })}
                className={cn("rounded-xl", fieldClass)}
              />
              <select
                value={values.visibility}
                onChange={(event) => onChange({ ...values, visibility: event.target.value === "public" ? "public" : "private" })}
                className={cn(
                  "h-11 rounded-xl border border-input bg-white/90 px-4 text-sm shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-stone-200/80",
                  fieldClass,
                )}
              >
                <option value="private">私有保存</option>
                <option value="public">投稿审核</option>
              </select>
            </div>
          </section>

          {error ? <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-950/35 dark:text-rose-200">{error}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={onCancel}>
              取消
            </Button>
            <Button type="button" className="rounded-full" onClick={onSubmit} disabled={saving}>
              {saving ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {editing ? "保存修改" : values.visibility === "public" ? "提交审核" : "保存私有"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PromptMarketModal({
  open,
  onOpenChange,
  isAdmin,
  darkMode = false,
  createSeed,
  onCreateSeedConsumed,
  onApplyTemplate,
}: PromptMarketModalProps) {
  const [activeScope, setActiveScope] = useState<PromptTemplateScope>("public");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("grid");
  const [density, setDensity] = useState<DensityMode>("comfortable");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PromptTemplate[]>([]);
  const [stats, setStats] = useState<PromptTemplateStats>(emptyStats);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [formValues, setFormValues] = useState<PromptTemplateFormValues>(() => createEmptyPromptTemplateValues());

  const effectiveScope = activeScope === "review" && !isAdmin ? "public" : activeScope;

  const loadMarket = useCallback(async () => {
    if (!open) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [nextStats, list] = await Promise.all([
        fetchPromptTemplateStats(),
        fetchPromptTemplates({ scope: effectiveScope, q: query.trim() }),
      ]);
      setStats(nextStats);
      setItems(list.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取提示词库失败");
    } finally {
      setLoading(false);
    }
  }, [effectiveScope, open, query]);

  useEffect(() => {
    void loadMarket();
  }, [loadMarket]);

  useEffect(() => {
    if (!open || !createSeed) {
      return;
    }
    setFormValues(createEmptyPromptTemplateValues(createSeed));
    setEditingTemplate(null);
    setFormError("");
    setFormOpen(true);
    setActiveScope("private");
    onCreateSeedConsumed?.();
  }, [createSeed, onCreateSeedConsumed, open]);

  const openNewForm = () => {
    setFormValues(createEmptyPromptTemplateValues());
    setEditingTemplate(null);
    setFormError("");
    setFormOpen(true);
  };

  const openEditForm = (template: PromptTemplate) => {
    setFormValues({
      title: template.title,
      description: template.description,
      prompt: template.prompt,
      model: template.model,
      size: template.size,
      count: template.count,
      tags: template.tags,
      previewImage: template.preview_image,
      visibility: template.visibility,
    });
    setEditingTemplate(template);
    setFormError("");
    setFormOpen(true);
  };

  const submitForm = async () => {
    const payload = templateInputFromValues(formValues);
    if (!payload.title || !payload.prompt) {
      setFormError("标题和提示词不能为空");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingTemplate) {
        await updatePromptTemplate(editingTemplate.id, payload);
        toast.success("模板已更新");
      } else {
        await createPromptTemplate(payload);
        toast.success(payload.visibility === "public" ? "已提交审核" : "已保存私有");
      }
      setFormOpen(false);
      setEditingTemplate(null);
      await loadMarket();
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "保存模板失败");
    } finally {
      setSaving(false);
    }
  };

  const handleApply = (template: PromptTemplate) => {
    onApplyTemplate(buildPromptTemplateApplyPayload(template));
    onOpenChange(false);
  };

  const handleFavorite = async (template: PromptTemplate) => {
    try {
      const result = template.is_favorited ? await unfavoritePromptTemplate(template.id) : await favoritePromptTemplate(template.id);
      setItems((current) => current.map((item) => (item.id === template.id ? { ...item, ...result.item } : item)));
      void fetchPromptTemplateStats().then(setStats, () => undefined);
    } catch (favoriteError) {
      toast.error(favoriteError instanceof Error ? favoriteError.message : "收藏操作失败");
    }
  };

  const handleDelete = async (template: PromptTemplate) => {
    const confirmed = typeof window === "undefined" ? true : window.confirm(`删除模板「${template.title}」？`);
    if (!confirmed) {
      return;
    }
    try {
      await deletePromptTemplate(template.id);
      toast.success("模板已删除");
      await loadMarket();
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : "删除模板失败");
    }
  };

  const handleReview = async (template: PromptTemplate, action: "approve" | "reject", reason = "") => {
    if (action === "reject" && !reason.trim()) {
      toast.error("驳回需要填写原因");
      return;
    }
    try {
      await reviewPromptTemplate(template.id, { action, reason });
      toast.success(action === "approve" ? "已通过审核" : "已驳回投稿");
      await loadMarket();
    } catch (reviewError) {
      toast.error(reviewError instanceof Error ? reviewError.message : "审核失败");
    }
  };

  const gridClass = useMemo(() => {
    if (displayMode === "list") {
      return "grid gap-4";
    }
    return cn(
      "grid gap-4",
      density === "compact" ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 xl:grid-cols-3",
    );
  }, [density, displayMode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(90dvh,820px)] w-[min(96vw,1180px)] flex-col gap-0 overflow-hidden rounded-2xl p-0",
          darkMode ? "border-slate-800 bg-slate-950 text-slate-100" : "border-white/80 bg-[#f6f8fb] text-slate-950",
        )}
      >
        <DialogHeader
          className={cn(
            "shrink-0 border-b px-5 py-4 sm:px-6",
            darkMode ? "border-slate-800 bg-slate-900/85" : "border-slate-200/70 bg-white/85",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="size-5 text-blue-500" />
                提示词库
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                套用模板只会填入当前作画提示词、模型、比例和张数。
              </DialogDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" className="rounded-full" onClick={() => void loadMarket()} disabled={loading}>
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                刷新
              </Button>
              <Button type="button" className="rounded-full" onClick={openNewForm}>
                <Plus className="size-4" />
                新建模板
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="shrink-0 px-5 py-3 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
              <PromptMarketTabs activeScope={effectiveScope} isAdmin={isAdmin} stats={stats} onChange={setActiveScope} />
              <PromptMarketStats stats={stats} isAdmin={isAdmin} darkMode={darkMode} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className={cn(
                  "flex h-9 min-w-0 flex-1 basis-full items-center gap-2 rounded-full border px-3 sm:basis-auto",
                  darkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white",
                )}
              >
                <Search className="size-4 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`搜索${scopeTitles[effectiveScope]}`}
                  className="h-full w-full bg-transparent text-sm outline-none placeholder:text-slate-400 sm:w-52"
                />
              </label>
              <div className="inline-flex h-9 rounded-full bg-slate-100 p-1 dark:bg-slate-900">
                <button
                  type="button"
                  className={cn("grid size-7 place-items-center rounded-full", displayMode === "grid" ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-slate-100" : "text-slate-500")}
                  onClick={() => setDisplayMode("grid")}
                  aria-label="网格显示"
                >
                  <Grid2X2 className="size-4" />
                </button>
                <button
                  type="button"
                  className={cn("grid size-7 place-items-center rounded-full", displayMode === "list" ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-slate-100" : "text-slate-500")}
                  onClick={() => setDisplayMode("list")}
                  aria-label="列表显示"
                >
                  <List className="size-4" />
                </button>
              </div>
              <select
                value={density}
                onChange={(event) => setDensity(event.target.value === "compact" ? "compact" : "comfortable")}
                className={cn("h-9 rounded-full border px-3 text-sm outline-none", darkMode ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white")}
              >
                <option value="comfortable">舒展</option>
                <option value="compact">紧凑</option>
              </select>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {formOpen ? (
            <PromptTemplateForm
              values={formValues}
              darkMode={darkMode}
              editing={Boolean(editingTemplate)}
              saving={saving}
              error={formError}
              onChange={setFormValues}
              onCancel={() => {
                setFormOpen(false);
                setEditingTemplate(null);
              }}
              onSubmit={() => void submitForm()}
            />
          ) : null}

          <div className="px-5 pb-5 sm:px-6">
            {error ? (
              <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-200">
                <div>{error}</div>
                <Button type="button" variant="outline" className="mt-3 rounded-full" onClick={() => void loadMarket()}>
                  重试
                </Button>
              </div>
            ) : loading ? (
              <div className="grid min-h-60 place-items-center text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <LoaderCircle className="size-5 animate-spin" />
                  正在读取提示词库
                </div>
              </div>
            ) : items.length === 0 ? (
              <PromptMarketEmptyState scope={effectiveScope} darkMode={darkMode} onCreate={openNewForm} />
            ) : (
              <div className={gridClass}>
                {items.map((template) => (
                  <PromptTemplateCard
                    key={template.id}
                    template={template}
                    activeScope={effectiveScope}
                    darkMode={darkMode}
                    isAdmin={isAdmin}
                    displayMode={displayMode}
                    onApply={handleApply}
                    onEdit={openEditForm}
                    onDelete={(item) => void handleDelete(item)}
                    onFavorite={(item) => void handleFavorite(item)}
                    onReview={(item, action, reason) => void handleReview(item, action, reason)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
