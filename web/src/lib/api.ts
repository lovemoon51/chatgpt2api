import webConfig from "@/constants/common-env";
import { getStoredAuthKey } from "@/store/auth";
import { httpRequest, request } from "@/lib/request";

export type AccountType = string;
export type AccountStatus = "正常" | "限流" | "异常" | "禁用";
export type ImageModel = "gpt-image-2" | "codex-gpt-image-2";
export type AuthRole = "admin" | "user";

export type OpenAIModel = {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  root?: string;
  parent?: string | null;
  [key: string]: unknown;
};

export type Account = {
  access_token: string;
  type: AccountType;
  status: AccountStatus;
  quota: number;
  image_quota_unknown?: boolean;
  email?: string | null;
  user_id?: string | null;
  limits_progress?: Array<{
    feature_name?: string;
    remaining?: number;
    reset_after?: string;
  }>;
  default_model_slug?: string | null;
  restore_at?: string | null;
  image_blocked_reason?: string | null;
  can_activate_plus?: boolean;
  plus_promo_text?: string | null;
  tags?: string[];
  success: number;
  fail: number;
  last_used_at?: string | null;
};

type AccountListResponse = {
  items: Account[];
};

type AccountMutationResponse = {
  items: Account[];
  added?: number;
  skipped?: number;
  removed?: number;
  refreshed?: number;
  removed_failed?: number;
  errors?: Array<{ access_token: string; error: string }>;
};

type AccountRefreshResponse = {
  items: Account[];
  refreshed: number;
  removed_failed?: number;
  errors: Array<{ access_token: string; error: string }>;
};

type AccountRefreshOptions = {
  scope?: "all" | "selected";
};

type AccountUpdateResponse = {
  item: Account;
  items: Account[];
};

export type SettingsConfig = {
  proxy: string;
  base_url?: string;
  global_system_prompt?: string;
  sensitive_words?: string[];
  ai_review?: {
    enabled?: boolean;
    base_url?: string;
    api_key?: string;
    model?: string;
    prompt?: string;
  };
  refresh_account_interval_minute?: number | string;
  image_retention_days?: number | string;
  image_poll_timeout_secs?: number | string;
  image_account_concurrency?: number | string;
  auto_remove_invalid_accounts?: boolean;
  auto_remove_rate_limited_accounts?: boolean;
  log_levels?: string[];
  backup?: BackupSettings;
  backup_state?: BackupState;
  auto_register?: AutoRegisterSettings;
  account_pool?: AccountPoolSettings;
  auth?: AuthSettings;
  [key: string]: unknown;
};

export type SettingsDiagnosticItem = {
  key: string;
  label: string;
  source: "env" | "config.json" | "default" | "missing" | string;
  sensitive: boolean;
  configured: boolean;
  status: string;
  env?: string;
  value?: string;
};

export type SettingsDiagnostics = {
  config_file?: string;
  items: SettingsDiagnosticItem[];
};

export type AutoRegisterSettings = {
  enabled: boolean;
  min_available: number | string;
  target_available: number | string;
  check_interval_seconds: number | string;
  cooldown_seconds: number | string;
};

export type AccountPoolSettings = {
  max_total_accounts: number | string;
};

export type AuthSettings = {
  username_login_enabled: boolean;
};

export type BackupInclude = {
  config: boolean;
  register: boolean;
  cpa: boolean;
  sub2api: boolean;
  logs: boolean;
  image_tasks: boolean;
  accounts_snapshot: boolean;
  auth_keys_snapshot: boolean;
  images: boolean;
};

export type BackupSettings = {
  enabled: boolean;
  provider: "cloudflare_r2" | string;
  account_id: string;
  access_key_id: string;
  secret_access_key: string;
  bucket: string;
  prefix: string;
  interval_minutes: number | string;
  rotation_keep: number | string;
  encrypt: boolean;
  passphrase: string;
  include: BackupInclude;
};

