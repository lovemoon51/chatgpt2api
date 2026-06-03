import type { CanvasNodeData, CanvasState, CanvasStorageLike } from "./canvas-types";
import {
  COLA_CANVAS_STORAGE_KEY,
  createInitialCanvasState,
  loadCanvasState,
  normalizeCanvasState,
  saveCanvasState,
} from "./use-canvas-store";

export type CanvasHomeSummary = {
  hasCanvas: boolean;
  title: string;
  updatedAt: string | null;
  nodeCount: number;
  hasGenerativeContent: boolean;
  previewTitles: string[];
  nodeTypeCounts: {
    text: number;
    image: number;
    config: number;
    generation: number;
  };
};

export type CanvasHomeEntry = CanvasHomeSummary & {
  id: string;
};

type CanvasLibraryRecord = {
  id: string;
  state: CanvasState;
  createdAt: string;
  updatedAt: string;
};

export type CanvasTemplateCard = {
  id: "brand-board" | "poster-concept" | "product-collage" | "storyboard";
  title: string;
  description: string;
  badge: string;
  accentClassName: string;
  highlights: string[];
};

export const COLA_CANVAS_LIBRARY_STORAGE_KEY = "chatgpt2api:cola_canvas_library";
export const COLA_ACTIVE_CANVAS_ID_STORAGE_KEY = "chatgpt2api:cola_active_canvas_id";
const LEGACY_CANVAS_RECORD_ID = "legacy-current-canvas";

const EMPTY_SUMMARY: CanvasHomeSummary = {
  hasCanvas: false,
  title: "还没有画布",
  updatedAt: null,
  nodeCount: 0,
  hasGenerativeContent: false,
  previewTitles: [],
  nodeTypeCounts: {
    text: 0,
    image: 0,
    config: 0,
    generation: 0,
  },
};

const TEMPLATE_CARDS: CanvasTemplateCard[] = [
  {
    id: "brand-board",
    title: "品牌情绪板",
    description: "从品牌关键词、材质参考和输出目标开始搭建风格系统。",
    badge: "Brand",
    accentClassName: "from-sky-100 via-cyan-50 to-emerald-100",
    highlights: ["品牌关键词", "材质参考", "输出目标"],
  },
  {
    id: "poster-concept",
    title: "海报概念板",
    description: "组织标题文案、主视觉参考和生图目标，快速进入创意海报探索。",
    badge: "Poster",
    accentClassName: "from-amber-100 via-rose-50 to-fuchsia-100",
    highlights: ["标题文案", "主视觉参考", "海报结果"],
  },
  {
    id: "product-collage",
    title: "产品视觉拼贴",
    description: "用产品图、材质描述和配置节点搭建商品视觉实验台。",
    badge: "Product",
    accentClassName: "from-emerald-100 via-lime-50 to-sky-100",
    highlights: ["产品卖点", "商品参考图", "视觉结果"],
  },
  {
    id: "storyboard",
    title: "分镜草图",
    description: "将场景说明、镜头参考和结果节点放进同一条视觉叙事链路里。",
    badge: "Storyboard",
    accentClassName: "from-violet-100 via-indigo-50 to-sky-100",
    highlights: ["镜头说明", "分镜参考", "分镜结果"],
  },
];

function cloneCanvasState(state: CanvasState): CanvasState {
  return JSON.parse(JSON.stringify(state)) as CanvasState;
}

function createCanvasRecordId() {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `canvas-${random}`;
}

function normalizeTimestamp(value: string | null | undefined) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortCanvasRecords(records: CanvasLibraryRecord[]) {
  return [...records].sort((left, right) => normalizeTimestamp(right.updatedAt) - normalizeTimestamp(left.updatedAt));
}

function isCanvasState(value: unknown): value is CanvasState {
  const candidate = value as Partial<CanvasState> | null;
  return Boolean(
    candidate &&
    typeof candidate === "object" &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.connections) &&
    candidate.viewport,
  );
}

function normalizeCanvasRecord(value: unknown): CanvasLibraryRecord | null {
  const candidate = value as Partial<CanvasLibraryRecord> | null;
  if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !isCanvasState(candidate.state)) {
    return null;
  }

  const updatedAt = candidate.updatedAt || candidate.state.updatedAt || new Date().toISOString();
  const state = normalizeCanvasState(candidate.state);
  return {
    id: candidate.id,
    state,
    createdAt: candidate.createdAt || updatedAt,
    updatedAt,
  };
}

function parseCanvasLibraryRecords(raw: string | null): CanvasLibraryRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as { records?: unknown[] } | unknown[];
    const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed.records) ? parsed.records : [];
    return sortCanvasRecords(records.map(normalizeCanvasRecord).filter((record): record is CanvasLibraryRecord => Boolean(record)));
  } catch {
    return [];
  }
}

