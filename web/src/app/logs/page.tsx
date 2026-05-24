"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ImageIcon, LoaderCircle, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { DateRangeFilter } from "@/components/date-range-filter";
import { ImageLightbox } from "@/components/image-lightbox";
import { ImageThumbnail, getImageThumbnailUrl } from "@/components/image-thumbnail";
import { AuthenticatedImage } from "@/components/authenticated-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteSystemLogs, fetchSystemLogs, type SystemLog } from "@/lib/api";
import { useAuthGuard } from "@/lib/use-auth-guard";

const LogType = {
  Call: "call",
  Text: "text",
  Account: "account",
} as const;

const typeLabels: Record<string, string> = {
  [LogType.Call]: "图片调用日志",
  [LogType.Text]: "文本生成日志",
  [LogType.Account]: "账号管理日志",
};

const textLogEndpoints = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/embeddings"]);
const textLogSummaryPrefixes = ["文本生成", "Responses", "Messages", "Embeddings"];

const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "成功", value: "success" },
  { label: "失败", value: "failed" },
] as const;

function initialLogFilters() {
  if (typeof window === "undefined") {
    return { type: LogType.Call, startDate: "", endDate: "", status: "all", query: "" };
  }
  const params = new URLSearchParams(window.location.search);
  const nextType = params.get("type") || params.get("log_type") || LogType.Call;
  return {
    type: Object.values(LogType).includes(nextType as (typeof LogType)[keyof typeof LogType]) ? nextType : LogType.Call,
    startDate: params.get("start_date") || params.get("start") || "",
    endDate: params.get("end_date") || params.get("end") || "",
    status: params.get("status") || "all",
    query: params.get("q") || params.get("query") || params.get("keyword") || "",
  };
}

function getDetailText(item: SystemLog, key: string) {
  const value = item.detail?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "-";
}

function formatDuration(item: SystemLog) {
  const value = item.detail?.duration_ms;
  return typeof value === "number" ? `${(value / 1000).toFixed(2)} s` : "-";
}

