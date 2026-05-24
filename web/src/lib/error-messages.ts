type ErrorMessageContext = {
  status?: number;
  code?: string;
  type?: string;
};

const messageRules: Array<{ includes: string[]; message: string }> = [
  {
    includes: ["密钥或用户名称无效"],
    message: "用户密钥或访问码无效，请重新输入。",
  },
  {
    includes: ["invalid api key"],
    message: "用户密钥或访问码无效，请重新输入。",
  },
  {
    includes: ["unauthorized"],
    message: "登录已失效，请重新输入用户密钥或访问码。",
  },
  {
    includes: ["request daily limit exceeded"],
    message: "今日请求次数已用完，请明天再试或联系管理员调整访问码限制。",
  },
  {
    includes: ["image daily limit exceeded"],
    message: "今日图片额度已用完，请明天再试或联系管理员调整访问码限制。",
  },
  {
    includes: ["concurrency limit exceeded"],
    message: "当前并发任务已达上限，请等前面的任务完成后再试。",
  },
  {
    includes: ["model not allowed"],
    message: "当前访问码不能使用这个模型，请切换模型或联系管理员开放权限。",
  },
  {
    includes: ["no available image quota"],
    message: "当前没有可用图片额度，请稍后重试或联系管理员补充号池额度。",
  },
  {
    includes: ["registered account image concurrency exceeded"],
    message: "图片账号并发已满，请稍后再试。",
  },
  {
    includes: ["rate limit"],
    message: "请求过于频繁，请稍后再试。",
  },
  {
    includes: ["timeout"],
    message: "请求超时，请稍后重试。",
  },
  {
    includes: ["network error"],
    message: "网络连接失败，请检查服务是否可用。",
  },
];

function messageFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const item = value as { error?: unknown; message?: unknown; detail?: unknown };
  if (typeof item.message === "string") {
    return item.message;
  }
  return messageFromUnknown(item.error) || messageFromUnknown(item.detail);
}

export function getFriendlyErrorMessage(value: unknown, fallback = "请求失败", context: ErrorMessageContext = {}) {
  const rawMessage = messageFromUnknown(value).trim();
  const lowerMessage = rawMessage.toLowerCase();
  const lowerCode = String(context.code || "").toLowerCase();
  const lowerType = String(context.type || "").toLowerCase();
  const combined = [lowerMessage, lowerCode, lowerType].filter(Boolean).join(" ");

  for (const rule of messageRules) {
    if (rule.includes.some((needle) => combined.includes(needle))) {
      return rule.message;
    }
  }

  if (context.status === 401) {
    return "登录已失效，请重新输入用户密钥或访问码。";
  }
  if (context.status === 403) {
    return "当前访问码没有执行这个操作的权限。";
  }
  if (context.status === 429) {
    return "当前请求已达到限制，请稍后再试。";
  }
  if (context.status && context.status >= 500) {
    return "服务暂时不可用，请稍后重试。";
  }

  return rawMessage || fallback;
}

export function getFailureNextStep(value: unknown) {
  const message = getFriendlyErrorMessage(value, "生成失败");

  if (message.includes("图片额度") || message.includes("号池额度")) {
    return "下一步：稍后重试，或联系管理员补充图片额度。";
  }
  if (message.includes("今日")) {
    return "下一步：等待今日限制刷新，或联系管理员调整访问码限制。";
  }
  if (message.includes("并发")) {
    return "下一步：等待前面的任务完成后重试。";
  }
  if (message.includes("模型")) {
    return "下一步：切换可用模型，或联系管理员开放当前模型。";
  }
  if (message.includes("登录") || message.includes("访问码")) {
    return "下一步：重新登录后再发送任务。";
  }

  return "下一步：检查提示词和参考图后重试；如果持续失败，请联系管理员查看日志。";
}