export type BackupState = {
  running: boolean;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_status?: string;
  last_error?: string | null;
  last_object_key?: string | null;
};

export type BackupItem = {
  key: string;
  name: string;
  size: number;
  updated_at?: string | null;
  encrypted: boolean;
};

export type BackupDetail = {
  key: string;
  name: string;
  encrypted: boolean;
  created_at?: string | null;
  trigger?: string | null;
  app_version?: string | null;
  storage_backend?: Record<string, unknown> | null;
  files: Array<{
    name: string;
    exists: boolean;
    content_type?: string;
    size: number;
    sha256?: string;
  }>;
  snapshots: Array<{
    name: string;
    count: number;
  }>;
};

export type BackupVerificationIssue = {
  level: "error" | "warning" | string;
  code: string;
  message: string;
  path?: string;
};

export type BackupVerificationReport = {
  key: string;
  name: string;
  encrypted: boolean;
  ok: boolean;
  readable: boolean;
  restorable: boolean;
  summary: {
    errors: number;
    warnings: number;
    files: number;
    snapshots: number;
    size: number;
  };
  errors: BackupVerificationIssue[];
  warnings: BackupVerificationIssue[];
  metadata: {
    version?: number | null;
    created_at?: string | null;
    trigger?: string | null;
    app_version?: string | null;
    storage_backend?: Record<string, unknown> | null;
  };
  files: Array<{
    name: string;
    size: number;
    content_type?: string;
    sha256?: string;
    valid: boolean;
    records?: number;
  }>;
  snapshots: Array<{
    name: string;
    count: number;
    valid: boolean;
  }>;
};

export type ManagedImage = {
  rel: string;
  path?: string;
  name: string;
  date: string;
  size: number;
  url: string;
  thumbnail_url?: string;
  created_at: string;
  width?: number;
  height?: number;
  tags?: string[];
};

export type ManagedImageListFilters = {
  start_date?: string;
  end_date?: string;
  q?: string;
  search?: string;
  tags?: string[];
  tag?: string;
  sort?: string;
  order?: "asc" | "desc" | string;
  page?: number;
  page_size?: number;
};

export type ManagedImageListResponse = {
  items: ManagedImage[];
  groups: Array<{ date: string; items: ManagedImage[] }>;
  total?: number;
  page?: number;
  page_size?: number;
  pages?: number;
};

