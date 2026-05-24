"use client";

import { ChevronDown, LoaderCircle, PlugZap, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { testProxy, type ProxyTestResult, type SettingsDiagnosticItem } from "@/lib/api";

import { useSettingsStore } from "../store";

const diagnosticPriority = [
  "auth-key",
  "base_url",
  "proxy",
  "storage.backend",
  "storage.database_url",
  "auto_register",
  "account_pool",
  "log_levels",
  "backup.enabled",
  "backup.secret_access_key",
  "backup.passphrase",
  "ai_review.enabled",
  "ai_review.api_key",
];

const sourceLabels: Record<string, string> = {
  env: "环境变量",
  "config.json": "config.json",
  default: "默认值",
  missing: "缺失",
};

function sourceLabel(source: string) {
  return sourceLabels[source] || source;
}

function sourceVariant(source: string): "success" | "info" | "danger" | "outline" {
  if (source === "env") return "success";
  if (source === "config.json") return "info";
  if (source === "missing") return "danger";
  return "outline";
}

function diagnosticValue(item: SettingsDiagnosticItem) {
  if (item.sensitive) {
    return item.status;
  }
  return item.value || item.status;
}

function sortDiagnostics(items: SettingsDiagnosticItem[]) {
  const order = new Map(diagnosticPriority.map((key, index) => [key, index]));
  return [...items].sort((left, right) => {
    const leftIndex = order.get(left.key) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = order.get(right.key) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex || left.label.localeCompare(right.label, "zh-CN");
  });
}

export function ConfigCard() {
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<ProxyTestResult | null>(null);
  const logLevelOptions = ["debug", "info", "warning", "error"];
  const config = useSettingsStore((state) => state.config);
  const configDiagnostics = useSettingsStore((state) => state.configDiagnostics);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const isSavingAutoRegister = useSettingsStore((state) => state.isSavingAutoRegister);
  const setRefreshAccountIntervalMinute = useSettingsStore((state) => state.setRefreshAccountIntervalMinute);
  const setImageRetentionDays = useSettingsStore((state) => state.setImageRetentionDays);
  const setImagePollTimeoutSecs = useSettingsStore((state) => state.setImagePollTimeoutSecs);
  const setImageAccountConcurrency = useSettingsStore((state) => state.setImageAccountConcurrency);
  const setAutoRemoveInvalidAccounts = useSettingsStore((state) => state.setAutoRemoveInvalidAccounts);
  const setAutoRemoveRateLimitedAccounts = useSettingsStore((state) => state.setAutoRemoveRateLimitedAccounts);
  const setLogLevel = useSettingsStore((state) => state.setLogLevel);
  const setProxy = useSettingsStore((state) => state.setProxy);
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl);
  const setGlobalSystemPrompt = useSettingsStore((state) => state.setGlobalSystemPrompt);
  const setSensitiveWordsText = useSettingsStore((state) => state.setSensitiveWordsText);
  const setAIReviewField = useSettingsStore((state) => state.setAIReviewField);
  const setAutoRegisterField = useSettingsStore((state) => state.setAutoRegisterField);
  const setAccountPoolField = useSettingsStore((state) => state.setAccountPoolField);
  const saveConfig = useSettingsStore((state) => state.saveConfig);
  const saveAutoRegister = useSettingsStore((state) => state.saveAutoRegister);
  const diagnosticItems = sortDiagnostics(configDiagnostics?.items ?? []);

  const handleTestProxy = async () => {
    const candidate = String(config?.proxy || "").trim();
    if (!candidate) {
      toast.error("请先填写代理地址");
      return;
    }
    setIsTestingProxy(true);
    setProxyTestResult(null);
    try {
      const data = await testProxy(candidate);
      setProxyTestResult(data.result);
      if (data.result.ok) {
        toast.success(`代理可用（${data.result.latency_ms} ms，HTTP ${data.result.status}）`);
      } else {
        toast.error(`代理不可用：${data.result.error ?? "未知错误"}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试代理失败");
    } finally {
      setIsTestingProxy(false);
    }
  };

  if (isLoadingConfig) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-4 p-6">
        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
          管理员登录密钥继续从部署配置读取，不再在此页面展示；如需分发给其他人，请在下方创建普通用户密钥。
        </div>
        {diagnosticItems.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-stone-800">配置来源诊断</div>
                <div className="mt-1 text-xs text-stone-500">敏感项仅显示设置状态，不显示明文。</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-md border-stone-200 text-stone-500">
                  {configDiagnostics?.config_file ? "config.json" : "运行配置"}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-lg border-stone-200 bg-white px-3 text-xs text-stone-600"
                  onClick={() => setIsDiagnosticsOpen((open) => !open)}
                  aria-expanded={isDiagnosticsOpen}
                >
                  <ChevronDown className={`size-4 transition-transform ${isDiagnosticsOpen ? "rotate-180" : ""}`} />
                  {isDiagnosticsOpen ? "收起诊断" : "展开诊断"}
                </Button>
              </div>
            </div>
            {isDiagnosticsOpen ? (
              <div className="overflow-x-auto border-t border-stone-100">
                <div className="min-w-[760px] divide-y divide-stone-100 text-sm">
                  <div className="grid grid-cols-[1.25fr_0.9fr_1fr_1.25fr] gap-3 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500">
                    <span>配置项</span>
                    <span>来源</span>
                    <span>状态</span>
                    <span>环境变量</span>
                  </div>
                  {diagnosticItems.map((item) => (
                    <div key={item.key} className="grid grid-cols-[1.25fr_0.9fr_1fr_1.25fr] gap-3 px-4 py-2.5 text-stone-600">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-stone-700">{item.label}</div>
                        <div className="truncate text-xs text-stone-400">{item.key}</div>
                      </div>
                      <div>
                        <Badge variant={sourceVariant(item.source)} className="rounded-md">
                          {sourceLabel(item.source)}
                        </Badge>
                      </div>
                      <div className={item.configured ? "font-medium text-emerald-700" : "font-medium text-stone-400"}>
                        {diagnosticValue(item)}
                      </div>
                      <div className="truncate font-mono text-xs text-stone-400">{item.env || "-"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm text-stone-700">账号刷新间隔</label>
            <Input
              value={String(config?.refresh_account_interval_minute || "")}
              onChange={(event) => setRefreshAccountIntervalMinute(event.target.value)}
              placeholder="分钟"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">单位分钟，控制账号自动刷新频率。</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">全局代理</label>
            <Input
              value={String(config?.proxy || "")}
              onChange={(event) => {
                setProxy(event.target.value);
                setProxyTestResult(null);
              }}
              placeholder="http://127.0.0.1:7890"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">留空表示不使用代理。</p>
            {proxyTestResult ? (
              <div
                className={`rounded-xl border px-3 py-2 text-xs leading-6 ${
                  proxyTestResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
              >
                {proxyTestResult.ok
                  ? `代理可用：HTTP ${proxyTestResult.status}，用时 ${proxyTestResult.latency_ms} ms`
                  : `代理不可用：${proxyTestResult.error ?? "未知错误"}（用时 ${proxyTestResult.latency_ms} ms）`}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700"
                onClick={() => void handleTestProxy()}
                disabled={isTestingProxy}
              >
                {isTestingProxy ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                测试代理
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片访问地址</label>
            <Input
              value={String(config?.base_url || "")}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://example.com"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">用于生成图片结果的访问前缀地址。</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片自动清理</label>
            <Input
              value={String(config?.image_retention_days || "")}
              onChange={(event) => setImageRetentionDays(event.target.value)}
              placeholder="30"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">自动删除多少天前的本地图片。</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">图片轮询超时</label>
            <Input
              value={String(config?.image_poll_timeout_secs || "")}
              onChange={(event) => setImagePollTimeoutSecs(event.target.value)}
              placeholder="120"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">单位秒，等待上游图片结果的最长时间。</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-stone-700">单账号图片并发</label>
            <Input
              value={String(config?.image_account_concurrency || "")}
              onChange={(event) => setImageAccountConcurrency(event.target.value)}
              placeholder="1"
              className="h-10 rounded-xl border-stone-200 bg-white"
            />
            <p className="text-xs text-stone-500">限制每个账号同时处理的图片请求数量，默认 3。</p>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
            <Checkbox
              checked={Boolean(config?.auto_remove_invalid_accounts)}
              onCheckedChange={(checked) => setAutoRemoveInvalidAccounts(Boolean(checked))}
            />
            自动移除异常账号
          </label>
          <label className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
            <Checkbox
              checked={Boolean(config?.auto_remove_rate_limited_accounts)}
              onCheckedChange={(checked) => setAutoRemoveRateLimitedAccounts(Boolean(checked))}
            />
            自动移除限流账号
          </label>
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white px-4 py-3 md:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <ShieldCheck className="size-4" />
                </div>
                <div>
                  <label className="text-sm font-medium text-stone-800">图片健康号池巡检</label>
                  <p className="mt-1 text-xs leading-6 text-stone-500">
                    后台定时检查可生图账号数量，低于阈值时自动启动注册补池，并受账号总上限约束。
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex h-9 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-stone-700">
                  <Checkbox
                    checked={Boolean(config?.auto_register?.enabled)}
                    onCheckedChange={(checked) => setAutoRegisterField("enabled", Boolean(checked))}
                  />
                  启用
                </label>
                <Button
                  type="button"
                  className="h-9 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
                  onClick={() => void saveAutoRegister()}
                  disabled={isSavingAutoRegister}
                >
                  {isSavingAutoRegister ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
                  保存巡检
                </Button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-5">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">最低健康账号</label>
                <Input
                  value={String(config?.auto_register?.min_available || "")}
                  onChange={(event) => setAutoRegisterField("min_available", event.target.value)}
                  placeholder="50"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">低于该数量就补池。</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">目标健康账号</label>
                <Input
                  value={String(config?.auto_register?.target_available || "")}
                  onChange={(event) => setAutoRegisterField("target_available", event.target.value)}
                  placeholder="50"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">补池时尽量补到该健康数量。</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">账号总上限</label>
                <Input
                  value={String(config?.account_pool?.max_total_accounts || "")}
                  onChange={(event) => setAccountPoolField("max_total_accounts", event.target.value)}
                  placeholder="50"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">达到该总数后不再自动注册。</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">检查间隔</label>
                <Input
                  value={String(config?.auto_register?.check_interval_seconds || "")}
                  onChange={(event) => setAutoRegisterField("check_interval_seconds", event.target.value)}
                  placeholder="30"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">单位秒，最小 5 秒。</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">触发冷却</label>
                <Input
                  value={String(config?.auto_register?.cooldown_seconds || "")}
                  onChange={(event) => setAutoRegisterField("cooldown_seconds", event.target.value)}
                  placeholder="300"
                  className="h-10 rounded-xl border-stone-200 bg-white"
                />
                <p className="text-xs text-stone-500">单位秒，避免重复启动。</p>
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
            <div>
              <label className="text-sm text-stone-700">控制台日志级别</label>
              <p className="mt-1 text-xs text-stone-500">不选择时使用默认 info / warning / error。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {logLevelOptions.map((level) => (
                <label key={level} className="flex items-center gap-2 text-sm capitalize text-stone-700">
                  <Checkbox
                    checked={Boolean(config?.log_levels?.includes(level))}
                    onCheckedChange={(checked) => setLogLevel(level, Boolean(checked))}
                  />
                  {level}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">全局附加指令</label>
            <Textarea
              value={String(config?.global_system_prompt || "")}
              onChange={(event) => setGlobalSystemPrompt(event.target.value)}
              placeholder="例如：先判断用户提示词是否合规；遇到违法、色情、暴力、仇恨等请求时拒绝回答。"
              className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
            />
            <p className="text-xs text-stone-500">每次请求都会作为 system 消息注入，可用于审核用户提示词、避免违规内容、统一约束模型行为或固定角色设定。</p>
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm text-stone-700">敏感词</label>
            <Textarea
              value={(config?.sensitive_words || []).join("\n")}
              onChange={(event) => setSensitiveWordsText(event.target.value)}
              placeholder="一行一个，命中即拒绝"
              className="min-h-28 rounded-xl border-stone-200 bg-white font-mono text-xs shadow-none"
            />
            <p className="text-xs text-stone-500">只要用户请求包含任意敏感词，就直接返回拒绝。</p>
          </div>
          <div className="space-y-4 rounded-xl border border-stone-200 bg-white px-4 py-3 md:col-span-2">
            <label className="flex items-center gap-3 text-sm text-stone-700">
              <Checkbox
                checked={Boolean(config?.ai_review?.enabled)}
                onCheckedChange={(checked) => setAIReviewField("enabled", Boolean(checked))}
              />
              启用 AI 审核
            </label>
            <p className="text-xs leading-6 text-stone-500">
              开启后会在请求进入生图账号前先调用审核模型，审核不通过会直接拒绝，减少违规提示词触达账号造成风控或封号的风险。
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Base URL</label>
                <Input value={String(config?.ai_review?.base_url || "")} onChange={(event) => setAIReviewField("base_url", event.target.value)} placeholder="https://api.openai.com" className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">API Key</label>
                <Input value={String(config?.ai_review?.api_key || "")} onChange={(event) => setAIReviewField("api_key", event.target.value)} placeholder="sk-..." className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm text-stone-700">Model</label>
                <Input value={String(config?.ai_review?.model || "")} onChange={(event) => setAIReviewField("model", event.target.value)} placeholder="gpt-5.4-mini" className="h-10 rounded-xl border-stone-200 bg-white" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-stone-700">审核提示词</label>
              <Textarea value={String(config?.ai_review?.prompt || "")} onChange={(event) => setAIReviewField("prompt", event.target.value)} placeholder="判断用户请求是否允许。只回答 ALLOW 或 REJECT。" className="min-h-24 rounded-xl border-stone-200 bg-white text-xs shadow-none" />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800"
            onClick={() => void saveConfig()}
            disabled={isSavingConfig}
          >
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
