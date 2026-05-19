"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Archive,
  CheckCircle2,
  Clock3,
  Database,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  ServerCog,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchDashboard, type DashboardMetricGroup, type DashboardResponse } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";
import { cn } from "@/lib/utils";

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

function formatNumber(value?: number) {
  if (value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
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

function DashboardContent() {
  const didLoadRef = useRef(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    try {
      const nextData = await fetchDashboard();
      setData(nextData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载仪表盘失败");
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
    const backup = data?.backup || {};
    const storage = data?.storage || {};

    return {
      accountsTotal: pickNumber(accounts, ["total", "accounts", "count"]),
      accountsActive: pickNumber(accounts, ["active", "normal", "available", "enabled"]),
      todaySuccess: pickNumber(today, ["success", "succeeded", "ok"]) ?? pickNumber(calls, ["today_success", "success_today"]),
      todayFailed: pickNumber(today, ["failed", "fail", "error", "errors"]) ?? pickNumber(calls, ["today_failed", "today_fail"]),
      recentSuccess: pickNumber(recent, ["success", "succeeded", "ok"]) ?? pickNumber(calls, ["recent_success", "success"]),
      recentFailed: pickNumber(recent, ["failed", "fail", "error", "errors"]) ?? pickNumber(calls, ["recent_failed", "fail", "failed"]),
      avgDuration: pickNumber(calls, ["avg_duration_ms", "average_duration_ms", "avg_latency_ms", "duration_ms"]),
      backup,
      storage,
    };
  }, [data]);

  const metricCards = [
    {
      label: "账号池",
      value: formatNumber(summary.accountsTotal),
      hint: `可用 ${formatNumber(summary.accountsActive)}`,
      icon: ServerCog,
      color: "text-stone-900",
    },
    {
      label: "今日成功",
      value: formatNumber(summary.todaySuccess),
      hint: "今日调用",
      icon: CheckCircle2,
      color: "text-emerald-600",
    },
    {
      label: "今日失败",
      value: formatNumber(summary.todayFailed),
      hint: "今日调用",
      icon: XCircle,
      color: "text-rose-500",
    },
    {
      label: "最近成功",
      value: formatNumber(summary.recentSuccess),
      hint: "最近窗口",
      icon: Activity,
      color: "text-blue-600",
    },
    {
      label: "最近失败",
      value: formatNumber(summary.recentFailed),
      hint: "最近窗口",
      icon: XCircle,
      color: "text-orange-500",
    },
    {
      label: "平均耗时",
      value: formatDuration(summary.avgDuration),
      hint: "接口调用",
      icon: Clock3,
      color: "text-stone-900",
    },
  ];

  const backupStatus = statusLabel(summary.backup.last_status ?? summary.backup.status);
  const storageStatus = statusLabel(storageStatusValue(summary.storage));

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

      <div className={cn("grid gap-3 md:grid-cols-3 xl:grid-cols-6", isLoading && !data ? "hidden" : "")}>
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

      <div className={cn("grid gap-4 lg:grid-cols-2", isLoading && !data ? "hidden" : "")}>
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