export type SystemLog = {
  id: string;
  time: string;
  type: "call" | "account" | string;
  summary?: string;
  detail?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ImageResponse = {
  created: number;
  data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
};

export type ImageTask = {
  id: string;
  status: "queued" | "submitting" | "running" | "downloading" | "saving" | "success" | "error" | "cancelled";
  phase?: "queued" | "submitting" | "generating" | "downloading" | "saving" | "completed" | "error" | string;
  phase_label?: string;
  phase_updated_at?: string;
  timings?: Record<string, number | undefined>;
  timing_ms?: Record<string, number | undefined>;
  mode: "generate" | "edit";
  model?: ImageModel;
  size?: string;
  created_at: string;
  updated_at: string;
  queued_at?: string;
  submitted_at?: string;
  started_at?: string;
  downloading_at?: string;
  saving_at?: string;
  finished_at?: string;
  duration_ms?: number;
  queue_duration_ms?: number;
  total_duration_ms?: number;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: string;
};

type ImageTaskListResponse = {
  items: ImageTask[];
  missing_ids: string[];
};

export type ImageTaskTimingPayload = {
  timing_key: string;
  duration_ms: number;
  phase?: string;
};

export type LoginResponse = {
  ok: boolean;
  version: string;
  role: AuthRole;
  subject_id: string;
  name: string;
  access_token?: string;
  limits?: UserKeyLimits | null;
};

export type UserKey = {
  id: string;
  name: string;
  role: "user";
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
  limits?: UserKeyLimits | null;
};

export type UserKeyLimits = {
  requests_per_day?: number | null;
  images_per_day?: number | null;
  concurrency?: number | null;
  models?: string[];
};

export type DashboardMetricGroup = {
  total?: number;
  active?: number;
  normal?: number;
  available?: number;
  image_available?: number;
  limited?: number;
  disabled?: number;
  unavailable?: number;
  success?: number;
  failed?: number;
  fail?: number;
  error?: number;
  avg_duration_ms?: number;
  avg_latency_ms?: number;
  average_duration_ms?: number;
  last_at?: string | null;
  status_counts?: Record<string, number>;
  image_quota?: {
    total?: number | null;
    unknown?: boolean;
  };
  [key: string]: unknown;
};

export type DashboardResponse = {
  accounts?: DashboardMetricGroup;
  calls?: DashboardMetricGroup & {
    today?: DashboardMetricGroup;
    recent?: DashboardMetricGroup;
    image?: DashboardMetricGroup;
    queue?: DashboardMetricGroup;
    failure_reasons?: Array<{
      reason?: string;
      endpoint?: string;
      count?: number;
      last_at?: string | null;
    }>;
  };
  backup?: DashboardMetricGroup & {
    enabled?: boolean;
    running?: boolean;
    last_status?: string;
    last_error?: string | null;
    last_started_at?: string | null;
    last_finished_at?: string | null;
    last_object_key?: string | null;
  };
  storage?: DashboardMetricGroup & {
    ok?: boolean;
    backend?: Record<string, unknown>;
    health?: Record<string, unknown>;
    used_bytes?: number;
    total_bytes?: number;
    free_bytes?: number;
    images_bytes?: number;
    backups_bytes?: number;
    logs_bytes?: number;
    provider?: string;
    bucket?: string;
    status?: string;
  };
  auto_register?: AutoRegisterSettings & {
    max_total_accounts?: number | string;
    current_available?: number;
    current_accounts?: number;
    running?: number;
    in_flight?: number;
    pending?: number;
    failed?: number;
    fail?: number;
    total?: number;
    failure_rate?: number;
    last_error?: string | null;
    last_checked_at?: string | null;
  };
  queue?: DashboardMetricGroup;
  image_tasks?: DashboardMetricGroup & {
    queued?: number;
    checking_capacity?: number;
    checking_out_account?: number;
    submitting?: number;
    polling?: number;
    running?: number;
    downloading?: number;
    saving?: number;
    phase_counts?: Record<string, number>;
    pending?: number;
    success?: number;
    failed?: number;
    avg_wait_ms?: number;
    avg_duration_ms?: number;
    p90_duration_ms?: number;
    p99_duration_ms?: number;
    duration_p90_ms?: number;
    duration_p99_ms?: number;
    p90_wait_ms?: number;
    p99_wait_ms?: number;
  };
  health?: {
    level?: "normal" | "warning" | "critical" | string;
    reasons?: string[];
    refreshed_at?: string;
    threads?: Record<string, unknown>;
    background_threads?: Record<string, unknown>;
    workers?: Record<string, unknown>;
  };
  threads?: Record<string, unknown>;
  background_threads?: Record<string, unknown>;
  workers?: {
    ok?: boolean;
    status?: "ok" | "degraded" | "unhealthy" | string;
    items?: Array<{
      name?: string;
      running?: boolean;
      started_at?: string | null;
      last_heartbeat?: string | null;
      last_error?: string | null;
      [key: string]: unknown;
    }>;
    missing?: string[];
    stopped?: string[];
    errors?: Array<{ name?: string; error?: string | null }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type RegisterConfig = {
  enabled: boolean;
  mail: {
    request_timeout: number;
    wait_timeout: number;
    wait_interval: number;
    providers: Array<Record<string, unknown>>;
  };
  proxy: string;
  clash: {
    enabled: boolean;
    controller_url: string;
    secret: string;
    group: string;
    selected_proxy?: string;
    proxy: string;
    keywords: string[];
    timeout: number;
  };
  total: number;
  threads: number;
  mode: "total" | "quota" | "available";
  target_quota: number;
  target_available: number;
  check_interval: number;
  stats: {
    job_id?: string;
    success: number;
    fail: number;
    done: number;
    running: number;
    threads: number;
    elapsed_seconds?: number;
    avg_seconds?: number;
    success_rate?: number;
    current_quota?: number;
    current_available?: number;
    current_accounts?: number;
    target_available?: number;
    in_flight?: number;
    pending?: number;
    failure_rate?: number;
    last_error?: string | null;
    started_at?: string;
    updated_at?: string;
    finished_at?: string;
  };
  logs?: Array<{
    time: string;
    text: string;
    level: string;
  }>;
};

export type ClashNode = {
  name: string;
  type?: string;
  now?: string;
  alive?: boolean;
  delay?: number;
};

export type ClashGroup = {
  name: string;
  type?: string;
  now?: string;
  all: string[];
  nodes: ClashNode[];
};

export type RegisterClashOptions = {
  controller_url: string;
  proxy_url: string;
  group: string;
  proxy: string;
  active_proxy: string;
  groups: ClashGroup[];
  latency_ms: number;
  config_path?: string;
};

export type RegisterClashSelection = {
  controller_url: string;
  group: string;
  proxy: string;
  active_proxy: string;
  proxy_url: string;
  latency_ms: number;
  config_path?: string;
};

export type OpenAIKeyStatus = "unchecked" | "ok" | "invalid" | "rate_limited" | "forbidden" | "error" | string;

export type OpenAIKeyItem = {
  id: string;
  name: string;
  key_hint: string;
  status: OpenAIKeyStatus;
  http_status?: number | null;
  models_count: number;
  sample_models: string[];
  last_error?: string | null;
  last_checked_at?: string | null;
  created_at: string;
  updated_at: string;
};

type OpenAIKeyListResponse = {
  items: OpenAIKeyItem[];
};

type OpenAIKeyMutationResponse = {
  item?: OpenAIKeyItem;
  items: OpenAIKeyItem[];
};

type ModelListResponse = {
  object: string;
  data: OpenAIModel[];
};

export async function login(loginValue: string) {
  const normalizedLoginValue = String(loginValue || "").trim();
  return httpRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { login: normalizedLoginValue },
    redirectOnUnauthorized: false,
  });
}

export async function fetchModels() {
  return httpRequest<ModelListResponse>("/v1/models");
}

export async function fetchAccounts() {
  return httpRequest<AccountListResponse>("/api/accounts");
}

export async function createAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "POST",
    body: { tokens },
  });
}