function formatSummary(item: SystemLog) {
  const summary = item.summary || "-";
  if (item.type === LogType.Account && typeof item.detail?.duration_ms === "number") {
    return summary.replace(/，耗时\s*\d+(?:\.\d+)?\s*s$/, "");
  }
  return summary;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function getUrls(item: SystemLog | null) {
  const urls = item?.detail?.urls;
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string") : [];
}

function getStatus(item: SystemLog) {
  const status = item.detail?.status;
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  return "-";
}

function getStatusValue(item: SystemLog) {
  const status = item.detail?.status;
  return typeof status === "string" ? status : "";
}

function getLogType(item: SystemLog) {
  if (item.type === LogType.Text) return LogType.Text;
  if (item.type !== LogType.Call) return item.type;
  const endpoint = typeof item.detail?.endpoint === "string" ? item.detail.endpoint : "";
  const summary = item.summary || "";
  return textLogEndpoints.has(endpoint) || textLogSummaryPrefixes.some((prefix) => summary.startsWith(prefix))
    ? LogType.Text
    : LogType.Call;
}

function normalizeLogItem(item: SystemLog): SystemLog {
  const normalizedType = getLogType(item);
  return normalizedType === item.type ? item : { ...item, type: normalizedType };
}

function mergeLogs(...groups: SystemLog[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function logMatchesQuery(item: SystemLog, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.time,
    item.type,
    item.summary,
    item.detail?.endpoint,
    item.detail?.model,
    item.detail?.key_name,
    item.detail?.error,
    item.detail?.request_text,
  ].some((value) => String(value || "").toLowerCase().includes(normalized));
}

function detailSectionEntries(item: SystemLog | null, keys: string[]) {
  const detail = item?.detail || {};
  return keys
    .filter((key) => detail[key] !== undefined)
    .map((key) => [key, detail[key]] as const);
}

function LogsContent() {
  const initialFilters = useMemo(initialLogFilters, []);
  const [items, setItems] = useState<SystemLog[]>([]);
  const [type, setType] = useState<string>(initialFilters.type);
  const [startDate, setStartDate] = useState(initialFilters.startDate);
  const [endDate, setEndDate] = useState(initialFilters.endDate);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [query, setQuery] = useState(initialFilters.query);
  const [detailLog, setDetailLog] = useState<SystemLog | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingItems, setDeletingItems] = useState<SystemLog[]>([]);
  const detailUrls = getUrls(detailLog);
  const detailImages = detailUrls.map((url, index) => ({ id: `${index}`, src: url }));
  const isCallLog = type === LogType.Call;
  const isTextLog = type === LogType.Text;
  const hasCallMeta = isCallLog || isTextLog;
  const showDuration = hasCallMeta || type === LogType.Account;
  const showImages = isCallLog;
  const pageSize = 10;
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const statusMatched = statusFilter === "all" || getStatusValue(item) === statusFilter;
      return statusMatched && logMatchesQuery(item, query);
    });
  }, [items, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const currentRows = filteredItems.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const currentPageSelected = currentRows.length > 0 && currentRows.every((item) => selectedSet.has(item.id));
  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedSet.has(item.id));
  const detailCoreEntries = detailSectionEntries(detailLog, ["status", "endpoint", "model", "key_name", "role", "duration_ms"]);
  const detailTimingEntries = detailSectionEntries(detailLog, ["started_at", "ended_at"]);
  const detailErrorEntries = detailSectionEntries(detailLog, ["error", "request_text"]);
  const detailOtherEntries = Object.entries(detailLog?.detail || {}).filter(
    ([key, value]) =>
      !["urls", "status", "endpoint", "model", "key_name", "role", "duration_ms", "started_at", "ended_at", "error", "request_text"].includes(key) &&
      typeof value !== "object",
  );

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const filters = { start_date: startDate, end_date: endDate };
      const data = type === LogType.Text
        ? await Promise.all([
          fetchSystemLogs({ ...filters, type: LogType.Text }),
          fetchSystemLogs({ ...filters, type: LogType.Call }),
        ]).then(([textLogs, callLogs]) => ({ items: mergeLogs(textLogs.items, callLogs.items) }))
        : await fetchSystemLogs({ ...filters, type });
      const normalizedItems = data.items.map(normalizeLogItem).filter((item) => item.type === type);
      setItems(normalizedItems);
      setLoadError("");
      setSelectedIds((current) => current.filter((id) => normalizedItems.some((item) => item.id === id)));
      setPage(1);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载日志失败";
      setLoadError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [endDate, startDate, type]);

  const clearFilters = () => {
    setStartDate("");
    setEndDate("");
    setStatusFilter("all");
    setQuery("");
  };

  const openDetail = (item: SystemLog) => {
    setDetailLog(item);
    setDetailOpen(true);
  };

  const openLogImage = (item: SystemLog, index: number) => {
    setDetailLog(item);
    setLightboxIndex(index);
    setLightboxOpen(true);
  };

  const toggleIds = (ids: string[], checked: boolean) => {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, ...ids])) : current.filter((id) => !ids.includes(id)));
  };

  const confirmDelete = async () => {
    const ids = deletingItems.map((item) => item.id);
    if (ids.length === 0) return;
    setIsDeleting(true);
    try {
      const data = await deleteSystemLogs(ids);
      toast.success(`已删除 ${data.removed} 条日志`);
      setDeletingItems([]);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      if (detailLog && ids.includes(detailLog.id)) {
        setDetailOpen(false);
        setDetailLog(null);
      }
      await loadLogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除日志失败");
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Logs</div>
          <h1 className="text-2xl font-semibold tracking-tight">日志管理</h1>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white lg:w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={LogType.Call}>图片调用日志</SelectItem>
              <SelectItem value={LogType.Text}>文本生成日志</SelectItem>
              <SelectItem value={LogType.Account}>账号管理日志</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
            <SelectTrigger className="h-10 w-full rounded-xl border-stone-200 bg-white lg:w-[118px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0 sm:col-span-2 lg:min-w-[220px]">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-stone-400" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="搜索摘要/模型/错误"
              className="h-10 rounded-xl border-stone-200 bg-white pl-10"
            />
          </div>
          <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(start, end) => { setStartDate(start); setEndDate(end); }} />
          <Button variant="outline" onClick={clearFilters} className="h-10 rounded-xl border-stone-200 bg-white px-4 text-stone-700">
            清除筛选条件
          </Button>
          <Button onClick={() => void loadLogs()} disabled={isLoading} className="h-10 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800">
            {isLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            查询
          </Button>
        </div>
      </div>

      {loadError ? (
        <Card className="rounded-2xl border-rose-100 bg-rose-50/90 shadow-sm">
          <CardContent className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3 text-rose-700">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">日志加载失败</div>
                <div className="mt-1 break-words text-xs leading-5 text-rose-600">{loadError}</div>
              </div>
            </div>
            <Button variant="outline" className="h-9 shrink-0 rounded-xl border-rose-200 bg-white px-3 text-rose-700 hover:bg-rose-50" onClick={() => void loadLogs()} disabled={isLoading}>
              <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
              重试
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-stone-600">
              <span>共 {filteredItems.length} 条</span>
              {filteredItems.length !== items.length ? <span className="text-stone-400">筛选自 {items.length} 条</span> : null}
              <label className="flex items-center gap-2">
                <Checkbox checked={currentPageSelected} onCheckedChange={(checked) => toggleIds(currentRows.map((item) => item.id), Boolean(checked))} />
                本页全选
              </label>
              <label className="flex items-center gap-2">
                <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleIds(filteredItems.map((item) => item.id), Boolean(checked))} />
                全选结果
              </label>
              {selectedIds.length > 0 ? <span>已选 {selectedIds.length} 条</span> : null}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <Button variant="ghost" className="h-8 rounded-lg px-3 text-stone-500" onClick={() => void loadLogs()} disabled={isLoading}>
                <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
                刷新
              </Button>
              <button type="button" className="text-sm text-stone-500 hover:text-stone-900 disabled:text-stone-300" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0 || isDeleting}>
                取消选择
              </button>
              <Button variant="outline" className="h-8 rounded-lg border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50" onClick={() => setDeletingItems(items.filter((item) => selectedSet.has(item.id)))} disabled={selectedIds.length === 0 || isDeleting}>
                <Trash2 className="size-4" />
                删除所选
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>时间</TableHead>
                  <TableHead>类型</TableHead>
                  {hasCallMeta ? <TableHead>令牌名称</TableHead> : null}
                  {showDuration ? <TableHead>接口耗时</TableHead> : null}
                  {hasCallMeta ? <TableHead>状态</TableHead> : null}
                  {hasCallMeta ? <TableHead>模型</TableHead> : null}
                  {showImages ? <TableHead className="w-36">图片</TableHead> : null}
                  <TableHead>简述</TableHead>
                  <TableHead className="w-40">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentRows.map((item) => {
                  const urls = getUrls(item);
                  return (
                    <TableRow key={item.id} className="text-stone-600">
                      <TableCell>
                        <Checkbox checked={selectedSet.has(item.id)} onCheckedChange={(checked) => toggleIds([item.id], Boolean(checked))} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{item.time}</TableCell>
                      <TableCell><Badge variant="secondary" className="rounded-md">{typeLabels[item.type] || item.type}</Badge></TableCell>
                      {hasCallMeta ? <TableCell>{getDetailText(item, "key_name")}</TableCell> : null}
                      {showDuration ? <TableCell className="whitespace-nowrap tabular-nums">{formatDuration(item)}</TableCell> : null}
                      {hasCallMeta ? (
                        <TableCell>
                          <Badge variant={item.detail?.status === "failed" ? "danger" : "success"} className="rounded-md">
                            {getStatus(item)}
                          </Badge>
                        </TableCell>
                      ) : null}
                      {hasCallMeta ? <TableCell>{getDetailText(item, "model")}</TableCell> : null}
                      {showImages ? (
                        <TableCell>
                          {urls.length ? (
                            <div className="flex items-center gap-1.5">
                              {urls.slice(0, 3).map((url, imageIndex) => (
                                <button
                                  key={`${url}-${imageIndex}`}
                                  type="button"
                                  className="relative size-9 overflow-hidden rounded-lg border border-stone-200 bg-stone-100"
                                  onClick={() => openLogImage(item, imageIndex)}
                                  title="预览图片"
                                >
                                  <ImageThumbnail src={url} thumbnailSrc={getImageThumbnailUrl(url)} className="h-full w-full" />
                                </button>
                              ))}
                              {urls.length > 3 ? <span className="text-xs text-stone-400">+{urls.length - 3}</span> : null}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-stone-400">
                              <ImageIcon className="size-3.5" />
                              -
                            </span>
                          )}
                        </TableCell>
                      ) : null}
                      <TableCell className="max-w-[420px] truncate text-stone-500">{formatSummary(item)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" className="h-8 rounded-lg px-3 text-stone-600" onClick={() => openDetail(item)}>
                            查看详情
                          </Button>
                          <Button variant="ghost" className="h-8 rounded-lg px-3 text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => setDeletingItems([item])}>
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 text-sm text-stone-500">
            <span>第 {safePage} / {pageCount} 页，共 {filteredItems.length} 条</span>
            <Button variant="outline" size="icon" className="size-9 rounded-lg border-stone-200 bg-white" disabled={safePage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="icon" className="size-9 rounded-lg border-stone-200 bg-white" disabled={safePage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          {!isLoading && filteredItems.length === 0 ? <div className="px-6 py-14 text-center text-sm text-stone-500">没有找到日志</div> : null}
        </CardContent>
      </Card>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="flex h-[min(88vh,860px)] w-[min(92vw,920px)] flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b border-stone-100 px-6 py-5">
            <DialogTitle>日志详情</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600 md:grid-cols-3">
                <div>
                  <div className="text-xs text-stone-400">时间</div>
                  <div className="mt-1 font-medium text-stone-700">{detailLog?.time || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-stone-400">类型</div>
                  <div className="mt-1 font-medium text-stone-700">{detailLog ? typeLabels[detailLog.type] || detailLog.type : "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-stone-400">摘要</div>
                  <div className="mt-1 font-medium break-words text-stone-700">{detailLog ? formatSummary(detailLog) : "-"}</div>
                </div>
              </div>
              {[
                { title: "调用信息", entries: detailCoreEntries },
                { title: "时间线", entries: detailTimingEntries },
                { title: "错误与请求", entries: detailErrorEntries },
                { title: "其他字段", entries: detailOtherEntries },
              ].filter((section) => section.entries.length > 0).map((section) => (
                <div key={section.title} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="mb-3 text-sm font-medium text-stone-700">{section.title}</div>
                  <div className="grid gap-3 text-sm text-stone-600 md:grid-cols-2">
                    {section.entries.map(([key, value]) => (
                      <div key={key} className="flex items-start justify-between gap-4">
                        <span className="shrink-0 text-stone-400">{key}</span>
                        <span className="text-right font-medium break-all text-stone-700">{formatValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {detailUrls.length ? (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {detailUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      className="aspect-square overflow-hidden rounded-xl border border-stone-200 bg-stone-100"
                      onClick={() => {
                        setLightboxIndex(index);
                        setLightboxOpen(true);
                      }}
                    >
                      <AuthenticatedImage src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
              <pre className="max-h-[72vh] overflow-auto rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs leading-6 text-stone-700">
                {JSON.stringify(detailLog?.detail || {}, null, 2)}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ImageLightbox
        images={detailImages}
        currentIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onIndexChange={setLightboxIndex}
      />
      <Dialog open={deletingItems.length > 0} onOpenChange={(open) => (!open ? setDeletingItems([]) : null)}>
        <DialogContent showCloseButton={false} className="rounded-2xl p-6">
          <DialogHeader className="gap-2">
            <DialogTitle>{deletingItems.length === 1 ? "删除日志" : "删除所选日志"}</DialogTitle>
            <DialogDescription className="text-sm leading-6">
              确认删除 {deletingItems.length} 条日志吗？删除后无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl" onClick={() => setDeletingItems([])} disabled={isDeleting}>
              取消
            </Button>
            <Button className="rounded-xl bg-rose-600 text-white hover:bg-rose-700" onClick={() => void confirmDelete()} disabled={isDeleting || deletingItems.length === 0}>
              {isDeleting ? <LoaderCircle className="size-4 animate-spin" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function LogsPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);
  if (isCheckingAuth || !session || session.role !== "admin") {
    return <div className="flex min-h-[40vh] items-center justify-center"><LoaderCircle className="size-5 animate-spin text-stone-400" /></div>;
  }
  return <LogsContent />;
}
