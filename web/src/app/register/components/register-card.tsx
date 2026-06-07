"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, Network, Plus, Play, RotateCcw, Save, Square, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fetchRegisterClashOptions, selectRegisterClashProxy, type ClashGroup, type RegisterConfig } from "@/lib/api";
import { parseBackendDateTime } from "@/lib/datetime";

import { useSettingsStore } from "../../settings/store";
import type { RegisterSseStatus } from "../page";

const DEFAULT_CLASH: RegisterConfig["clash"] = {
  enabled: false,
  controller_url: "http://127.0.0.1:9090",
  secret: "",
  group: "",
  selected_proxy: "",
  proxy: "http://127.0.0.1:7890",
  keywords: ["日本", "东京", "大阪", "JP", "JPN", "Japan", "Tokyo", "Osaka", "🇯🇵"],
  timeout: 5,
};

function safeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatNumber(value?: number) {
  if (value === undefined) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value?: number) {
  if (value === undefined) {
    return "—";
  }
  return `${Math.round(value * 10) / 10}%`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = parseBackendDateTime(value);
  if (!date) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function sseBadgeMeta(status?: RegisterSseStatus) {
  if (status?.state === "connected") {
    return { label: "SSE 已连接", variant: "success" as const };
  }
  if (status?.state === "connecting") {
    return { label: "SSE 连接中", variant: "warning" as const };
  }
  if (status?.state === "error") {
    return { label: "SSE 重连中", variant: "warning" as const };
  }
  if (status?.state === "unauthorized") {
    return { label: "SSE 未授权", variant: "danger" as const };
  }
  return { label: "SSE 已关闭", variant: "secondary" as const };
}

export function RegisterCard({ sseStatus }: { sseStatus?: RegisterSseStatus }) {
  const config = useSettingsStore((state) => state.registerConfig);
  const isLoading = useSettingsStore((state) => state.isLoadingRegister);
  const isSaving = useSettingsStore((state) => state.isSavingRegister);
  const setProxy = useSettingsStore((state) => state.setRegisterProxy);
  const setTotal = useSettingsStore((state) => state.setRegisterTotal);
  const setThreads = useSettingsStore((state) => state.setRegisterThreads);
  const setMode = useSettingsStore((state) => state.setRegisterMode);
  const setTargetQuota = useSettingsStore((state) => state.setRegisterTargetQuota);
  const setTargetAvailable = useSettingsStore((state) => state.setRegisterTargetAvailable);
  const setCheckInterval = useSettingsStore((state) => state.setRegisterCheckInterval);
  const setRegisterConfig = useSettingsStore((state) => state.setRegisterConfig);
  const setClashField = useSettingsStore((state) => state.setRegisterClashField);
  const setMailField = useSettingsStore((state) => state.setRegisterMailField);
  const addProvider = useSettingsStore((state) => state.addRegisterProvider);
  const updateProvider = useSettingsStore((state) => state.updateRegisterProvider);
  const deleteProvider = useSettingsStore((state) => state.deleteRegisterProvider);
  const save = useSettingsStore((state) => state.saveRegister);
  const toggle = useSettingsStore((state) => state.toggleRegister);
  const reset = useSettingsStore((state) => state.resetRegister);
  const clash = config?.clash || DEFAULT_CLASH;
  const [clashGroups, setClashGroups] = useState<ClashGroup[]>([]);
  const [selectedClashGroup, setSelectedClashGroup] = useState("");
  const [selectedClashProxy, setSelectedClashProxy] = useState("");
  const [isLoadingClashOptions, setIsLoadingClashOptions] = useState(false);
  const [isSwitchingClash, setIsSwitchingClash] = useState(false);
  const [clashStatus, setClashStatus] = useState("");
  const clashGroupOptions = useMemo(() => {
    if (!selectedClashGroup || clashGroups.some((group) => group.name === selectedClashGroup)) {
      return clashGroups;
    }
    return [
      {
        name: selectedClashGroup,
        type: "",
        now: selectedClashProxy,
        all: selectedClashProxy ? [selectedClashProxy] : [],
        nodes: selectedClashProxy ? [{ name: selectedClashProxy }] : [],
      },
      ...clashGroups,
    ];
  }, [clashGroups, selectedClashGroup, selectedClashProxy]);
  const selectedGroup = useMemo(
    () => clashGroupOptions.find((group) => group.name === selectedClashGroup),
    [clashGroupOptions, selectedClashGroup],
  );
  const clashNodes = useMemo(() => {
    const nodes = selectedGroup?.nodes || [];
    if (!selectedClashProxy || nodes.some((node) => node.name === selectedClashProxy)) {
      return nodes;
    }
    return [{ name: selectedClashProxy }, ...nodes];
  }, [selectedGroup, selectedClashProxy]);

  useEffect(() => {
    setSelectedClashGroup(String(clash.group || ""));
    setSelectedClashProxy(String(clash.selected_proxy || ""));
  }, [clash.group, clash.selected_proxy]);

  const updateSelectedClashGroup = (groupName: string) => {
    const group = clashGroups.find((item) => item.name === groupName);
    const nextProxy = String(group?.now || group?.nodes?.[0]?.name || "");
    setSelectedClashGroup(groupName);
    setSelectedClashProxy(nextProxy);
    setClashField("group", groupName);
    setClashField("selected_proxy", nextProxy);
  };

  const updateSelectedClashProxy = (proxyName: string) => {
    setSelectedClashProxy(proxyName);
    setClashField("selected_proxy", proxyName);
  };

  const loadClashOptions = async () => {
    setIsLoadingClashOptions(true);
    setClashStatus("");
    try {
      const data = await fetchRegisterClashOptions(clash);
      const groups = data.clash.groups || [];
      const nextGroup = data.clash.group || groups[0]?.name || "";
      const group = groups.find((item) => item.name === nextGroup);
      const nextProxy = data.clash.active_proxy || group?.now || group?.nodes?.[0]?.name || "";
      setClashGroups(groups);
      setSelectedClashGroup(nextGroup);
      setSelectedClashProxy(nextProxy);
      if (data.clash.proxy_url) {
        setClashField("proxy", data.clash.proxy_url);
      }
      if (nextGroup) {
        setClashField("group", nextGroup);
      }
      if (nextProxy) {
        setClashField("selected_proxy", nextProxy);
      }
      setClashStatus(nextProxy ? `当前：${nextGroup} / ${nextProxy}` : `已读取 ${groups.length} 个节点组`);
      toast.success(`已读取 ${groups.length} 个 Clash 节点组`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 Clash 节点失败";
      setClashStatus(message);
      toast.error(message);
    } finally {
      setIsLoadingClashOptions(false);
    }
  };

  const switchClashProxy = async () => {
    if (!selectedClashGroup || !selectedClashProxy) {
      toast.error("请先选择 Clash 节点组和节点");
      return;
    }
    setIsSwitchingClash(true);
    setClashStatus("");
    try {
      const data = await selectRegisterClashProxy(
        { ...clash, group: selectedClashGroup, selected_proxy: selectedClashProxy },
        selectedClashGroup,
        selectedClashProxy,
      );
      setRegisterConfig(data.register);
      setSelectedClashGroup(String(data.clash.group || selectedClashGroup));
      setSelectedClashProxy(String(data.clash.active_proxy || data.clash.proxy || selectedClashProxy));
      setClashStatus(`已切换：${data.clash.group} / ${data.clash.active_proxy || data.clash.proxy}`);
      toast.success("Clash 节点已切换");
    } catch (error) {
      const message = error instanceof Error ? error.message : "切换 Clash 节点失败";
      setClashStatus(message);
      toast.error(message);
    } finally {
      setIsSwitchingClash(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-stone-200 bg-white/80 p-10">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!config) return null;

  const stats = config.stats || { success: 0, fail: 0, done: 0, running: 0, threads: config.threads };
  const providers = config.mail.providers || [];
  const logs = config.logs || [];
  const attempted = Number(stats.success || 0) + Number(stats.fail || 0);
  const failureRate = safeNumber(stats.failure_rate) ?? (attempted > 0 ? (Number(stats.fail || 0) / attempted) * 100 : undefined);
  const keepaliveTarget = config.mode === "quota"
    ? safeNumber(stats.target_available) ?? safeNumber(config.target_quota)
    : safeNumber(stats.target_available) ?? safeNumber(config.target_available);
  const currentAccounts = safeNumber(stats.current_accounts) ?? safeNumber(stats.current_available);
  const inFlight = safeNumber(stats.in_flight) ?? safeNumber(stats.pending) ?? safeNumber(stats.running);
  const updatedAt = stats.updated_at || sseStatus?.lastEventAt || stats.finished_at || stats.started_at;
  const sseMeta = sseBadgeMeta(sseStatus);
  const updateProviderType = (index: number, type: string) => {
    updateProvider(index, {
      type,
      enable: true,
      ...(type === "cloudflare_temp_email" ? { api_base: "", admin_password: "", domain: [] } : {}),
      ...(type === "tempmail_lol" ? { api_key: "", domain: [] } : {}),
      ...(type === "moemail" ? { api_base: "", api_key: "", domain: [] } : {}),
      ...(type === "inbucket" ? { api_base: "", domain: [], random_subdomain: true } : {}),
      ...(type === "duckmail" ? { api_key: "", default_domain: "duckmail.sbs" } : {}),
      ...(type === "gptmail" ? { api_key: "", default_domain: "" } : {}),
      ...(type === "yyds_mail" ? { api_base: "https://maliapi.215.im/v1", api_key: "", domain: [], subdomain: "", wildcard: false } : {}),
    });
  };

  return (
    <div className="grid min-h-[640px] items-stretch gap-0 overflow-hidden rounded-xl border border-stone-200 bg-white/70 lg:h-[calc(100vh-132px)] xl:grid-cols-2">
      <section className="space-y-4 overflow-y-auto border-b border-stone-200 p-4 xl:border-r xl:border-b-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-stone-100">
                <UserPlus className="size-5 text-stone-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">注册配置</h2>
              </div>
            </div>
            <Button className="h-9 w-full rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800 sm:w-auto" onClick={() => void save()} disabled={isSaving || config.enabled}>
              {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              保存配置
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm text-stone-700">注册模式</label>
              <Select value={config.mode || "total"} onValueChange={(value) => setMode(value as "total" | "quota" | "available")} disabled={config.enabled}>
                <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">注册总数</SelectItem>
                  <SelectItem value="quota">号池剩余额度</SelectItem>
                  <SelectItem value="available">账号总上限</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">注册总数</label>
              <Input value={String(config.total)} onChange={(event) => setTotal(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || config.mode !== "total"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">线程数</label>
              <Input value={String(config.threads)} onChange={(event) => setThreads(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">注册代理</label>
              <Input value={config.proxy} onChange={(event) => setProxy(event.target.value)} placeholder="http://127.0.0.1:7890" className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || clash.enabled} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">目标剩余额度</label>
              <Input value={String(config.target_quota || "")} onChange={(event) => setTargetQuota(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || config.mode !== "quota"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">账号总上限</label>
              <Input value={String(config.target_available || "")} onChange={(event) => setTargetAvailable(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || config.mode !== "available"} />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">检查间隔（秒）</label>
              <Input value={String(config.check_interval || "")} onChange={(event) => setCheckInterval(event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || config.mode === "total"} />
            </div>
          </div>

          <div className="space-y-3 border-t border-stone-200 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-start gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                <Checkbox checked={Boolean(clash.enabled)} onCheckedChange={(checked) => setClashField("enabled", Boolean(checked))} disabled={config.enabled} />
                <span className="space-y-0.5">
                  <span className="flex items-center gap-1.5 font-medium text-stone-800">
                    <Network className="size-3.5" />
                    Clash Verge 节点
                  </span>
                  {clashStatus ? <span className="block max-w-[520px] truncate text-xs text-stone-500">{clashStatus}</span> : null}
                </span>
              </label>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-3 text-stone-700" onClick={() => void loadClashOptions()} disabled={config.enabled || !clash.enabled || isLoadingClashOptions}>
                  {isLoadingClashOptions ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                  读取节点
                </Button>
                <Button type="button" className="h-9 rounded-xl bg-stone-950 px-3 text-white hover:bg-stone-800" onClick={() => void switchClashProxy()} disabled={config.enabled || !clash.enabled || isSwitchingClash || !selectedClashGroup || !selectedClashProxy}>
                  {isSwitchingClash ? <LoaderCircle className="size-4 animate-spin" /> : <Network className="size-4" />}
                  切换节点
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">控制器地址</label>
                <Input value={clash.controller_url} onChange={(event) => setClashField("controller_url", event.target.value)} placeholder="http://127.0.0.1:9090" className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || !clash.enabled} />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">本地代理</label>
                <Input value={clash.proxy} onChange={(event) => setClashField("proxy", event.target.value)} placeholder="http://127.0.0.1:7890" className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || !clash.enabled} />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">节点组</label>
                <Select value={selectedClashGroup} onValueChange={updateSelectedClashGroup} disabled={config.enabled || !clash.enabled || clashGroupOptions.length === 0}>
                  <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                    <SelectValue placeholder="读取后选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {clashGroupOptions.map((group) => (
                      <SelectItem key={group.name} value={group.name}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">节点</label>
                <Select value={selectedClashProxy} onValueChange={updateSelectedClashProxy} disabled={config.enabled || !clash.enabled || clashNodes.length === 0}>
                  <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                    <SelectValue placeholder="读取后选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {clashNodes.map((node) => (
                      <SelectItem key={node.name} value={node.name}>
                        {node.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Secret</label>
                <Input type="password" value={clash.secret} onChange={(event) => setClashField("secret", event.target.value)} placeholder="external-controller-secret" className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled || !clash.enabled} />
              </div>
            </div>
          </div>

          <div className="space-y-3 border-t border-stone-200 pt-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-800">邮箱配置</h3>
                <p className="mt-1 text-xs text-stone-500">可配置多个 provider，按启用顺序轮换。</p>
              </div>
              <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-3 text-stone-700" onClick={addProvider} disabled={config.enabled}>
                <Plus className="size-4" />
                添加
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">请求超时</label>
                <Input value={String(config.mail.request_timeout || "")} onChange={(event) => setMailField("request_timeout", event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">等待验证码超时</label>
                <Input value={String(config.mail.wait_timeout || "")} onChange={(event) => setMailField("wait_timeout", event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">轮询间隔</label>
                <Input value={String(config.mail.wait_interval || "")} onChange={(event) => setMailField("wait_interval", event.target.value)} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
              </div>
            </div>

            <div className="space-y-3">
              {providers.map((provider, index) => {
                const type = String(provider.type || "tempmail_lol");
                const domains = Array.isArray(provider.domain) ? provider.domain.map(String).join("\n") : "";
                return (
                  <div key={index} className="space-y-3 border-t border-stone-200 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-3 text-sm text-stone-700">
                        <Checkbox checked={Boolean(provider.enable)} onCheckedChange={(checked) => updateProvider(index, { enable: Boolean(checked) })} disabled={config.enabled} />
                        启用
                      </label>
                      <button type="button" className="rounded-lg p-2 text-stone-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-50" onClick={() => deleteProvider(index)} disabled={config.enabled || providers.length <= 1} title="删除 provider">
                        <Trash2 className="size-4" />
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm text-stone-700">类型</label>
                        <Select value={type} onValueChange={(value) => updateProviderType(index, value)} disabled={config.enabled}>
                          <SelectTrigger className="h-10 rounded-xl border-stone-200 bg-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cloudflare_temp_email">cloudflare_temp_email</SelectItem>
                            <SelectItem value="tempmail_lol">tempmail_lol</SelectItem>
                            <SelectItem value="moemail">moemail</SelectItem>
                            <SelectItem value="inbucket">inbucket_mail</SelectItem>
                            <SelectItem value="duckmail">duckmail</SelectItem>
                            <SelectItem value="gptmail">gptmail(未测试)</SelectItem>
                            <SelectItem value="yyds_mail">yyds_mail</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {type === "cloudflare_temp_email" || type === "moemail" || type === "inbucket" || type === "yyds_mail" ? (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm text-stone-700">API Base</label>
                            <Input value={String(provider.api_base || "")} onChange={(event) => updateProvider(index, { api_base: event.target.value })} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
                          </div>
                          {type === "cloudflare_temp_email" ? (
                            <div className="space-y-2">
                              <label className="text-sm text-stone-700">Admin Password</label>
                              <Input value={String(provider.admin_password || "")} onChange={(event) => updateProvider(index, { admin_password: event.target.value })} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {type === "inbucket" ? (
                        <label className="flex items-center gap-3 pt-8 text-sm text-stone-700">
                          <Checkbox checked={Boolean(provider.random_subdomain ?? true)} onCheckedChange={(checked) => updateProvider(index, { random_subdomain: Boolean(checked) })} disabled={config.enabled} />
                          启用随机子域名
                        </label>
                      ) : null}
                      {type === "tempmail_lol" || type === "moemail" || type === "duckmail" || type === "gptmail" || type === "yyds_mail" ? (
                        <div className="space-y-2">
                          <label className="text-sm text-stone-700">API Key</label>
                          <Input value={String(provider.api_key || "")} onChange={(event) => updateProvider(index, { api_key: event.target.value })} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
                        </div>
                      ) : null}
                      {type === "duckmail" || type === "gptmail" ? (
                        <div className="space-y-2">
                          <label className="text-sm text-stone-700">Default Domain</label>
                          <Input value={String(provider.default_domain || "")} onChange={(event) => updateProvider(index, { default_domain: event.target.value })} placeholder={type === "duckmail" ? "duckmail.sbs" : ""} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
                        </div>
                      ) : null}
                      {type === "yyds_mail" ? (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm text-stone-700">Subdomain</label>
                            <Input value={String(provider.subdomain || "")} onChange={(event) => updateProvider(index, { subdomain: event.target.value })} className="h-10 rounded-xl border-stone-200 bg-white" disabled={config.enabled} />
                          </div>
                          <label className="flex items-center gap-3 pt-8 text-sm text-stone-700">
                            <Checkbox checked={Boolean(provider.wildcard)} onCheckedChange={(checked) => updateProvider(index, { wildcard: Boolean(checked) })} disabled={config.enabled} />
                            Wildcard
                          </label>
                        </>
                      ) : null}
                    </div>

                    {type === "tempmail_lol" || type === "cloudflare_temp_email" || type === "moemail" || type === "inbucket" || type === "yyds_mail" ? (
                      <div className="space-y-2">
                        <label className="text-sm text-stone-700">{type === "inbucket" ? "基础域名列表" : "Domain"}</label>
                        <Textarea value={domains} onChange={(event) => updateProvider(index, { domain: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) })} placeholder={type === "inbucket" ? "每行一个基础域名，系统会自动生成随机子域名" : type === "moemail" ? "每行一个域名" : "每行一个域名，留空则使用服务默认域名"} className="min-h-20 rounded-xl border-stone-200 bg-white font-mono text-xs" disabled={config.enabled} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

      </section>

      <section className="flex min-h-0 flex-col p-4">
        <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">运行结果</h2>
                <p className="mt-1 text-sm text-stone-500">SSE 实时推送当前状态。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={sseMeta.variant} className="rounded-md">
                  {sseMeta.label}
                </Badge>
                <Badge variant={config.enabled ? "success" : "secondary"} className="rounded-md">
                  {config.enabled ? "运行中" : "已停止"}
                </Badge>
              </div>
            </div>
            {sseStatus?.message ? (
              <div className="rounded-lg border border-stone-200 bg-white/70 px-3 py-2 text-xs text-stone-500">
                {sseStatus.message}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {[
                ["最近更新时间", formatDateTime(updatedAt)],
                ["保活目标", formatNumber(keepaliveTarget)],
                ["当前账号", formatNumber(currentAccounts)],
                ["在途注册", formatNumber(inFlight)],
                ["失败率", formatPercent(failureRate)],
                ["失败数", formatNumber(safeNumber(stats.fail))],
              ].map(([label, value]) => (
                <div key={label} className="border border-stone-200 bg-white/70 px-3 py-2">
                  <div className="text-xs text-stone-400">{label}</div>
                  <div className="mt-1 truncate text-base font-semibold text-stone-800">{value}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["成功 / 成功率", `${stats.success} / ${stats.success_rate || 0}%`],
                ["失败", stats.fail],
                ["完成", stats.done],
                ["运行 / 线程", `${stats.running} / ${stats.threads}`],
                ["运行时间", `${stats.elapsed_seconds || 0}s`],
                ["平均注册单个", `${stats.avg_seconds || 0}s`],
                ["当前额度", stats.current_quota || 0],
                ["正常账号", stats.current_available || 0],
              ].map(([label, value]) => (
                <div key={label} className="border border-stone-200 bg-white/70 px-3 py-2">
                  <div className="text-xs text-stone-400">{label}</div>
                  <div className="mt-1 truncate text-base font-semibold text-stone-800">{value}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button className="h-10 rounded-xl bg-stone-950 px-3 text-white hover:bg-stone-800" onClick={() => void toggle()} disabled={isSaving}>
                {isSaving ? <LoaderCircle className="size-4 animate-spin" /> : config.enabled ? <Square className="size-4" /> : <Play className="size-4" />}
                {config.enabled ? "停止" : "启动"}
              </Button>
              <Button variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-3 text-stone-700" onClick={() => void reset()} disabled={isSaving || config.enabled}>
                <RotateCcw className="size-4" />
                重置
              </Button>
              <Button variant="outline" className="h-10 rounded-xl border-stone-200 bg-white px-3 text-stone-700" onClick={() => void save()} disabled={isSaving || config.enabled}>
                <Save className="size-4" />
                保存
              </Button>
            </div>
            <div className="flex items-center gap-2 border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="size-4 shrink-0" />
              启动之前注意先保存配置。
            </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col space-y-3 overflow-hidden border-t border-stone-200 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-stone-900">实时日志</h3>
                <p className="mt-1 text-xs text-amber-700">遇到 HTTP 状态码 400 等错误，基本是邮箱滥用被封，需要更换新的域名邮箱。</p>
              </div>
              <Badge variant="secondary" className="rounded-md">
                {logs.length}
              </Badge>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border border-stone-200 bg-white/70 p-3 font-mono text-xs leading-6">
              {logs.length === 0 ? (
                <div className="text-stone-500">暂无日志</div>
              ) : (
                logs.slice().reverse().map((item, index) => (
                  <div key={`${item.time}-${index}`} className={item.level === "red" ? "text-rose-600" : item.level === "green" ? "text-emerald-700" : item.level === "yellow" ? "text-amber-700" : "text-stone-700"}>
                    <span className="text-stone-400">
                      {parseBackendDateTime(item.time)?.toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) || item.time}
                    </span>
                    <span className="pl-2">{item.text}</span>
                  </div>
                ))
              )}
            </div>
        </div>
      </section>
    </div>
  );
}
