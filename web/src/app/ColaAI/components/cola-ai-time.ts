export function timestampFromIso(value?: string) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  const plainDateTimeMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  const timestamp = new Date(plainDateTimeMatch ? `${plainDateTimeMatch[1]}T${plainDateTimeMatch[2]}Z` : normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