export async function deleteAccounts(tokens: string[]) {
  return httpRequest<AccountMutationResponse>("/api/accounts", {
    method: "DELETE",
    body: { tokens },
  });
}

export async function refreshAccounts(accessTokens: string[], options: AccountRefreshOptions = {}) {
  return httpRequest<AccountRefreshResponse>("/api/accounts/refresh", {
    method: "POST",
    body: { access_tokens: accessTokens, ...(options.scope ? { scope: options.scope } : {}) },
  });
}

export type AccountRefreshStreamEvent =
  | {
      type: "start";
      requested: number;
      batches: number;
      batch_size: number;
      workers: number;
      interval_seconds: number;
    }
  | {
      type: "account";
      token: string;
      outcome: "succeeded" | "failed" | "invalid";
      completed: number;
      requested: number;
      index: number;
      total_batches: number;
      error?: string;
    }
  | {
      type: "batch";
      index: number;
      total_batches: number;
      requested: number;
      completed: number;
      refreshed: number;
      removed_failed: number;
      removed_rate_limited: number;
      removed_tokens: string[];
      errors: Array<{ token?: string; error: string }>;
      items: Account[];
    }
  | {
      type: "done";
      refreshed: number;
      removed_failed: number;
      removed_rate_limited: number;
      errors: Array<{ token?: string; error: string }>;
      items: Account[];
      requested: number;
      completed: number;
      duration_ms: number;
    }
  | {
      type: "error";
      error: string;
    };

