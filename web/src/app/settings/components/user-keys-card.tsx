"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Copy, KeyRound, LoaderCircle, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createUserKey, deleteUserKey, fetchUserKeys, updateUserKey, type UserKey, type UserKeyCreateResult, type UserKeyLimits } from "@/lib/api";

type LimitsForm = {
  imagesTotal: string;
  imagesUsed: string;
  concurrency: string;
  models: string;
};

const emptyLimitsForm: LimitsForm = {
  imagesTotal: "",
  imagesUsed: "",
  concurrency: "",
  models: "",
};

const pageSizeOptions = ["10", "20", "50"] as const;

type StatusFilter = "all" | "enabled" | "disabled";
type BalanceFilter = "all" | "available" | "depleted" | "unlimited";

function limitsToForm(limits?: UserKeyLimits | null): LimitsForm {
  const imagesTotal = limits?.images_total ?? limits?.images_per_day;
  return {
    imagesTotal: imagesTotal == null ? "" : String(imagesTotal),
    imagesUsed: limits?.images_used == null ? "" : String(limits.images_used),
    concurrency: limits?.concurrency == null ? "" : String(limits.concurrency),
    models: Array.isArray(limits?.models) ? limits.models.join(", ") : "",
  };
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function formToLimits(form: LimitsForm): UserKeyLimits {
  return {
    images_total: parseOptionalNumber(form.imagesTotal),
    images_used: parseOptionalNumber(form.imagesUsed),
    concurrency: parseOptionalNumber(form.concurrency),
    models: form.models
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean),
  };
}

