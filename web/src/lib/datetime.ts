const PLAIN_BACKEND_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

export function parseBackendDateTime(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const plainDateTimeMatch = normalized.match(PLAIN_BACKEND_DATETIME_PATTERN);
  const date = new Date(plainDateTimeMatch ? `${plainDateTimeMatch[1]}T${plainDateTimeMatch[2]}Z` : normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function backendDateTimeMs(value?: string | null): number | undefined {
  const date = parseBackendDateTime(value);
  return date ? date.getTime() : undefined;
}

export function formatDateTime(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  },
  locale = "zh-CN",
) {
  const date = parseBackendDateTime(value);
  if (!date) {
    return value || "—";
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Shanghai",
    hour12: false,
    ...options,
  }).format(date);
}