function readCanvasLibraryRecords(storage: CanvasStorageLike): CanvasLibraryRecord[] {
  const records = parseCanvasLibraryRecords(storage.getItem(COLA_CANVAS_LIBRARY_STORAGE_KEY));
  if (records.length > 0) {
    return records;
  }

  const legacyState = loadCanvasState(storage);
  if (!legacyState) {
    return [];
  }

  return [{
    id: LEGACY_CANVAS_RECORD_ID,
    state: legacyState,
    createdAt: legacyState.updatedAt,
    updatedAt: legacyState.updatedAt,
  }];
}

function writeCanvasLibraryRecords(storage: CanvasStorageLike, records: CanvasLibraryRecord[]) {
  storage.setItem(COLA_CANVAS_LIBRARY_STORAGE_KEY, JSON.stringify({ records: sortCanvasRecords(records) }));
}

function touchState(state: CanvasState, title = state.title): CanvasState {
  return {
    ...state,
    title,
    updatedAt: new Date().toISOString(),
    selectedConnectionId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
  };
}

function replaceSeedNode(node: CanvasNodeData, patch: Partial<CanvasNodeData>): CanvasNodeData {
  return {
    ...node,
    ...patch,
    metadata: {
      ...node.metadata,
      ...patch.metadata,
    },
  };
}

export function buildCanvasHomeSummary(state: CanvasState | null | undefined): CanvasHomeSummary {
  if (!state) {
    return EMPTY_SUMMARY;
  }

  const title = state.title?.trim() || "未命名画布";
  const nodeCount = Array.isArray(state.nodes) ? state.nodes.length : 0;
  const nodeTypeCounts = state.nodes.reduce(
    (counts, node) => {
      if (node.type === "text") {
        counts.text += 1;
      } else if (node.type === "image") {
        counts.image += 1;
      } else if (node.type === "config") {
        counts.config += 1;
      } else if (node.type === "generation") {
        counts.generation += 1;
      }
      return counts;
    },
    {
      text: 0,
      image: 0,
      config: 0,
      generation: 0,
    },
  );
  const previewTitles = state.nodes
    .map((node) => node.title?.trim())
    .filter((nodeTitle): nodeTitle is string => Boolean(nodeTitle))
    .slice(0, 3);
  const hasGenerativeContent = state.nodes.some((node) => node.type === "generation" || Boolean(node.metadata?.imageUrl));

  return {
    hasCanvas: true,
    title,
    updatedAt: state.updatedAt || null,
    nodeCount,
    hasGenerativeContent,
    previewTitles,
    nodeTypeCounts,
  };
}

export function getCanvasHomeEntries(storage: CanvasStorageLike): CanvasHomeEntry[] {
  return readCanvasLibraryRecords(storage).map((record) => ({
    id: record.id,
    ...buildCanvasHomeSummary(record.state),
  }));
}

export function getActiveCanvasId(storage: CanvasStorageLike): string | null {
  const records = readCanvasLibraryRecords(storage);
  if (records.length === 0) {
    return null;
  }

  const storedId = storage.getItem(COLA_ACTIVE_CANVAS_ID_STORAGE_KEY);
  if (storedId && records.some((record) => record.id === storedId)) {
    return storedId;
  }

  return records[0].id;
}

export function setActiveCanvasId(storage: CanvasStorageLike, canvasId: string) {
  storage.setItem(COLA_ACTIVE_CANVAS_ID_STORAGE_KEY, canvasId);
}

export function loadCanvasLibraryState(storage: CanvasStorageLike, canvasId = getActiveCanvasId(storage)): CanvasState | null {
  if (!canvasId) {
    return null;
  }

  return readCanvasLibraryRecords(storage).find((record) => record.id === canvasId)?.state ?? null;
}

export function saveCanvasLibraryRecord(
  storage: CanvasStorageLike,
  state: CanvasState,
  options: { canvasId?: string; makeActive?: boolean } = {},
) {
  const normalizedState = normalizeCanvasState(state);
  const canvasId = options.canvasId || createCanvasRecordId();
  const records = readCanvasLibraryRecords(storage);
  const existing = records.find((record) => record.id === canvasId);
  const updatedAt = normalizedState.updatedAt || new Date().toISOString();
  const nextRecord: CanvasLibraryRecord = {
    id: canvasId,
    state: normalizedState,
    createdAt: existing?.createdAt || updatedAt,
    updatedAt,
  };

  writeCanvasLibraryRecords(storage, [nextRecord, ...records.filter((record) => record.id !== canvasId)]);
  if (options.makeActive !== false) {
    setActiveCanvasId(storage, canvasId);
    saveCanvasState(storage, normalizedState);
  }

  return nextRecord;
}

