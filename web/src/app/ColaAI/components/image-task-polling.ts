import type { ImageTask } from "@/lib/api";

const terminalTaskStatuses = new Set<ImageTask["status"]>(["success", "error", "cancelled"]);

type PollingDelayInput = {
  activeTaskIds: string[];
  tasks: Pick<ImageTask, "id" | "status" | "created_at" | "updated_at" | "started_at">[];
  nowMs?: number;
};

function timestampMs(value: string | undefined) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getImageTaskPollingDelayMs({
  activeTaskIds,
  tasks,
  nowMs = Date.now(),
}: PollingDelayInput) {
  const activeIds = new Set(activeTaskIds);
  const activeTasks = tasks.filter((task) => activeIds.has(task.id) && !terminalTaskStatuses.has(task.status));
  const taskCount = activeTasks.length || (tasks.length === 0 ? activeTaskIds.length : 0);
  if (taskCount <= 0) {
    return 0;
  }

  const youngestAgeMs = activeTasks.reduce((youngest, task) => {
    const timestamp = timestampMs(task.started_at) || timestampMs(task.updated_at) || timestampMs(task.created_at);
    if (timestamp <= 0) {
      return youngest;
    }
    return Math.min(youngest, Math.max(0, nowMs - timestamp));
  }, Number.POSITIVE_INFINITY);

  const ageMs = Number.isFinite(youngestAgeMs) ? youngestAgeMs : 0;
  const baseDelay = ageMs < 120_000 ? 1800 : ageMs < 600_000 ? 3200 : 6000;
  const countDelay = Math.max(0, taskCount - 1) * 200;
  return Math.min(9000, baseDelay + countDelay);
}

export function isTerminalImageTaskStatus(status: ImageTask["status"]) {
  return terminalTaskStatuses.has(status);
}
