"use client";

import { KeyRound, LoaderCircle, PlugZap, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { testAgnesAIConnection } from "@/lib/api";

import { useSettingsStore } from "../store";

function keyPreview(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    return "未填写";
  }
  if (normalized.length <= 10) {
    return "已填写";
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function AgnesAISettingsCard() {
  const [isTestingAgnes, setIsTestingAgnes] = useState(false);
  const config = useSettingsStore((state) => state.config);
  const isLoadingConfig = useSettingsStore((state) => state.isLoadingConfig);
  const isSavingConfig = useSettingsStore((state) => state.isSavingConfig);
  const saveConfig = useSettingsStore((state) => state.saveConfig);
  const setAgnesAIBaseUrl = useSettingsStore((state) => state.setAgnesAIBaseUrl);
  const addAgnesAIKey = useSettingsStore((state) => state.addAgnesAIKey);
  const updateAgnesAIKey = useSettingsStore((state) => state.updateAgnesAIKey);
  const deleteAgnesAIKey = useSettingsStore((state) => state.deleteAgnesAIKey);

  if (isLoadingConfig) {
    return (
      <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
        <CardContent className="flex items-center justify-center p-10">
          <LoaderCircle className="size-5 animate-spin text-stone-400" />
        </CardContent>
      </Card>
    );
  }

  const agnes = config?.agnes_ai;
  const apiKeys = agnes?.api_keys || [];
  const hasUsableKey = Boolean(agnes?.api_key?.trim()) || apiKeys.some((item) => Boolean(item.enabled ?? true) && Boolean(item.api_key?.trim()));

  const handleTestAgnes = async () => {
    if (!hasUsableKey) {
      toast.error("请先填写至少一个启用的 Agnes AI API Key");
      return;
    }
    setIsTestingAgnes(true);
    try {
      const data = await testAgnesAIConnection({
        base_url: String(agnes?.base_url || "https://apihub.agnes-ai.com/v1").trim(),
        api_key: String(agnes?.api_key || "").trim(),
        api_keys: apiKeys
          .map((item, index) => ({
            name: String(item.name || `Key ${index + 1}`).trim() || `Key ${index + 1}`,
            api_key: String(item.api_key || "").trim(),
            enabled: Boolean(item.enabled ?? true),
          }))
          .filter((item) => item.api_key),
      });
      if (data.result.ok) {
        const modelCount = data.result.models?.length ?? 0;
        if (data.result.image_model_available === false) {
          toast.warning(`Agnes AI key 可用，但未返回 agnes-image-2.1-flash（共 ${modelCount} 个模型）`);
        } else {
          toast.success(`Agnes AI 连接正常（${data.result.key_name || "已配置 key"}，${modelCount} 个模型）`);
        }
      } else {
        toast.error(`Agnes AI 测试失败：${data.result.error || `HTTP ${data.result.status}`}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "测试 Agnes AI 失败");
    } finally {
      setIsTestingAgnes(false);
    }
  };

  return (
    <Card className="rounded-2xl border-white/80 bg-white/90 shadow-sm">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
              <KeyRound className="size-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Agnes AI</h2>
              <p className="text-sm text-stone-500">配置 agnes-image-2.1-flash 的独立 API Key，多个 key 会在后端轮询访问。</p>
            </div>
          </div>
          <Badge variant={apiKeys.some((item) => item.enabled && item.api_key?.trim()) || agnes?.api_key?.trim() ? "success" : "outline"} className="rounded-md">
            {apiKeys.some((item) => item.enabled && item.api_key?.trim()) || agnes?.api_key?.trim() ? "已配置" : "未配置"}
          </Badge>
        </div>

        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-600">
          如果部署环境设置了 AGNES_AI_API_KEY，会优先使用环境变量；否则使用这里保存的 key 列表。测试按钮只查询 /models，不会发起图片生成。
        </div>

        <div className="space-y-2">
          <label className="text-sm text-stone-700">Base URL</label>
          <Input
            value={String(agnes?.base_url || "")}
            onChange={(event) => setAgnesAIBaseUrl(event.target.value)}
            placeholder="https://apihub.agnes-ai.com/v1"
            className="h-10 rounded-xl border-stone-200 bg-white"
          />
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-stone-800">API Key 列表</div>
              <div className="mt-1 text-xs text-stone-500">启用的 key 会按请求轮询使用。</div>
            </div>
            <Button type="button" variant="outline" className="h-9 rounded-xl border-stone-200 bg-white px-4 text-stone-700" onClick={addAgnesAIKey}>
              <Plus className="size-4" />
              添加 key
            </Button>
          </div>

          {apiKeys.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-200 bg-white px-4 py-5 text-sm text-stone-500">
              暂无后台 key。点击「添加 key」后填写并保存。
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((item, index) => (
                <div key={index} className="grid gap-3 rounded-xl border border-stone-200 bg-white p-3 md:grid-cols-[1fr_1.8fr_auto_auto] md:items-center">
                  <Input
                    value={String(item.name || "")}
                    onChange={(event) => updateAgnesAIKey(index, { name: event.target.value })}
                    placeholder={`Key ${index + 1}`}
                    className="h-10 rounded-xl border-stone-200 bg-white"
                  />
                  <div className="space-y-1">
                    <Input
                      value={String(item.api_key || "")}
                      onChange={(event) => updateAgnesAIKey(index, { api_key: event.target.value })}
                      placeholder="agnes key"
                      className="h-10 rounded-xl border-stone-200 bg-white font-mono text-xs"
                    />
                    <div className="text-xs text-stone-400">{keyPreview(String(item.api_key || ""))}</div>
                  </div>
                  <label className="flex h-10 items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm text-stone-700">
                    <Checkbox checked={Boolean(item.enabled)} onCheckedChange={(checked) => updateAgnesAIKey(index, { enabled: Boolean(checked) })} />
                    启用
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-rose-200 bg-white px-3 text-rose-600 hover:bg-rose-50"
                    onClick={() => deleteAgnesAIKey(index)}
                    aria-label={`删除 Agnes AI key ${index + 1}`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl border-stone-200 bg-white px-5 text-stone-700"
            onClick={() => void handleTestAgnes()}
            disabled={isTestingAgnes}
          >
            {isTestingAgnes ? <LoaderCircle className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            测活 Agnes
          </Button>
          <Button className="h-10 rounded-xl bg-stone-950 px-5 text-white hover:bg-stone-800" onClick={() => void saveConfig()} disabled={isSavingConfig}>
            {isSavingConfig ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存 Agnes 设置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
