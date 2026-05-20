"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleOff,
  Copy,
  Download,
  Gift,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deleteAccounts,
  downloadCpaAccounts,
  fetchAccounts,
  refreshAccountsStream,
  updateAccount,
  type Account,
  type AccountStatus,
} from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

import { AccountImportDialog } from "./components/account-import-dialog";

const accountStatusOptions: { label: string; value: AccountStatus | "all" }[] = [
  { label: "全部状态", value: "all" },
  { label: "正常", value: "正常" },
  { label: "限流", value: "限流" },
  { label: "异常", value: "异常" },
  { label: "禁用", value: "禁用" },
];

const statusMeta: Record<
  AccountStatus,
  {
    icon: typeof CheckCircle2;
    badge: ComponentProps<typeof Badge>["variant"];
  }
> = {
  正常: { icon: CheckCircle2, badge: "success" },
  限流: { icon: CircleAlert, badge: "warning" },
  异常: { icon: CircleOff, badge: "danger" },
  禁用: { icon: Ban, badge: "secondary" },
};

const metricCards = [
  { key: "total", label: "账户总数", color: "text-stone-900", icon: UserRound },
  { key: "active", label: "正常账户", color: "text-emerald-600", icon: CheckCircle2 },
  { key: "limited", label: "限流账户", color: "text-orange-500", icon: CircleAlert },
  { key: "abnormal", label: "异常账户", color: "text-rose-500", icon: CircleOff },
  { key: "disabled", label: "禁用账户", color: "text-stone-500", icon: Ban },
  { key: "quota", label: "剩余额度", color: "text-blue-500", icon: RefreshCw },
] as const;

const headerButtonClass =
  "h-10 rounded-xl border-stone-200 bg-white/85 px-3 text-stone-700 shadow-sm shadow-stone-200/40 hover:bg-white sm:px-4";

const refreshActionClass =
  "h-10 rounded-xl border-sky-100 bg-sky-50/90 px-3 text-sky-700 shadow-sm shadow-sky-100/60 hover:border-sky-200 hover:bg-sky-100/80 hover:text-sky-800 sm:px-4";

const refreshToastOptions = {
  position: "bottom-right" as const,
  classNames: {
    toast:
      "w-[min(320px,calc(100vw-2rem))] rounded-xl border border-sky-100 bg-white/95 px-3 py-2.5 text-stone-800 shadow-lg shadow-stone-300/25 backdrop-blur",
    title: "text-sm font-medium",
    loader: "text-sky-600",
  },
};

function isUnlimitedImageQuotaAccount(account: Account) {
  return account.type === "pro" || account.type === "prolite";
}

function imageQuotaUnknown(account: Account) {
  return Boolean(account.image_quota_unknown);
}

function formatCompact(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}

function formatQuota(account: Account) {
  if (isUnlimitedImageQuotaAccount(account)) {
    return "∞";
  }
  if (imageQuotaUnknown(account)) {
    return "未知";
  }
  return String(Math.max(0, account.quota));
}

function formatRestoreAt(value?: string | null) {
  if (!value) {
    return { absolute: "—", relative: "" };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { absolute: value, relative: "" };
  }

  const diffMs = Math.max(0, date.getTime() - Date.now());
  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const relative = diffMs > 0 ? `剩余 ${days}d ${hours}h` : "已到恢复时间";

  const pad = (num: number) => String(num).padStart(2, "0");
  const absolute = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

  return { absolute, relative };
}

function formatQuotaSummary(accounts: Account[]) {
  const availableAccounts = accounts.filter((account) => account.status === "正常");
  if (availableAccounts.some(isUnlimitedImageQuotaAccount)) {
    return "∞";
  }
  if (availableAccounts.some(imageQuotaUnknown)) {
    return "未知";
  }
  return formatCompact(availableAccounts.reduce((sum, account) => sum + Math.max(0, account.quota), 0));
}

function maskToken(token?: string) {
  if (!token) return "—";
  if (token.length <= 18) return token;
  return `${token.slice(0, 16)}...${token.slice(-8)}`;
}