export function deleteCanvasLibraryRecords(storage: CanvasStorageLike, canvasIds: string[]) {
  const canvasIdSet = new Set(canvasIds);
  const records = readCanvasLibraryRecords(storage);
  const nextRecords = records.filter((record) => !canvasIdSet.has(record.id));
  writeCanvasLibraryRecords(storage, nextRecords);

  const activeCanvasId = storage.getItem(COLA_ACTIVE_CANVAS_ID_STORAGE_KEY);
  if (nextRecords.length === 0) {
    storage.removeItem(COLA_ACTIVE_CANVAS_ID_STORAGE_KEY);
    storage.removeItem(COLA_CANVAS_STORAGE_KEY);
    return nextRecords;
  }

  if (activeCanvasId && canvasIdSet.has(activeCanvasId)) {
    setActiveCanvasId(storage, nextRecords[0].id);
    saveCanvasState(storage, nextRecords[0].state);
  }

  return nextRecords;
}

export function deleteCanvasLibraryRecord(storage: CanvasStorageLike, canvasId: string) {
  return deleteCanvasLibraryRecords(storage, [canvasId]);
}

export function getCanvasHomeSummary(storage: CanvasStorageLike): CanvasHomeSummary {
  return buildCanvasHomeSummary(loadCanvasLibraryState(storage));
}

export function createBlankCanvasState(): CanvasState {
  const base = cloneCanvasState(createInitialCanvasState());

  return touchState({
    ...base,
    title: "未命名画布",
    nodes: [],
    connections: [],
    selectedConnectionId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
  }, "未命名画布");
}

export function createTemplateCanvasState(templateId: CanvasTemplateCard["id"]): CanvasState {
  const base = cloneCanvasState(createInitialCanvasState());

  if (templateId === "brand-board") {
    return touchState({
      ...base,
      title: "品牌情绪板",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "品牌关键词", metadata: { content: "高级、清透、可信、科技感。" } }),
        replaceSeedNode(base.nodes[1], { title: "材质参考", metadata: { content: "拖入包装、材质或竞品图片作为风格样本。" } }),
        replaceSeedNode(base.nodes[2], { title: "品牌输出配置", metadata: { prompt: "生成一组品牌情绪板和主视觉方向。", size: "4:3" } }),
        replaceSeedNode(base.nodes[3], { title: "品牌视觉输出", metadata: { content: "生成的情绪板会回到这里。" } }),
      ],
    });
  }

  if (templateId === "poster-concept") {
    return touchState({
      ...base,
      title: "海报概念板",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "海报文案", metadata: { content: "输入主题标题、副标题和关键信息层级。" } }),
        replaceSeedNode(base.nodes[1], { title: "主视觉参考", metadata: { content: "拖入构图、光影或角色参考。" } }),
        replaceSeedNode(base.nodes[2], { title: "海报生成配置", metadata: { prompt: "生成一张有冲击力的概念海报。", size: "2:3" } }),
        replaceSeedNode(base.nodes[3], { title: "海报结果", metadata: { content: "生成的主视觉海报会出现在这里。" } }),
      ],
    });
  }

  if (templateId === "product-collage") {
    return touchState({
      ...base,
      title: "产品视觉拼贴",
      nodes: [
        replaceSeedNode(base.nodes[0], { title: "产品卖点", metadata: { content: "整理核心卖点、使用场景和质感关键词。" } }),
        replaceSeedNode(base.nodes[1], { title: "商品参考图", metadata: { content: "拖入产品主图、包装图或材质特写。" } }),
        replaceSeedNode(base.nodes[2], { title: "商品视觉配置", metadata: { prompt: "生成一组产品拼贴和陈列视觉。", size: "1:1" } }),
        replaceSeedNode(base.nodes[3], { title: "商品视觉结果", metadata: { content: "拼贴结果会保留在这条链路里。" } }),
      ],
    });
  }

  return touchState({
    ...base,
    title: "分镜草图",
    nodes: [
      replaceSeedNode(base.nodes[0], { title: "镜头说明", metadata: { content: "写下场景、视角、节奏和角色动作。" } }),
      replaceSeedNode(base.nodes[1], { title: "分镜参考", metadata: { content: "拖入镜头、布光或构图参考图。" } }),
      replaceSeedNode(base.nodes[2], { title: "分镜配置", metadata: { prompt: "生成一张电影感分镜草图。", size: "16:9" } }),
      replaceSeedNode(base.nodes[3], { title: "分镜结果", metadata: { content: "分镜草图结果会回到这里。" } }),
    ],
  });
}

export function getCanvasTemplateCards() {
  return TEMPLATE_CARDS;
}
