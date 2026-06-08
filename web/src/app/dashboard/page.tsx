"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  Database,
  Gauge,
  HardDrive,
  ImageIcon,
  KeyRound,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  ServerCog,
  Settings,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchDashboard, type DashboardMetricGroup, type DashboardResponse } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

type DashboardFailureReason = NonNullable<NonNullable<DashboardResponse["calls"]>["failure_reasons"]>[number];

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickNumber(source: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(source?.[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function pickBoolean(source: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

function formatNumber(value?: number) {
  if (value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatPercentFromParts(failed?: number, total?: number, explicit?: number) {
  if (explicit !== undefined) {
    return `${Math.round(explicit * 10) / 10}%`;
  }
  if (failed === undefined || total === undefined || total <= 0) {
    return "—";
  }
  return `${Math.round((failed / total) * 1000) / 10}%`;
}

function formatDuration(ms?: number) {
  if (ms === undefined) {
    return "—";
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${Math.round(ms)} ms`;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
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
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(value?: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "未知";
  }
  if (value === "success" || value === "ok") {
    return "正常";
  }
  if (value === "failed" || value === "error") {
    return "异常";
  }
  return value;
}

function healthLabel(level?: string) {
  if (level === "critical") {
    return "异常";
  }
  if (level === "warning") {
    return "注意";
  }
  return "正常";
}

function healthBadgeVariant(level?: string) {
  if (level === "critical") {
    return "danger" as const;
  }
  if (level === "warning") {
    return "warning" as const;
  }
  return "success" as const;
}

function healthIconClassName(level?: string) {
  if (level === "critical") {
    return "bg-rose-50 text-rose-600";
  }
  if (level === "warning") {
    return "bg-amber-50 text-amber-600";
  }
  return "bg-emerald-50 text-emerald-600";
}

function quotaLabel(total?: number | null, unknown?: boolean) {
  if (unknown) {
    return "部分未知";
  }
  if (total === null || total === undefined) {
    return "—";
  }
  return formatNumber(total);
}

function compactEndpoint(value?: string) {
  if (!value || value === "unknown") {
    return "未知接口";
  }
  return value.replace(/^\/api\//, "api/").replace(/^\/v1\//, "v1/");
}

function storageStatusValue(storage: DashboardResponse["storage"]) {
  return storage?.status ?? storage?.health?.status ?? (storage?.ok === true ? "ok" : storage?.ok === false ? "error" : undefined);
}

function storageBackendLabel(storage: DashboardResponse["storage"]) {
  const backend = storage?.backend;
  if (typeof storage?.provider === "string" && storage.provider.trim()) {
    return storage.provider;
  }
  if (typeof storage?.bucket === "string" && storage.bucket.trim()) {
    return storage.bucket;
  }
  if (typeof backend?.description === "string" && backend.description.trim()) {
    return backend.description;
  }
  if (typeof backend?.type === "string" && backend.type.trim()) {
    return backend.type;
  }
  if (typeof storage?.health?.backend === "string" && storage.health.backend.trim()) {
    return storage.health.backend;
  }
  return "—";
}

function metricGroup(value?: DashboardMetricGroup) {
  return value || {};
}

function dashboardWorkerEntries(data: DashboardResponse | null) {
  const workers = data?.workers;
  if (workers && typeof workers === "object" && Array.isArray(workers.items)) {
    return workers.items.map((item) => [String(item.name || "后台线程"), item] as const);
  }
  const source = data?.health?.background_threads || data?.health?.threads || data?.health?.workers || data?.background_threads || data?.threads;
  if (!source || typeof source !== "object") {
    return [];
  }
  return Object.entries(source);
}

function threadHealthSummary(data: DashboardResponse | null) {
  const entries = dashboardWorkerEntries(data);
  if (!entries.length) {
    return { label: "后台线程", value: "—", hint: "后端暂未返回", variant: "secondary" as const };
  }

  const healthyCount = entries.filter(([, value]) => {
    if (typeof value === "boolean") return value;
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    const healthy = pickBoolean(record, ["healthy", "ok", "alive", "running"]);
    if (healthy !== undefined) return healthy;
    const status = String(record.status || record.state || "").toLowerCase();
    return ["ok", "healthy", "running", "alive", "normal"].includes(status);
  }).length;

  const total = entries.length;
  const allHealthy = total > 0 && healthyCount === total;
  return {
    label: "后台线程",
    value: total > 0 ? `${healthyCount} / ${total}` : "—",
    hint: total > 0 ? (allHealthy ? "全部健康" : "存在异常") : "后端暂未返回",
    variant: allHealthy ? "success" as const : "warning" as const,
  };
}

function DashboardContent() {
  const didLoadRef = useRef(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const nextData = await fetchDashboard();
      setData(nextData);
      setLoadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载仪表盘失败";
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (didLoadRef.current) {
      return;
    }
    didLoadRef.current = true;
    void loadDashboard();
  }, []);

  const summary = useMemo(() => {
    const accounts = metricGroup(data?.accounts);
    const calls = metricGroup(data?.calls);
    const today = metricGroup(data?.calls?.today);
    const recent = metricGroup(data?.calls?.recent);
    const image = metricGroup(data?.calls?.image);
    const queue = metricGroup(data?.image_tasks || data?.queue || data?.calls?.queue);
    const autoRegister = data?.auto_register;
    const autoRegisterRecord = autoRegister as Record<string, unknown> | undefined;
    const backup = data?.backup || {};
    const storage = data?.storage || {};
    const imageQuota = accounts.image_quota || {};

    return {
      accountsTotal: pickNumber(accounts, ["total", "accounts", "count"]),
      accountsActive: pickNumber(accounts, ["active", "normal", "available", "enabled"]),
      accountsLimited: pickNumber(accounts, ["limited"]),
      accountsError: pickNumber(accounts, ["error"]),
      accountsDisabled: pickNumber(accounts, ["disabled"]),
      imageAvailable: pickNumber(accounts, ["image_available", "available"]),
      imageQuotaTotal: typeof imageQuota.total === "number" || imageQuota.total === null ? imageQuota.total : undefined,
      imageQuotaUnknown: Boolean(imageQuota.unknown),
      todaySuccess: pickNumber(today, ["success", "succeeded", "ok"]) ?? pickNumber(calls, ["today_success", "success_today"]),
      todayFailed: pickNumber(today, ["failed", "fail", "error", "errors"]) ?? pickNumber(calls, ["today_failed", "today_fail"]),
      recentSuccess: pickNumber(recent, ["success", "succeeded", "ok"]) ?? pickNumber(calls, ["recent_success", "success"]),
      recentFailed: pickNumber(recent, ["failed", "fail", "error", "errors"]) ?? pickNumber(calls, ["recent_failed", "fail", "failed"]),
      avgDuration: pickNumber(calls, ["avg_duration_ms", "average_duration_ms", "avg_latency_ms", "duration_ms"]),
      imageTotal: pickNumber(image, ["total"]),
      imageSuccess: pickNumber(image, ["success", "succeeded", "ok"]),
      imageFailed: pickNumber(image, ["failed", "fail", "error", "errors"]),
      imageAvgDuration: pickNumber(image, ["avg_duration_ms", "average_duration_ms", "avg_latency_ms", "duration_ms"]),
      imageP90Duration: pickNumber(image, ["p90_duration_ms", "duration_p90_ms", "p90_ms", "latency_p90_ms"]),
      imageP99Duration: pickNumber(image, ["p99_duration_ms", "duration_p99_ms", "p99_ms", "latency_p99_ms"]),
      imageLastAt: typeof image.last_at === "string" ? image.last_at : null,
      queueQueued: pickNumber(queue, ["queued", "pending", "waiting"]),
      queueRunning: pickNumber(queue, ["running", "active", "processing"]),
      queueCheckingCapacity: pickNumber(queue, ["checking_capacity"]),
      queueCheckingOutAccount: pickNumber(queue, ["checking_out_account"]),
      queueSubmitting: pickNumber(queue, ["submitting", "submit"]),
      queuePolling: pickNumber(queue, ["polling", "generating"]),
      queueDownloading: pickNumber(queue, ["downloading", "download"]),
      queueSaving: pickNumber(queue, ["saving", "save"]),
      queueFailed: pickNumber(queue, ["failed", "fail", "error", "errors"]),
      queueTotal: pickNumber(queue, ["total", "size", "count"]),
      queueAvgWait: pickNumber(queue, ["avg_wait_ms", "average_wait_ms", "queue_duration_ms"]),
      queueP90Wait: pickNumber(queue, ["p90_wait_ms", "wait_p90_ms", "queue_p90_ms"]),
      queueP99Wait: pickNumber(queue, ["p99_wait_ms", "wait_p99_ms", "queue_p99_ms"]),
      queueP90Duration: pickNumber(queue, ["p90_duration_ms", "duration_p90_ms", "p90_ms"]),
      queueP99Duration: pickNumber(queue, ["p99_duration_ms", "duration_p99_ms", "p99_ms"]),
      failureReasons: Array.isArray(data?.calls?.failure_reasons) ? data.calls.failure_reasons : [],
      health: data?.health,
      threadHealth: threadHealthSummary(data),
      autoRegister,
      autoRegisterCurrent: pickNumber(autoRegisterRecord, ["current_available", "current_accounts", "available", "normal"]),
      autoRegisterTarget: pickNumber(autoRegisterRecord, ["target_available", "target", "min_available"]),
      autoRegisterMax: pickNumber(autoRegisterRecord, ["max_total_accounts", "max_total", "limit"]),
      autoRegisterInFlight: pickNumber(autoRegisterRecord, ["in_flight", "running", "pending"]),
      autoRegisterFailed: pickNumber(autoRegisterRecord, ["failed", "fail", "error", "errors"]),
      autoRegisterTotal: pickNumber(autoRegisterRecord, ["total", "done", "completed"]),
      autoRegisterFailureRate: pickNumber(autoRegisterRecord, ["failure_rate", "fail_rate"]),
      autoRegisterLastError: typeof autoRegister?.last_error === "string" ? autoRegister.last_error : null,
      backup,
      storage,
    };
  }, [data]);

  const metricCards = [
    {
      label: "可用图片账号",
      value: formatNumber(summary.imageAvailable),
      hint: `账号池 ${formatNumber(summary.accountsTotal)}`,
      icon: ImageIcon,
      color: summary.imageAvailable === 0 ? "text-rose-600" : "text-emerald-600",
    },
    {
      label: "今日成功",
      value: formatNumber(summary.todaySuccess),
      hint: "生图/接口调用",
      icon: CheckCircle2,
      color: "text-emerald-600",
    },
    {
      label: "今日失败",
      value: formatNumber(summary.todayFailed),
      hint: "需关注",
      icon: XCircle,
      color: "text-rose-500",
    },
    {
      label: "图片调用耗时",
      value: formatDuration(summary.imageAvgDuration ?? summary.avgDuration),
      hint: summary.imageP90Duration !== undefined || summary.imageP99Duration !== undefined
        ? `调用 P90 ${formatDuration(summary.imageP90Duration)} / P99 ${formatDuration(summary.imageP99Duration)}`
        : summary.imageAvgDuration !== undefined ? "图片调用日志窗口" : "接口调用日志窗口",
      icon: Clock3,
      color: "text-stone-900",
    },
    {
      label: "最近失败",
      value: formatNumber(summary.recentFailed),
      hint: "最近窗口",
      icon: XCircle,
      color: "text-orange-500",
    },
    {
      label: "队列中",
      value: formatNumber(summary.queueQueued),
      hint: `运行 ${formatNumber(summary.queueRunning)}`,
      icon: Boxes,
      color: summary.queueQueued && summary.queueQueued > 0 ? "text-amber-600" : "text-blue-600",
    },
  ];

  const backupStatus = statusLabel(summary.backup.last_status ?? summary.backup.status);
  const storageStatus = statusLabel(storageStatusValue(summary.storage));
  const healthLevel = summary.health?.level || "normal";
  const healthReasons = Array.isArray(summary.health?.reasons) && summary.health.reasons.length > 0
    ? summary.health.reasons
    : ["系统运行正常"];
  const hasImageStats = summary.imageTotal !== undefined;
  const accountStats = [
    { label: "总账号", value: formatNumber(summary.accountsTotal) },
    { label: "可用账号", value: formatNumber(summary.accountsActive) },
    { label: "限流", value: formatNumber(summary.accountsLimited) },
    { label: "异常", value: formatNumber(summary.accountsError) },
    { label: "禁用", value: formatNumber(summary.accountsDisabled) },
    { label: "图片额度", value: quotaLabel(summary.imageQuotaTotal, summary.imageQuotaUnknown) },
  ];
  const opsCards = [
    {
      label: "图片调用",
      value: hasImageStats ? formatNumber(summary.imageTotal) : "暂无统计",
      hint: `成功 ${hasImageStats ? formatNumber(summary.imageSuccess) : "—"} / 失败 ${hasImageStats ? formatNumber(summary.imageFailed) : "—"}`,
      icon: Sparkles,
    },
    {
      label: "队列摘要",
      value: `${formatNumber(summary.queueQueued)} / ${formatNumber(summary.queueRunning)}`,
      hint: `任务等待 P90 ${formatDuration(summary.queueP90Wait)}，执行 P99 ${formatDuration(summary.queueP99Duration)}`,
      icon: ListChecks,
    },
    {
      label: "注册守护",
      value: `${formatNumber(summary.autoRegisterCurrent)} / ${formatNumber(summary.autoRegisterTarget)}`,
      hint: `上限 ${formatNumber(summary.autoRegisterMax)}，在途 ${formatNumber(summary.autoRegisterInFlight)}`,
      icon: ShieldCheck,
    },
    {
      label: "存储摘要",
      value: formatBytes(summary.storage.images_bytes ?? summary.storage.used_bytes),
      hint: `可用 ${formatBytes(summary.storage.free_bytes)}，后端 ${storageBackendLabel(summary.storage)}`,
      icon: HardDrive,
    },
  ];
  const quickActions = [
    { href: "/studio", label: "进入创作台", icon: Sparkles },
    { href: "/accounts", label: "号池管理", icon: ServerCog },
    { href: "/logs", label: "日志管理", icon: ListChecks },
    { href: "/settings", label: "设置备份", icon: Settings },
    { href: "/image-manager", label: "图片管理", icon: ImageIcon },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Dashboard</div>
          <h1 className="text-2xl font-semibold tracking-tight">管理员仪表盘</h1>
        </div>
        <Button
          variant="outline"
          className="h-10 rounded-xl border-stone-200 bg-white/80 px-4 text-stone-700 hover:bg-white"
          onClick={() => void loadDashboard(true)}
          disabled={isLoading || isRefreshing}
        >
          <RefreshCw className={cn("size-4", isLoading || isRefreshing ? "animate-spin" : "")} />
          刷新
        </Button>
      </div>

      {isLoading && !data ? (
        <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="flex items-center justify-center gap-3 px-6 py-14 text-sm text-stone-500">
            <LoaderCircle className="size-5 animate-spin" />
            正在加载仪表盘
          </CardContent>
        </Card>
      ) : null}

      {loadError ? (
        <Card className="rounded-2xl border-rose-100 bg-rose-50/90 shadow-sm">
          <CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 text-rose-700">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">仪表盘加载失败</div>
                <div className="mt-1 break-words text-xs leading-5 text-rose-600">{loadError}</div>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-9 shrink-0 rounded-xl border-rose-200 bg-white px-3 text-rose-700 hover:bg-rose-50"
              onClick={() => void loadDashboard(Boolean(data))}
              disabled={isLoading || isRefreshing}
            >
              <RefreshCw className={cn("size-4", isLoading || isRefreshing ? "animate-spin" : "")} />
              重试
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className={cn("space-y-5", isLoading && !data ? "hidden" : "")}>
        <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
          <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className={cn("grid size-12 shrink-0 place-items-center rounded-xl", healthIconClassName(healthLevel))}>
                {healthLevel === "normal" ? <CheckCircle2 className="size-6" /> : <AlertTriangle className="size-6" />}
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">系统健康概览</h2>
                  <Badge variant={healthBadgeVariant(healthLevel)} className="rounded-md">
                    {healthLabel(healthLevel)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {healthReasons.map((reason) => (
                    <span key={reason} className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="shrink-0 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-500">
              <div className="text-xs text-stone-400">最后刷新</div>
              <div className="mt-1 font-medium text-stone-700">{formatDateTime(summary.health?.refreshed_at)}</div>
            </div>
            <div className="shrink-0 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-500">
              <div className="flex items-center gap-2">
                <ServerCog className="size-4 text-stone-400" />
                <span className="text-xs text-stone-400">{summary.threadHealth.label}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 font-medium text-stone-700">
                {summary.threadHealth.value}
                <Badge variant={summary.threadHealth.variant} className="rounded-md">
                  {summary.threadHealth.hint}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {metricCards.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.label} className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
                <CardContent className="p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-stone-400">{item.label}</div>
                      <div className="mt-1 text-xs text-stone-400">{item.hint}</div>
                    </div>
                    <Icon className="size-4 shrink-0 text-stone-400" />
                  </div>
                  <div className={cn("truncate text-[1.55rem] font-semibold tracking-tight", item.color)}>{item.value}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <Gauge className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">生图运营看板</h2>
                    <p className="text-xs text-stone-500">首屏聚焦容量、成功率、耗时和待处理队列</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="rounded-xl border-stone-200 bg-white">
                  <Link href="/image-manager">查看图片库</Link>
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {opsCards.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="rounded-xl bg-stone-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-stone-400">{item.label}</span>
                        <Icon className="size-4 text-stone-400" />
                      </div>
                      <div className="mt-2 truncate text-lg font-semibold text-stone-800">{item.value}</div>
                      <div className="mt-1 truncate text-xs text-stone-500">{item.hint}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
                  <AlertTriangle className="size-4 text-amber-500" />
                  最近失败
                </div>
                <Button asChild variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-stone-500">
                  <Link href="/logs?type=call&status=failed">日志</Link>
                </Button>
              </div>
              {summary.failureReasons.length > 0 ? (
                <div className="space-y-2">
                  {summary.failureReasons.slice(0, 3).map((item: DashboardFailureReason, index: number) => (
                    <div key={`${item.reason || "failure"}-${item.endpoint || index}`} className="rounded-xl bg-stone-50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-stone-700">{item.reason || "上游调用失败"}</span>
                        <span className="shrink-0 text-xs font-semibold text-rose-600">{formatNumber(item.count)} 次</span>
                      </div>
                      <div className="mt-1 truncate text-xs text-stone-400">{compactEndpoint(item.endpoint)} · {formatDateTime(item.last_at)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-xl bg-stone-50 text-sm text-stone-400">
                  最近没有失败记录
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <KeyRound className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">账号池健康</h2>
                    <p className="text-xs text-stone-500">账号状态、图片额度和可用性</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="rounded-xl border-stone-200 bg-white">
                    <Link href="/accounts">查看号池</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="rounded-xl border-stone-200 bg-white">
                    <Link href="/accounts">刷新账号</Link>
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                {accountStats.map((item) => (
                  <div key={item.label} className="rounded-xl bg-stone-50 px-4 py-3">
                    <div className="text-xs text-stone-400">{item.label}</div>
                    <div className="mt-1 font-medium text-stone-700">{item.value}</div>
                  </div>
                ))}
              </div>
              {summary.imageQuotaUnknown ? (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                  存在图片额度未知账号，建议刷新号池后再判断容量。
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <ImageIcon className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">生图链路</h2>
                    <p className="text-xs text-stone-500">图片账号、图片调用和最近耗时</p>
                  </div>
                </div>
                <Badge variant={summary.imageAvailable === 0 ? "danger" : summary.imageAvailable !== undefined && summary.imageAvailable <= 3 ? "warning" : "success"} className="rounded-md">
                  可用 {formatNumber(summary.imageAvailable)}
                </Badge>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">图片额度</div>
                  <div className="mt-1 font-medium text-stone-700">{quotaLabel(summary.imageQuotaTotal, summary.imageQuotaUnknown)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">最近成功</div>
                  <div className="mt-1 font-medium text-emerald-700">{hasImageStats ? formatNumber(summary.imageSuccess) : "暂无统计"}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">最近失败</div>
                  <div className="mt-1 font-medium text-rose-600">{hasImageStats ? formatNumber(summary.imageFailed) : "暂无统计"}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">图片调用平均</div>
                  <div className="mt-1 font-medium text-stone-700">{hasImageStats ? formatDuration(summary.imageAvgDuration) : "暂无统计"}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">图片调用 P90 / P99</div>
                  <div className="mt-1 font-medium text-stone-700">
                    {hasImageStats ? `${formatDuration(summary.imageP90Duration)} / ${formatDuration(summary.imageP99Duration)}` : "暂无统计"}
                  </div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">任务等待 P90 / P99</div>
                  <div className="mt-1 font-medium text-stone-700">
                    {`${formatDuration(summary.queueP90Wait)} / ${formatDuration(summary.queueP99Wait)}`}
                  </div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">任务执行 P90 / P99</div>
                  <div className="mt-1 font-medium text-stone-700">
                    {`${formatDuration(summary.queueP90Duration)} / ${formatDuration(summary.queueP99Duration)}`}
                  </div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">阶段中</div>
                  <div className="mt-1 font-medium text-stone-700">
                    取号 {formatNumber(summary.queueCheckingOutAccount)} / 提交 {formatNumber(summary.queueSubmitting)} / 生成 {formatNumber(summary.queuePolling)} / 保存 {formatNumber(summary.queueSaving)}
                  </div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3 sm:col-span-3">
                  <div className="text-xs text-stone-400">最后图片调用</div>
                  <div className="mt-1 font-medium text-stone-700">{hasImageStats ? formatDateTime(summary.imageLastAt) : "暂无统计"}</div>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-stone-700">
                    <ShieldCheck className="size-4 text-stone-400" />
                    健康号池巡检
                  </div>
                  <Badge variant={summary.autoRegister?.enabled ? "success" : "secondary"} className="rounded-md">
                    {summary.autoRegister?.enabled ? "已启用" : "未启用"}
                  </Badge>
                </div>
                <div className="grid gap-2 text-xs text-stone-500 sm:grid-cols-4">
                  <div>最低 {formatNumber(Number(summary.autoRegister?.min_available || 0) || undefined)}</div>
                  <div>目标 {formatNumber(summary.autoRegisterTarget)}</div>
                  <div>上限 {formatNumber(summary.autoRegisterMax)}</div>
                  <div>当前 {formatNumber(summary.autoRegisterCurrent)}</div>
                  <div>在途 {formatNumber(summary.autoRegisterInFlight)}</div>
                  <div>失败率 {formatPercentFromParts(summary.autoRegisterFailed, summary.autoRegisterTotal, summary.autoRegisterFailureRate)}</div>
                  <div>间隔 {formatNumber(Number(summary.autoRegister?.check_interval_seconds || 0) || undefined)} 秒</div>
                  <div>冷却 {formatNumber(Number(summary.autoRegister?.cooldown_seconds || 0) || undefined)} 秒</div>
                </div>
                {summary.autoRegisterLastError ? (
                  <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    {summary.autoRegisterLastError}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <Gauge className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">最近失败原因</h2>
                    <p className="text-xs text-stone-500">最近调用失败 Top 5</p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="rounded-xl border-stone-200 bg-white">
                  <Link href="/logs">查看日志</Link>
                </Button>
              </div>
              {summary.failureReasons.length > 0 ? (
                <div className="space-y-2">
                  {summary.failureReasons.map((item: DashboardFailureReason, index: number) => (
                    <div key={`${item.reason || "failure"}-${item.endpoint || index}`} className="flex flex-col gap-2 rounded-xl bg-stone-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={index === 0 ? "warning" : "secondary"} className="rounded-md">
                            {item.reason || "上游调用失败"}
                          </Badge>
                          <span className="text-xs text-stone-400">{compactEndpoint(item.endpoint)}</span>
                        </div>
                        <div className="mt-1 text-xs text-stone-400">最近 {formatDateTime(item.last_at)}</div>
                      </div>
                      <div className="shrink-0 text-sm font-semibold text-stone-700">{formatNumber(item.count)} 次</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-xl bg-stone-50 text-sm text-stone-400">
                  最近没有失败记录
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                  <ListChecks className="size-4 text-stone-600" />
                </div>
                <div>
                  <h2 className="text-base font-semibold tracking-tight">快捷操作</h2>
                  <p className="text-xs text-stone-500">只提供安全跳转，不直接执行高风险操作</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {quickActions.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="flex h-11 items-center justify-between rounded-xl bg-stone-50 px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-100 hover:text-stone-950"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="size-4 shrink-0 text-stone-400" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-stone-400" />
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <Archive className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">备份状态</h2>
                    <p className="text-xs text-stone-500">最近一次备份任务和对象信息</p>
                  </div>
                </div>
                <Badge variant={backupStatus === "异常" ? "danger" : "secondary"} className="rounded-md">
                  {summary.backup.running ? "运行中" : backupStatus}
                </Badge>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">启用状态</div>
                  <div className="mt-1 font-medium text-stone-700">
                    {summary.backup.enabled === undefined ? "—" : summary.backup.enabled ? "已启用" : "未启用"}
                  </div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">最近完成</div>
                  <div className="mt-1 font-medium text-stone-700">{formatDateTime(summary.backup.last_finished_at)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-stone-400">对象 Key</div>
                  <div className="mt-1 truncate font-mono text-xs text-stone-700">{summary.backup.last_object_key || "—"}</div>
                </div>
                {summary.backup.last_error ? (
                  <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700 sm:col-span-2">
                    <div className="text-xs font-medium">最近错误</div>
                    <div className="mt-1 break-words text-xs leading-5">{summary.backup.last_error}</div>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-stone-100">
                    <HardDrive className="size-4 text-stone-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight">存储状态</h2>
                    <p className="text-xs text-stone-500">本地/对象存储占用概览</p>
                  </div>
                </div>
                <Badge variant={storageStatus === "异常" ? "danger" : "secondary"} className="rounded-md">
                  {storageStatus}
                </Badge>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">已用空间</div>
                  <div className="mt-1 font-medium text-stone-700">{formatBytes(summary.storage.used_bytes)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">可用空间</div>
                  <div className="mt-1 font-medium text-stone-700">{formatBytes(summary.storage.free_bytes)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">图片占用</div>
                  <div className="mt-1 font-medium text-stone-700">{formatBytes(summary.storage.images_bytes)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3">
                  <div className="text-xs text-stone-400">备份占用</div>
                  <div className="mt-1 font-medium text-stone-700">{formatBytes(summary.storage.backups_bytes)}</div>
                </div>
                <div className="rounded-xl bg-stone-50 px-4 py-3 sm:col-span-2">
                  <div className="text-xs text-stone-400">后端</div>
                  <div className="mt-1 flex items-center gap-2 font-medium text-stone-700">
                    <Database className="size-4 text-stone-400" />
                    <span className="truncate">{storageBackendLabel(summary.storage)}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <DashboardContent />;
}