export type AccountRefreshStreamOptions = AccountRefreshOptions & {
  signal?: AbortSignal;
  onEvent?: (event: AccountRefreshStreamEvent) => void;
};

export async function refreshAccountsStream(
  accessTokens: string[],
  options: AccountRefreshStreamOptions = {},
) {
  const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
  const authKey = await getStoredAuthKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/x-ndjson",
  };
  if (authKey) {
    headers.Authorization = `Bearer ${authKey}`;
  }

  const response = await fetch(`${baseUrl}/api/accounts/refresh`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      access_tokens: accessTokens,
      ...(options.scope ? { scope: options.scope } : {}),
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `刷新账号失败 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  type DoneEvent = Extract<AccountRefreshStreamEvent, { type: "done" }>;
  let lastDone: DoneEvent | null = null as DoneEvent | null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let event: AccountRefreshStreamEvent;
    try {
      event = JSON.parse(trimmed) as AccountRefreshStreamEvent;
    } catch {
      return;
    }
    if (event.type === "done") {
      lastDone = event;
    }
    if (event.type === "error") {
      throw new Error(event.error || "刷新账号失败");
    }
    options.onEvent?.(event);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          handleLine(line);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      if (done) {
        break;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  if (buffer.trim()) {
    handleLine(buffer);
  }

  return lastDone;
}

export async function updateAccount(
  accessToken: string,
  updates: {
    type?: AccountType;
    status?: AccountStatus;
    quota?: number;
  },
) {
  return httpRequest<AccountUpdateResponse>("/api/accounts/update", {
    method: "POST",
    body: {
      access_token: accessToken,
      ...updates,
    },
  });
}

export async function downloadCpaAccounts(accessTokens: string[] = []) {
  const response = await request.post("/api/accounts/export/cpa", { access_tokens: accessTokens }, { responseType: "blob" });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cpa-accounts-${Date.now()}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function generateImage(prompt: string, model?: ImageModel, size?: string) {
  return httpRequest<ImageResponse>(
    "/v1/images/generations",
    {
      method: "POST",
      body: {
        prompt,
        ...(model ? { model } : {}),
        ...(size ? { size } : {}),
        n: 1,
        response_format: "b64_json",
      },
    },
  );
}

export async function editImage(files: File | File[], prompt: string, model?: ImageModel, size?: string) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }
  formData.append("n", "1");

  return httpRequest<ImageResponse>(
    "/v1/images/edits",
    {
      method: "POST",
      body: formData,
    },
  );
}

export async function createImageGenerationTask(clientTaskId: string, prompt: string, model?: ImageModel, size?: string) {
  return httpRequest<ImageTask>("/api/image-tasks/generations", {
    method: "POST",
    body: {
      client_task_id: clientTaskId,
      prompt,
      ...(model ? { model } : {}),
      ...(size ? { size } : {}),
    },
  });
}

export async function createImageEditTask(
  clientTaskId: string,
  files: File | File[],
  prompt: string,
  model?: ImageModel,
  size?: string,
) {
  const formData = new FormData();
  const uploadFiles = Array.isArray(files) ? files : [files];

  uploadFiles.forEach((file) => {
    formData.append("image", file);
  });
  formData.append("client_task_id", clientTaskId);
  formData.append("prompt", prompt);
  if (model) {
    formData.append("model", model);
  }
  if (size) {
    formData.append("size", size);
  }

  return httpRequest<ImageTask>("/api/image-tasks/edits", {
    method: "POST",
    body: formData,
  });
}

export async function fetchImageTasks(ids: string[]) {
  const params = new URLSearchParams();
  if (ids.length > 0) {
    params.set("ids", ids.join(","));
  }
  return httpRequest<ImageTaskListResponse>(`/api/image-tasks${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function cancelImageTask(id: string) {
  return httpRequest<ImageTask>(`/api/image-tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function reportImageTaskTiming(taskId: string, payload: ImageTaskTimingPayload) {
  return httpRequest<ImageTask>(
    `/api/image-tasks/${encodeURIComponent(taskId)}/timings`,
    {
      method: "POST",
      body: payload,
    },
  );
}

export async function fetchSettingsConfig() {
  return httpRequest<{ config: SettingsConfig; diagnostics?: SettingsDiagnostics }>("/api/settings");
}

export async function updateSettingsConfig(settings: Partial<SettingsConfig>) {
  return httpRequest<{ config: SettingsConfig; diagnostics?: SettingsDiagnostics }>("/api/settings", {
    method: "POST",
    body: settings,
  });
}

export async function testBackupConnection() {
  return httpRequest<{ result: { ok: boolean; status: number } }>("/api/backup/test", {
    method: "POST",
    body: {},
  });
}

export async function fetchBackups() {
  return httpRequest<{ items: BackupItem[]; state: BackupState; settings: BackupSettings }>("/api/backups");
}

export async function runBackupNow() {
  return httpRequest<{ result: { key: string; size: number; encrypted: boolean } }>("/api/backups/run", {
    method: "POST",
    body: {},
  });
}

export async function deleteBackup(key: string) {
  return httpRequest<{ ok: boolean }>("/api/backups/delete", {
    method: "POST",
    body: { key },
  });
}

export async function fetchBackupDetail(key: string) {
  const params = new URLSearchParams();
  params.set("key", key);
  return httpRequest<{ item: BackupDetail }>(`/api/backups/detail?${params.toString()}`);
}

export async function verifyBackup(key: string) {
  return httpRequest<{ report: BackupVerificationReport }>("/api/backups/verify", {
    method: "POST",
    body: { key },
  });
}

export function getBackupDownloadUrl(key: string) {
  const params = new URLSearchParams();
  params.set("key", key);
  return `/api/backups/download?${params.toString()}`;
}

export async function fetchManagedImages(filters: ManagedImageListFilters) {
  const params = new URLSearchParams();
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);
  if (filters.search || filters.q) params.set("search", filters.search || filters.q || "");
  if (filters.tag || filters.tags?.length) params.set("tag", filters.tag || filters.tags?.join(",") || "");
  if (filters.sort) params.set("sort", filters.sort);
  if (filters.order) params.set("order", filters.order);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.page_size) params.set("page_size", String(filters.page_size));
  return httpRequest<ManagedImageListResponse>(
    `/api/images${params.toString() ? `?${params.toString()}` : ""}`,
  );
}

export async function deleteManagedImages(body: { paths?: string[]; start_date?: string; end_date?: string; all_matching?: boolean }) {
  return httpRequest<{ removed: number }>("/api/images/delete", { method: "POST", body });
}

export async function downloadImages(paths: string[]) {
  const response = await request.post("/api/images/download", { paths }, { responseType: "blob" });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "images.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadSingleImage(path: string) {
  const response = await request.get(`/api/images/download/${path}`, { responseType: "blob" });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "image.png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function fetchImageTags() {
  return httpRequest<{ tags: string[] }>("/api/images/tags");
}

export async function setImageTags(path: string, tags: string[]) {
  return httpRequest<{ ok: boolean; tags: string[] }>("/api/images/tags", {
    method: "POST",
    body: { path, tags },
  });
}

export async function deleteImageTag(tag: string) {
  return httpRequest<{ ok: boolean; removed_from: number }>(`/api/images/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
}

export async function fetchSystemLogs(filters: { type?: string; start_date?: string; end_date?: string }) {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);
  return httpRequest<{ items: SystemLog[] }>(`/api/logs${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function deleteSystemLogs(ids: string[]) {
  return httpRequest<{ removed: number }>("/api/logs/delete", {
    method: "POST",
    body: { ids },
  });
}

export async function fetchUserKeys() {
  return httpRequest<{ items: UserKey[] }>("/api/auth/users");
}

export async function createUserKey(name: string, limits?: UserKeyLimits) {
  return httpRequest<{ item: UserKey; key: string; items: UserKey[] }>("/api/auth/users", {
    method: "POST",
    body: { name, ...(limits ? { limits } : {}) },
  });
}

export async function updateUserKey(
  keyId: string,
  updates: { enabled?: boolean; name?: string; key?: string; limits?: UserKeyLimits },
) {
  return httpRequest<{ item: UserKey; items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "POST",
    body: updates,
  });
}

export async function deleteUserKey(keyId: string) {
  return httpRequest<{ items: UserKey[] }>(`/api/auth/users/${keyId}`, {
    method: "DELETE",
  });
}

export async function fetchDashboard() {
  return httpRequest<DashboardResponse>("/api/dashboard");
}

export async function fetchRegisterConfig() {
  return httpRequest<{ register: RegisterConfig }>("/api/register");
}

export async function updateRegisterConfig(updates: Partial<RegisterConfig>) {
  return httpRequest<{ register: RegisterConfig }>("/api/register", {
    method: "POST",
    body: updates,
  });
}

export async function fetchRegisterClashOptions(clash: RegisterConfig["clash"]) {
  return httpRequest<{ clash: RegisterClashOptions }>("/api/register/clash/options", {
    method: "POST",
    body: { clash },
  });
}

export async function selectRegisterClashProxy(clash: RegisterConfig["clash"], group: string, proxy: string) {
  return httpRequest<{ clash: RegisterClashSelection; register: RegisterConfig }>("/api/register/clash/select", {
    method: "POST",
    body: { clash, group, proxy },
  });
}

export async function startRegister() {
  return httpRequest<{ register: RegisterConfig }>("/api/register/start", { method: "POST" });
}

export async function stopRegister() {
  return httpRequest<{ register: RegisterConfig }>("/api/register/stop", { method: "POST" });
}

export async function resetRegister() {
  return httpRequest<{ register: RegisterConfig }>("/api/register/reset", { method: "POST" });
}

// ── Official OpenAI API Keys ──────────────────────────────────────

export async function fetchOpenAIKeys() {
  return httpRequest<OpenAIKeyListResponse>("/api/openai-keys");
}

export async function createOpenAIKey(name: string, key: string, check = true) {
  return httpRequest<Required<Pick<OpenAIKeyMutationResponse, "item">> & OpenAIKeyMutationResponse>("/api/openai-keys", {
    method: "POST",
    body: { name, key, check },
  });
}

export async function checkOpenAIKey(keyId: string) {
  return httpRequest<Required<Pick<OpenAIKeyMutationResponse, "item">> & OpenAIKeyMutationResponse>(
    `/api/openai-keys/${keyId}/check`,
    { method: "POST" },
  );
}

export async function deleteOpenAIKey(keyId: string) {
  return httpRequest<OpenAIKeyListResponse>(`/api/openai-keys/${keyId}`, {
    method: "DELETE",
  });
}

// ── CPA (CLIProxyAPI) ──────────────────────────────────────────────

export type CPAPool = {
  id: string;
  name: string;
  base_url: string;
  import_job?: CPAImportJob | null;
};

export type CPARemoteFile = {
  name: string;
  email: string;
};

export type CPAImportJob = {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  total: number;
  completed: number;
  added: number;
  skipped: number;
  refreshed: number;
  failed: number;
  errors: Array<{ name: string; error: string }>;
};

export async function fetchCPAPools() {
  return httpRequest<{ pools: CPAPool[] }>("/api/cpa/pools");
}

export async function createCPAPool(pool: { name: string; base_url: string; secret_key: string }) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>("/api/cpa/pools", {
    method: "POST",
    body: pool,
  });
}

export async function updateCPAPool(
  poolId: string,
  updates: { name?: string; base_url?: string; secret_key?: string },
) {
  return httpRequest<{ pool: CPAPool; pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "POST",
    body: updates,
  });
}

export async function deleteCPAPool(poolId: string) {
  return httpRequest<{ pools: CPAPool[] }>(`/api/cpa/pools/${poolId}`, {
    method: "DELETE",
  });
}

export async function fetchCPAPoolFiles(poolId: string) {
  return httpRequest<{ pool_id: string; files: CPARemoteFile[] }>(`/api/cpa/pools/${poolId}/files`);
}

export async function startCPAImport(poolId: string, names: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`, {
    method: "POST",
    body: { names },
  });
}

export async function fetchCPAPoolImportJob(poolId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/cpa/pools/${poolId}/import`);
}

// ── Sub2API ────────────────────────────────────────────────────────

export type Sub2APIServer = {
  id: string;
  name: string;
  base_url: string;
  email: string;
  has_api_key: boolean;
  group_id: string;
  import_job?: CPAImportJob | null;
};

export type Sub2APIRemoteAccount = {
  id: string;
  name: string;
  email: string;
  plan_type: string;
  status: string;
  expires_at: string;
  has_refresh_token: boolean;
};

export type Sub2APIRemoteGroup = {
  id: string;
  name: string;
  description: string;
  platform: string;
  status: string;
  account_count: number;
  active_account_count: number;
};

export async function fetchSub2APIServers() {
  return httpRequest<{ servers: Sub2APIServer[] }>("/api/sub2api/servers");
}

export async function createSub2APIServer(server: {
  name: string;
  base_url: string;
  email: string;
  password: string;
  api_key: string;
  group_id: string;
}) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>("/api/sub2api/servers", {
    method: "POST",
    body: server,
  });
}

export async function updateSub2APIServer(
  serverId: string,
  updates: {
    name?: string;
    base_url?: string;
    email?: string;
    password?: string;
    api_key?: string;
    group_id?: string;
  },
) {
  return httpRequest<{ server: Sub2APIServer; servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "POST",
    body: updates,
  });
}

export async function fetchSub2APIServerGroups(serverId: string) {
  return httpRequest<{ server_id: string; groups: Sub2APIRemoteGroup[] }>(
    `/api/sub2api/servers/${serverId}/groups`,
  );
}

export async function deleteSub2APIServer(serverId: string) {
  return httpRequest<{ servers: Sub2APIServer[] }>(`/api/sub2api/servers/${serverId}`, {
    method: "DELETE",
  });
}

export async function fetchSub2APIServerAccounts(serverId: string) {
  return httpRequest<{ server_id: string; accounts: Sub2APIRemoteAccount[] }>(
    `/api/sub2api/servers/${serverId}/accounts`,
  );
}

export async function startSub2APIImport(serverId: string, accountIds: string[]) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`, {
    method: "POST",
    body: { account_ids: accountIds },
  });
}

export async function fetchSub2APIImportJob(serverId: string) {
  return httpRequest<{ import_job: CPAImportJob | null }>(`/api/sub2api/servers/${serverId}/import`);
}

// ── Upstream proxy ────────────────────────────────────────────────

export type ProxySettings = {
  enabled: boolean;
  url: string;
};

export type ProxyTestResult = {
  ok: boolean;
  status: number;
  latency_ms: number;
  error: string | null;
};

export async function fetchProxy() {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy");
}

export async function updateProxy(updates: { enabled?: boolean; url?: string }) {
  return httpRequest<{ proxy: ProxySettings }>("/api/proxy", {
    method: "POST",
    body: updates,
  });
}

export async function testProxy(url?: string) {
  return httpRequest<{ result: ProxyTestResult }>("/api/proxy/test", {
    method: "POST",
    body: { url: url ?? "" },
  });
}