function sameLimits(a?: UserKeyLimits | null, b?: UserKeyLimits | null) {
  const left = {
    ...formToLimits(limitsToForm(a)),
    models: [...(a?.models || [])].filter(Boolean).sort(),
  };
  const right = {
    ...formToLimits(limitsToForm(b)),
    models: [...(b?.models || [])].filter(Boolean).sort(),
  };
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatLimitValue(value?: number | null) {
  return value == null ? "不限" : String(value);
}

function formatBalance(limits?: UserKeyLimits | null) {
  return limits?.images_remaining == null ? "不限" : String(limits.images_remaining);
}

function formatModels(models?: string[]) {
  const normalized = Array.isArray(models) ? models.filter(Boolean) : [];
  return normalized.length > 0 ? normalized.join(", ") : "不限";
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function userMatchesSearch(item: UserKey, searchQuery: string) {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  return [
    item.id,
    item.name,
    item.email,
    item.last_login_ip,
    item.last_used_at,
    item.created_at,
    item.updated_at,
    ...(item.limits?.models || []),
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function userMatchesBalanceFilter(item: UserKey, balanceFilter: BalanceFilter) {
  const remaining = item.limits?.images_remaining;
  if (balanceFilter === "all") {
    return true;
  }
  if (balanceFilter === "unlimited") {
    return remaining == null;
  }
  if (balanceFilter === "available") {
    return remaining != null && remaining > 0;
  }
  return remaining != null && remaining <= 0;
}

export function UserKeysCard() {
  const didLoadRef = useRef(false);
  const [items, setItems] = useState<UserKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [count, setCount] = useState("1");
  const [isCreating, setIsCreating] = useState(false);
  const [limitsForm, setLimitsForm] = useState<LimitsForm>(emptyLimitsForm);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [revealedKeys, setRevealedKeys] = useState<UserKeyCreateResult[]>([]);
  const [deletingItem, setDeletingItem] = useState<UserKey | null>(null);
  const [editingItem, setEditingItem] = useState<UserKey | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editKey, setEditKey] = useState("");
  const [editLimitsForm, setEditLimitsForm] = useState<LimitsForm>(emptyLimitsForm);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>("all");
  const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>("10");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "enabled" && item.enabled) ||
        (statusFilter === "disabled" && !item.enabled);
      return statusMatches && userMatchesBalanceFilter(item, balanceFilter) && userMatchesSearch(item, searchQuery);
    });
  }, [balanceFilter, items, searchQuery, statusFilter]);

  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / numericPageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = (safeCurrentPage - 1) * numericPageSize;
  const paginatedItems = filteredItems.slice(pageStartIndex, pageStartIndex + numericPageSize);
  const visibleStart = filteredItems.length === 0 ? 0 : pageStartIndex + 1;
  const visibleEnd = Math.min(pageStartIndex + paginatedItems.length, filteredItems.length);
  const hasActiveFilters = Boolean(searchQuery.trim()) || statusFilter !== "all" || balanceFilter !== "all";

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUserKeys();
      setItems(data.items);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载访问码失败");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void load();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [balanceFilter, pageSize, searchQuery, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const createCount = Math.max(1, Math.min(200, parseOptionalNumber(count) ?? 1));
      const data = await createUserKey(name.trim(), formToLimits(limitsForm), createCount);
      setItems(data.items);
      setRevealedKeys(data.keys?.length ? data.keys : [{ item: data.item, key: data.key, name: data.item.name }]);
      setName("");
      setCount("1");
      setLimitsForm(emptyLimitsForm);
      setCurrentPage(1);
      setIsDialogOpen(false);
      toast.success(createCount > 1 ? "访问码已批量生成" : "访问码已生成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "生成访问码失败");
    } finally {
      setIsCreating(false);
    }
  };

  const setItemPending = (id: string, isPending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (isPending) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleToggle = async (item: UserKey) => {
    setItemPending(item.id, true);
    try {
      const data = await updateUserKey(item.id, { enabled: !item.enabled });
      setItems(data.items);
      toast.success(item.enabled ? "访问码已禁用" : "访问码已启用");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新访问码失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const handleDelete = async () => {
    if (!deletingItem) {
      return;
    }
    const item = deletingItem;
    setItemPending(item.id, true);
    try {
      const data = await deleteUserKey(item.id);
      setItems(data.items);
      setDeletingItem(null);
      toast.success("访问码已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除访问码失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const openEditDialog = (item: UserKey) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditEmail(item.email || "");
    setEditKey("");
    setEditLimitsForm(limitsToForm(item.limits));
  };

  const handleEdit = async () => {
    if (!editingItem) {
      return;
    }
    const item = editingItem;
    const trimmedName = editName.trim();
    const trimmedEmail = editEmail.trim();
    const trimmedKey = editKey.trim();
    const nextLimits = formToLimits(editLimitsForm);
    const limitsChanged = !sameLimits(item.limits, nextLimits);
    if (trimmedName === item.name && trimmedEmail === (item.email || "") && !trimmedKey && !limitsChanged) {
      setEditingItem(null);
      return;
    }
    setItemPending(item.id, true);
    try {
      const data = await updateUserKey(item.id, {
        ...(trimmedName !== item.name ? { name: trimmedName } : {}),
        ...(trimmedEmail !== (item.email || "") ? { email: trimmedEmail } : {}),
        ...(trimmedKey ? { key: trimmedKey } : {}),
        ...(limitsChanged ? { limits: nextLimits } : {}),
      });
      setItems(data.items);
      setEditingItem(null);
      setEditKey("");
      toast.success(trimmedKey ? "访问码已更新" : "用户信息已更新");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新访问码失败");
    } finally {
      setItemPending(item.id, false);
    }
  };

  const updateLimitsForm = (key: keyof LimitsForm, value: string) => {
    setLimitsForm((current) => ({ ...current, [key]: value }));
  };

  const updateEditLimitsForm = (key: keyof LimitsForm, value: string) => {
    setEditLimitsForm((current) => ({ ...current, [key]: value }));
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("已复制到剪贴板");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleCopyAll = async () => {
    const allKeys = revealedKeys.map((item) => item.key).filter(Boolean).join("\n");
    if (!allKeys) {
      return;
    }
    await handleCopy(allKeys);
  };

  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setBalanceFilter("all");
    setPageSize("10");
  };

  return (
    <>
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-stone-100">
                <KeyRound className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">用户管理</h2>
                <p className="text-sm text-stone-500">管理普通用户资料、剩余积分、登录 IP 和一次性访问码；普通用户只能进入 ColaAI，不能查看设置和号池。</p>
              </div>
            </div>
            <Button className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800" onClick={() => setIsDialogOpen(true)}>
              <Plus className="size-4" />
              批量生成访问码
            </Button>
          </div>

          {revealedKeys.length > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium">新访问码仅展示一次，请立即保存：</div>
                  <div className="mt-1 text-xs text-emerald-700">共生成 {revealedKeys.length} 个访问码。</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700"
                  onClick={() => void handleCopyAll()}
                >
                  <Copy className="size-4" />
                  全部复制
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {revealedKeys.map((created, index) => (
                  <div key={`${created.key}-${index}`} className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-white/80 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-emerald-700">{created.name || created.item.name || `访问码 ${index + 1}`}</div>
                      <code className="mt-1 block break-all font-mono text-[13px]">{created.key}</code>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 rounded-xl border-emerald-200 bg-white px-4 text-emerald-700"
                      onClick={() => void handleCopy(created.key)}
                    >
                      <Copy className="size-4" />
                      复制
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <LoaderCircle className="size-5 animate-spin text-stone-400" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
              暂无普通用户访问码。点击右上角按钮后即可批量生成并分发给其他人。
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-stone-200 bg-stone-50/80 px-4 py-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_150px_150px_120px_auto] lg:items-end">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-stone-500">查询</label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
                      <Input
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="搜索名称、邮箱、登录 IP 或用户 ID"
                        className="h-10 rounded-xl border-stone-200 bg-white pl-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-stone-500">状态</label>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                      <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部状态</SelectItem>
                        <SelectItem value="enabled">已启用</SelectItem>
                        <SelectItem value="disabled">已禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-stone-500">积分</label>
                    <Select value={balanceFilter} onValueChange={(value) => setBalanceFilter(value as BalanceFilter)}>
                      <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">全部积分</SelectItem>
                        <SelectItem value="available">有剩余积分</SelectItem>
                        <SelectItem value="depleted">积分已用完</SelectItem>
                        <SelectItem value="unlimited">不限积分</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-stone-500">每页</label>
                    <Select value={pageSize} onValueChange={(value) => setPageSize(value as (typeof pageSizeOptions)[number])}>
                      <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {pageSizeOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option} 条
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                    onClick={resetFilters}
                    disabled={!hasActiveFilters && pageSize === "10"}
                  >
                    重置
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                  <Badge variant="secondary" className="rounded-md bg-white text-stone-600">
                    共 {items.length} 个用户
                  </Badge>
                  <Badge variant="secondary" className="rounded-md bg-white text-stone-600">
                    匹配 {filteredItems.length} 个
                  </Badge>
                  <span>
                    当前显示 {visibleStart}-{visibleEnd}
                  </span>
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <div className="rounded-xl bg-stone-50 px-6 py-10 text-center text-sm text-stone-500">
                  没有匹配的用户。调整查询条件或重置筛选后再试。
                </div>
              ) : (
                <div className="space-y-3">
                  {paginatedItems.map((item) => {
                    const isPending = pendingIds.has(item.id);
                    return (
                      <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-4 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-medium text-stone-800">{item.name}</div>
                            {item.email ? <div className="truncate text-xs text-stone-500">{item.email}</div> : null}
                            <Badge variant={item.enabled ? "success" : "secondary"} className="rounded-md">
                              {item.enabled ? "已启用" : "已禁用"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                            <span>创建时间 {formatDateTime(item.created_at)}</span>
                            <span>最近使用 {formatDateTime(item.last_used_at)}</span>
                            <span>登录 IP {item.last_login_ip || "—"}</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5 text-xs text-stone-500">
                            <Badge variant="secondary" className="rounded-md bg-emerald-50 text-emerald-700">
                              剩余积分 {formatBalance(item.limits)}
                            </Badge>
                            <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-600">
                              总积分 {formatLimitValue(item.limits?.images_total)}
                            </Badge>
                            <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-600">
                              已用积分 {formatLimitValue(item.limits?.images_used)}
                            </Badge>
                            <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-600">
                              并发 {formatLimitValue(item.limits?.concurrency)}
                            </Badge>
                            <Badge variant="secondary" className="max-w-full rounded-md bg-stone-100 text-stone-600">
                              模型 {formatModels(item.limits?.models)}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                            onClick={() => openEditDialog(item)}
                            disabled={isPending}
                          >
                            {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                            onClick={() => void handleToggle(item)}
                            disabled={isPending}
                          >
                            {isPending ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : item.enabled ? (
                              <Ban className="size-4" />
                            ) : (
                              <CheckCircle2 className="size-4" />
                            )}
                            {item.enabled ? "禁用" : "启用"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 rounded-xl border-rose-200 bg-white px-4 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setDeletingItem(item)}
                            disabled={isPending}
                          >
                            {isPending ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  第 {safeCurrentPage} / {totalPages} 页，显示 {visibleStart}-{visibleEnd} 条，共 {filteredItems.length} 条
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl border-stone-200 bg-white px-3 text-stone-700"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={safeCurrentPage <= 1}
                  >
                    <ChevronLeft className="size-4" />
                    上一页
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl border-stone-200 bg-white px-3 text-stone-700"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={safeCurrentPage >= totalPages}
                  >
                    下一页
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>批量生成访问码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              可选填写一个备注名称，方便区分不同使用者；创建后会生成只能查看一次的原始访问码。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称（可选）</label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：设计同学 A、运营临时账号"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">生成数量</label>
                <Input
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">总积分</label>
                <Input
                  value={limitsForm.imagesTotal}
                  onChange={(event) => updateLimitsForm("imagesTotal", event.target.value)}
                  placeholder="不限"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">并发</label>
                <Input
                  value={limitsForm.concurrency}
                  onChange={(event) => updateLimitsForm("concurrency", event.target.value)}
                  placeholder="不限"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">允许模型（逗号分隔）</label>
              <Input
                value={limitsForm.models}
                onChange={(event) => updateLimitsForm("models", event.target.value)}
                placeholder="例如：gpt-4o-mini, gpt-image-2；留空不限"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setIsDialogOpen(false)}
              disabled={isCreating}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleCreate()}
              disabled={isCreating}
            >
              {isCreating ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingItem)} onOpenChange={(open) => (!open ? setDeletingItem(null) : null)}>
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>删除访问码</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认删除访问码「{deletingItem?.name}」吗？删除后该访问码将无法继续调用接口。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setDeletingItem(null)}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-rose-600 px-5 text-white hover:bg-rose-700"
              onClick={() => void handleDelete()}
              disabled={deletingItem ? pendingIds.has(deletingItem.id) : false}
            >
              {deletingItem && pendingIds.has(deletingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingItem(null);
            setEditEmail("");
            setEditKey("");
            setEditLimitsForm(emptyLimitsForm);
          }
        }}
      >
        <DialogContent className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑用户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              可以修改基础资料、专用访问码和配额。配额留空表示不限制。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">名称</label>
              <Input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="例如：设计同学 A、运营临时账号"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">邮箱</label>
              <Input
                value={editEmail}
                onChange={(event) => setEditEmail(event.target.value)}
                placeholder="creator@example.com"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">新的专用访问码（可选）</label>
              <Input
                value={editKey}
                onChange={(event) => setEditKey(event.target.value)}
                placeholder="例如：sk-your-custom-user-key"
                className="h-11 rounded-xl border-stone-200 bg-white font-mono"
              />
              <p className="text-xs leading-5 text-stone-500">
                保存后旧访问码会立即失效，新访问码生效。系统仍只保存哈希，不会回显当前访问码。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">总积分</label>
                <Input
                  value={editLimitsForm.imagesTotal}
                  onChange={(event) => updateEditLimitsForm("imagesTotal", event.target.value)}
                  placeholder="不限"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">已用积分</label>
                <Input
                  value={editLimitsForm.imagesUsed}
                  onChange={(event) => updateEditLimitsForm("imagesUsed", event.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-stone-700">并发</label>
                <Input
                  value={editLimitsForm.concurrency}
                  onChange={(event) => updateEditLimitsForm("concurrency", event.target.value)}
                  placeholder="不限"
                  inputMode="numeric"
                  className="h-11 rounded-xl border-stone-200 bg-white"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">允许模型（逗号分隔）</label>
              <Input
                value={editLimitsForm.models}
                onChange={(event) => updateEditLimitsForm("models", event.target.value)}
                placeholder="例如：gpt-4o-mini, gpt-image-2；留空不限"
                className="h-11 rounded-xl border-stone-200 bg-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => {
                setEditingItem(null);
                setEditEmail("");
                setEditKey("");
                setEditLimitsForm(emptyLimitsForm);
              }}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleEdit()}
              disabled={editingItem ? pendingIds.has(editingItem.id) : false}
            >
              {editingItem && pendingIds.has(editingItem.id) ? <LoaderCircle className="size-4 animate-spin" /> : <Pencil className="size-4" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