function downloadTokens(accounts: Account[]) {
  const content = `${accounts.map((account) => account.access_token).join("\n")}\n`;
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounts-${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

function displayAccountType(account: Account) {
  return account.type || "Free";
}

function accountTags(account: Account) {
  const tags = Array.isArray(account.tags) ? account.tags.filter(Boolean) : [];
  if (account.can_activate_plus && !tags.includes("可开通 Plus")) {
    return [...tags, "可开通 Plus"];
  }
  return tags;
}

function AccountsPageContent() {
  const didLoadRef = useRef(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [plusPromoOnly, setPlusPromoOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("10");
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editStatus, setEditStatus] = useState<AccountStatus>("正常");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isExportingCpa, setIsExportingCpa] = useState(false);

  const loadAccounts = async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const data = await fetchAccounts();
      setAccounts(data.items);
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.access_token === id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载账户失败";
      toast.error(message);
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadAccounts();
  }, []);

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return accounts.filter((account) => {
      const searchMatched =
        normalizedQuery.length === 0 || (account.email ?? "").toLowerCase().includes(normalizedQuery);
      const typeMatched = typeFilter === "all" || displayAccountType(account) === typeFilter;
      const statusMatched = statusFilter === "all" || account.status === statusFilter;
      const plusMatched = !plusPromoOnly || Boolean(account.can_activate_plus);
      return searchMatched && typeMatched && statusMatched && plusMatched;
    });
  }, [accounts, plusPromoOnly, query, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / Number(pageSize)));
  const safePage = Math.min(page, pageCount);
  const startIndex = (safePage - 1) * Number(pageSize);
  const currentRows = filteredAccounts.slice(startIndex, startIndex + Number(pageSize));
  const allCurrentSelected =
    currentRows.length > 0 && currentRows.every((row) => selectedIds.includes(row.access_token));

  const summary = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((item) => item.status === "正常").length;
    const limited = accounts.filter((item) => item.status === "限流").length;
    const abnormal = accounts.filter((item) => item.status === "异常").length;
    const disabled = accounts.filter((item) => item.status === "禁用").length;
    const quota = formatQuotaSummary(accounts);
    const plusPromo = accounts.filter((item) => item.can_activate_plus).length;

    return { total, active, limited, abnormal, disabled, quota, plusPromo };
  }, [accounts]);

  const accountTypeOptions = useMemo(
    () => [
      { label: "全部类型", value: "all" },
      ...Array.from(new Set(accounts.map(displayAccountType))).map((type) => ({ label: type, value: type })),
    ],
    [accounts],
  );

  const selectedTokens = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    return accounts.filter((item) => selectedSet.has(item.access_token)).map((item) => item.access_token);
  }, [accounts, selectedIds]);

  const abnormalTokens = useMemo(() => {
    return accounts.filter((item) => item.status === "异常").map((item) => item.access_token);
  }, [accounts]);

  const paginationItems = useMemo(() => {
    const items: (number | "...")[] = [];
    const start = Math.max(1, safePage - 1);
    const end = Math.min(pageCount, safePage + 1);

    if (start > 1) items.push(1);
    if (start > 2) items.push("...");
    for (let current = start; current <= end; current += 1) items.push(current);
    if (end < pageCount - 1) items.push("...");
    if (end < pageCount) items.push(pageCount);

    return items;
  }, [pageCount, safePage]);

  const handleDeleteTokens = async (tokens: string[]) => {
    if (tokens.length === 0) {
      toast.error("请先选择要删除的账户");
      return;
    }

    setIsDeleting(true);
    try {
      const data = await deleteAccounts(tokens);
      setAccounts(data.items);
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.access_token === id)));
      toast.success(`删除 ${data.removed ?? 0} 个账户`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除账户失败";
      toast.error(message);
    } finally {
      setIsDeleting(false);
    }
  };

  const runRefreshStream = async (
    accessTokens: string[],
    options: { scope?: "all" | "selected"; toastLabel: string } = { toastLabel: "刷新账号" },
  ) => {
    if (accessTokens.length === 0) {
      toast.error("没有需要刷新的账户");
      return;
    }

    const toastId = toast.loading(`${options.toastLabel}：连接中…`, refreshToastOptions);
    setIsRefreshing(true);
    try {
      let removedFailedRunning = 0;
      let removedRateRunning = 0;
      let receivedAny = false;
      let lastCompleted = 0;
      const updateProgressToast = (completed: number, requested: number) => {
        lastCompleted = completed;
        const parts = [`${options.toastLabel}（${completed} / ${requested}）`];
        if (removedFailedRunning > 0) {
          parts.push(`已移除失效账号 ${removedFailedRunning} 个`);
        }
        if (removedRateRunning > 0) {
          parts.push(`已移除限流账号 ${removedRateRunning} 个`);
        }
        toast.loading(parts.join("，"), { ...refreshToastOptions, id: toastId });
      };

      const final = await refreshAccountsStream(accessTokens, {
        ...(options.scope ? { scope: options.scope } : {}),
        onEvent: (event) => {
          if (typeof window !== "undefined") {
            // eslint-disable-next-line no-console
            console.debug("[refresh-stream]", event);
          }
          receivedAny = true;
          if (event.type === "start") {
            toast.loading(
              `${options.toastLabel}（0 / ${event.requested}）`,
              { ...refreshToastOptions, id: toastId },
            );
          } else if (event.type === "account") {
            if (event.outcome === "invalid") {
              removedFailedRunning += 1;
            }
            updateProgressToast(event.completed, event.requested);
          } else if (event.type === "batch") {
            setAccounts(event.items);
            setSelectedIds((prev) =>
              prev.filter((id) => event.items.some((item) => item.access_token === id)),
            );
            removedRateRunning += event.removed_rate_limited;
            updateProgressToast(event.completed, event.requested);
          }
        },
      });
      void receivedAny;
      void lastCompleted;

      const items = final?.items ?? [];
      if (items.length > 0 || final) {
        setAccounts(items);
        setSelectedIds((prev) => prev.filter((id) => items.some((item) => item.access_token === id)));
      }

      const refreshed = final?.refreshed ?? 0;
      const removedFailed = final?.removed_failed ?? 0;
      const removedRate = final?.removed_rate_limited ?? 0;
      const errors = final?.errors ?? [];
      const firstError = errors[0]?.error;
      const removedTexts: string[] = [];
      if (removedFailed > 0) removedTexts.push(`已移除失效账号 ${removedFailed} 个`);
      if (removedRate > 0) removedTexts.push(`已移除限流账号 ${removedRate} 个`);
      const removedSuffix = removedTexts.length ? `，${removedTexts.join("，")}` : "";

      if (errors.length > 0) {
        const summary =
          refreshed > 0
            ? `${options.toastLabel}完成：成功 ${refreshed} 个，失败 ${errors.length} 个`
            : `${options.toastLabel}失败 ${errors.length} 个`;
        toast.error(
          `${summary}${removedSuffix}${firstError ? `，首个错误：${firstError}` : ""}`,
          { ...refreshToastOptions, id: toastId },
        );
      } else {
        toast.success(`${options.toastLabel}完成：成功 ${refreshed} 个${removedSuffix}`, {
          ...refreshToastOptions,
          id: toastId,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${options.toastLabel}失败`;
      toast.error(message, { ...refreshToastOptions, id: toastId });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefreshAccounts = async (accessTokens: string[]) => {
    await runRefreshStream(accessTokens, { toastLabel: "刷新账号" });
  };

  const handleRefreshAllAccounts = async () => {
    const tokens = accounts.map((item) => item.access_token).filter(Boolean);
    await runRefreshStream(tokens, { scope: "all", toastLabel: "一键刷新账号" });
  };

  const handleDownloadCpaAccounts = async (accessTokens: string[]) => {
    if (accessTokens.length === 0) {
      toast.error("没有可导出的账户");
      return;
    }

    setIsExportingCpa(true);
    try {
      await downloadCpaAccounts(accessTokens);
      toast.success(`已导出 ${accessTokens.length} 个 CPA JSON`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出 CPA 失败";
      toast.error(message);
    } finally {
      setIsExportingCpa(false);
    }
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setEditStatus(account.status);
  };

  const handleUpdateAccount = async () => {
    if (!editingAccount) {
      return;
    }

    setIsUpdating(true);
    try {
      const data = await updateAccount(editingAccount.access_token, {
        status: editStatus,
      });
      setAccounts(data.items);
      setSelectedIds((prev) => prev.filter((id) => data.items.some((item) => item.access_token === id)));
      setEditingAccount(null);
      toast.success("账号信息已更新");
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新账号失败";
      toast.error(message);
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...currentRows.map((item) => item.access_token)])));
      return;
    }
    setSelectedIds((prev) => prev.filter((id) => !currentRows.some((row) => row.access_token === id)));
  };

  return (
    <>
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">
            Account Pool
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">号池管理</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className={cn(headerButtonClass, "w-10 px-0 sm:w-auto sm:px-3")}
            onClick={() => void loadAccounts()}
            disabled={isLoading || isRefreshing || isDeleting}
            aria-label="刷新账号列表"
            title="刷新账号列表"
          >
            <RefreshCw className={cn("size-4", isLoading ? "animate-spin" : "")} />
            <span className="hidden sm:inline">刷新</span>
          </Button>
          <Button
            variant="outline"
            className={cn(refreshActionClass, "max-w-full")}
            onClick={() => void handleRefreshAllAccounts()}
            disabled={isLoading || isRefreshing || isDeleting || accounts.length === 0}
          >
            <RefreshCw className={cn("size-4", isRefreshing ? "animate-spin" : "")} />
            <span className="hidden sm:inline">一键刷新全部</span>
            <span className="sm:hidden">刷新全部</span>
          </Button>
          <AccountImportDialog
            disabled={isLoading || isRefreshing || isDeleting}
            onImported={(items) => {
              setAccounts(items);
              setSelectedIds([]);
              setPage(1);
            }}
          />
          <Button
            variant="outline"
            className={headerButtonClass}
            onClick={() => downloadTokens(accounts)}
            disabled={accounts.length === 0}
          >
            <Download className="size-4" />
            导出全部 Token
          </Button>
          <Button
            variant="outline"
            className={headerButtonClass}
            onClick={() => void handleDownloadCpaAccounts(accounts.map((item) => item.access_token))}
            disabled={accounts.length === 0 || isExportingCpa}
          >
            {isExportingCpa ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
            导出 CPA ZIP
          </Button>
        </div>
      </section>

      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => (!open ? setEditingAccount(null) : null)}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>编辑账户</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              手动修改账号状态。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-stone-700">状态</label>
              <Select value={editStatus} onValueChange={(value) => setEditStatus(value as AccountStatus)}>
                <SelectTrigger className="h-11 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {accountStatusOptions
                    .filter((option) => option.value !== "all")
                    .map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="secondary"
              className="h-10 rounded-xl bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              onClick={() => setEditingAccount(null)}
              disabled={isUpdating}
            >
              取消
            </Button>
            <Button
              className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
              onClick={() => void handleUpdateAccount()}
              disabled={isUpdating}
            >
              {isUpdating ? <LoaderCircle className="size-4 animate-spin" /> : null}
              保存修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((item) => {
            const Icon = item.icon;
            const value = summary[item.key];
            return (
              <Card key={item.key} className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardContent className="p-4">
                  <div className="mb-4 flex items-start justify-between">
                    <span className="text-xs font-medium text-stone-400">{item.label}</span>
                    <Icon className="size-4 text-stone-400" />
                  </div>
                  <div className={cn("text-[1.75rem] font-semibold tracking-tight", item.color)}>
                    <span className={typeof value === "number" ? "" : "text-[1.1rem]"}>
                      {typeof value === "number" ? formatCompact(value) : value}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">账户列表</h2>
            <Badge variant="secondary" className="rounded-lg bg-stone-200 px-2 py-0.5 text-stone-700">
              {filteredAccounts.length}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-[260px]">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索邮箱"
                className="h-10 rounded-xl border-stone-200 bg-white/85 pl-10"
              />
            </div>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                setTypeFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as AccountStatus | "all");
                setPage(1);
              }}
            >
              <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white/85 lg:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accountStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={plusPromoOnly ? "default" : "outline"}
              className={cn(
                "h-10 rounded-xl px-3",
                plusPromoOnly
                  ? "bg-stone-950 text-white hover:bg-stone-800"
                  : "border-stone-200 bg-white/85 text-stone-700 hover:bg-white",
              )}
              onClick={() => {
                setPlusPromoOnly((value) => !value);
                setPage(1);
              }}
            >
              <Gift className="size-4" />
              可开通 Plus
              {summary.plusPromo > 0 ? (
                <span
                  className={cn(
                    "ml-1 rounded-md px-1.5 py-0.5 text-xs",
                    plusPromoOnly ? "bg-white/15 text-white" : "bg-stone-100 text-stone-500",
                  )}
                >
                  {summary.plusPromo}
                </span>
              ) : null}
            </Button>
          </div>
        </div>

        {isLoading && accounts.length === 0 ? (
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-stone-700">正在加载账户</p>
                <p className="text-sm text-stone-500">从后端同步账号列表和状态。</p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card
          className={cn(
            "overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm",
            isLoading && accounts.length === 0 ? "hidden" : "",
          )}
        >
          <CardContent className="space-y-0 p-0">
            <div className="flex flex-col gap-3 border-b border-stone-100 bg-stone-50/35 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
                <Button
                  variant="outline"
                  className="h-9 rounded-lg border-sky-100 bg-white px-3 text-sky-700 shadow-xs hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800 disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-400"
                  onClick={() => void handleRefreshAccounts(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isRefreshing}
                  title={selectedTokens.length === 0 ? "先选择账号" : "刷新选中账号信息和额度"}
                >
                  {isRefreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  <span>刷新选中</span>
                  {selectedTokens.length > 0 ? (
                    <span className="ml-0.5 rounded-md bg-sky-100 px-1.5 py-0.5 text-xs text-sky-700">
                      {selectedTokens.length}
                    </span>
                  ) : null}
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void handleDeleteTokens(abnormalTokens)}
                  disabled={abnormalTokens.length === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  移除异常账号
                </Button>
                <Button
                  variant="ghost"
                  className="h-8 rounded-lg px-3 text-rose-500 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => void handleDeleteTokens(selectedTokens)}
                  disabled={selectedTokens.length === 0 || isDeleting}
                >
                  {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  删除所选
                </Button>
                {selectedIds.length > 0 ? (
                  <span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">
                    已选择 {selectedIds.length} 项
                  </span>
                ) : null}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="border-b border-stone-100 text-[11px] text-stone-400 uppercase tracking-[0.18em]">
                  <tr>
                    <th className="w-12 px-4 py-3">
                      <Checkbox
                        checked={allCurrentSelected}
                        onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                      />
                    </th>
                    <th className="w-56 px-4 py-3">token</th>
                    <th className="w-28 px-4 py-3">类型</th>
                    <th className="w-24 px-4 py-3">状态</th>
                    <th className="w-56 px-4 py-3">账号信息</th>
                    <th className="w-24 px-4 py-3">额度</th>
                    <th className="w-40 px-4 py-3">恢复时间</th>
                    <th className="w-18 px-4 py-3">成功</th>
                    <th className="w-18 px-4 py-3">失败</th>
                    <th className="w-24 px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {currentRows.map((account) => {
                    const status = statusMeta[account.status];
                    const StatusIcon = status.icon;
                    const tags = accountTags(account);

                    return (
                      <tr
                        key={account.access_token}
                        className="border-b border-stone-100/80 text-sm text-stone-600 transition-colors hover:bg-stone-50/70"
                      >
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={selectedIds.includes(account.access_token)}
                            onCheckedChange={(checked) => {
                              setSelectedIds((prev) =>
                                checked
                                  ? Array.from(new Set([...prev, account.access_token]))
                                  : prev.filter((item) => item !== account.access_token),
                              );
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium tracking-tight text-stone-700">
                              {maskToken(account.access_token)}
                            </span>
                            <button
                              type="button"
                              className="rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => {
                                void navigator.clipboard.writeText(account.access_token);
                                toast.success("token 已复制");
                              }}
                            >
                              <Copy className="size-4" />
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="rounded-md bg-stone-100 text-stone-700">
                            {displayAccountType(account)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={status.badge}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1"
                          >
                            <StatusIcon className="size-3.5" />
                            {account.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1.5">
                            <div className="text-xs leading-5 text-stone-500">{account.email ?? "—"}</div>
                            {tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant={tag === "可开通 Plus" ? "warning" : "secondary"}
                                    className="rounded-md px-1.5 py-0.5 text-[11px]"
                                    title={tag === "可开通 Plus" ? account.plus_promo_text ?? undefined : undefined}
                                  >
                                    {tag === "可开通 Plus" ? <Gift className="size-3" /> : null}
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="info" className="rounded-md">
                            {formatQuota(account)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs leading-5 text-stone-500">
                          {(() => {
                            const restore = formatRestoreAt(account.restore_at);
                            return (
                              <div className="space-y-0.5">
                                {restore.relative ? <div className="font-medium text-stone-700">{restore.relative}</div> : null}
                                <div>{restore.absolute}</div>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-stone-500">{account.success}</td>
                        <td className="px-4 py-3 text-stone-500">{account.fail}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-stone-400">
                            <button
                              type="button"
                              className="rounded-lg p-2 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => openEditDialog(account)}
                              disabled={isUpdating}
                            >
                              <Pencil className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-2 transition hover:bg-stone-100 hover:text-stone-700"
                              onClick={() => void handleRefreshAccounts([account.access_token])}
                              disabled={isRefreshing}
                            >
                              <RefreshCw className={cn("size-4", isRefreshing ? "animate-spin" : "")} />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-2 transition hover:bg-rose-50 hover:text-rose-500"
                              onClick={() => void handleDeleteTokens([account.access_token])}
                              disabled={isDeleting}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!isLoading && currentRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                  <div className="rounded-xl bg-stone-100 p-3 text-stone-500">
                    <Search className="size-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-stone-700">没有匹配的账户</p>
                    <p className="text-sm text-stone-500">调整筛选条件或搜索关键字后重试。</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="border-t border-stone-100 px-4 py-4">
              <div className="flex items-center justify-center gap-3 overflow-x-auto whitespace-nowrap">
                <div className="shrink-0 text-sm text-stone-500">
                显示第 {filteredAccounts.length === 0 ? 0 : startIndex + 1} -{" "}
                {Math.min(startIndex + Number(pageSize), filteredAccounts.length)} 条，共{" "}
                {filteredAccounts.length} 条
                </div>

                <span className="shrink-0 text-sm leading-none text-stone-500">
                  {safePage} / {pageCount} 页
                </span>
                <Select
                  value={pageSize}
                  onValueChange={(value) => {
                    setPageSize(value);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-10 w-[108px] shrink-0 rounded-lg border-stone-200 bg-white text-sm leading-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / 页</SelectItem>
                    <SelectItem value="20">20 / 页</SelectItem>
                    <SelectItem value="50">50 / 页</SelectItem>
                    <SelectItem value="100">100 / 页</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-lg border-stone-200 bg-white"
                  disabled={safePage <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                {paginationItems.map((item, index) =>
                  item === "..." ? (
                    <span key={`ellipsis-${index}`} className="px-1 text-sm text-stone-400">
                      ...
                    </span>
                  ) : (
                    <Button
                      key={item}
                      variant={item === safePage ? "default" : "outline"}
                      className={cn(
                        "h-10 min-w-10 shrink-0 rounded-lg px-3",
                        item === safePage
                          ? "bg-stone-950 text-white hover:bg-stone-800"
                          : "border-stone-200 bg-white text-stone-700",
                      )}
                      onClick={() => setPage(item)}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  variant="outline"
                  size="icon"
                  className="size-10 shrink-0 rounded-lg border-stone-200 bg-white"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

export default function AccountsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <AccountsPageContent />;
}
