import { describe, expect, test } from "bun:test";

import type { CanvasStorageLike } from "./canvas-types";
import {
  buildCanvasHomeSummary,
  createBlankCanvasState,
  createTemplateCanvasState,
  getActiveCanvasId,
  getCanvasHomeEntries,
  getCanvasHomeSummary,
  getCanvasTemplateCards,
  deleteCanvasLibraryRecords,
  loadCanvasLibraryState,
  deleteCanvasLibraryRecord,
  saveCanvasLibraryRecord,
  setActiveCanvasId,
} from "./canvas-home-state";
import { COLA_CANVAS_STORAGE_KEY, createInitialCanvasState, saveCanvasState } from "./use-canvas-store";

function createMemoryStorage(seed: Record<string, string> = {}): CanvasStorageLike {
  const store = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

describe("canvas-home-state", () => {
  test("builds a filled summary from an existing canvas state", () => {
    const state = createInitialCanvasState();

    expect(buildCanvasHomeSummary(state)).toEqual({
      hasCanvas: true,
      title: "未命名画布",
      updatedAt: state.updatedAt,
      nodeCount: 4,
      hasGenerativeContent: true,
      previewTitles: ["创意提示词", "参考图片", "生成配置"],
      nodeTypeCounts: {
        text: 1,
        image: 1,
        config: 1,
        generation: 1,
      },
    });
  });

  test("returns an empty fallback summary when storage has no canvas", () => {
    const storage = createMemoryStorage();
    const summary = getCanvasHomeSummary(storage);

    expect(summary.hasCanvas).toBe(false);
    expect(summary.title).toBe("还没有画布");
    expect(summary.nodeCount).toBe(0);
    expect(summary.hasGenerativeContent).toBe(false);
  });

  test("loads the persisted canvas summary from storage", () => {
    const storage = createMemoryStorage();
    const state = createInitialCanvasState();
    saveCanvasState(storage, state);

    const summary = getCanvasHomeSummary(storage);

    expect(summary.hasCanvas).toBe(true);
    expect(summary.title).toBe("未命名画布");
    expect(storage.getItem(COLA_CANVAS_STORAGE_KEY)).not.toBeNull();
  });

  test("keeps separate records for multiple saved canvases", () => {
    const storage = createMemoryStorage();
    const first = {
      ...createBlankCanvasState(),
      title: "第一张画布",
      updatedAt: "2026-05-29T08:00:00.000Z",
    };
    const second = {
      ...createTemplateCanvasState("brand-board"),
      title: "品牌探索画布",
      updatedAt: "2026-05-29T09:00:00.000Z",
    };

    saveCanvasLibraryRecord(storage, first, { canvasId: "canvas-first" });
    saveCanvasLibraryRecord(storage, second, { canvasId: "canvas-second" });

    const entries = getCanvasHomeEntries(storage);

    expect(entries.map((entry) => entry.id)).toEqual(["canvas-second", "canvas-first"]);
    expect(entries.map((entry) => entry.title)).toEqual(["品牌探索画布", "第一张画布"]);
    expect(entries[0].nodeCount).toBeGreaterThan(0);
    expect(entries[1].nodeCount).toBe(0);
    expect(getActiveCanvasId(storage)).toBe("canvas-second");
  });

  test("migrates the legacy single canvas slot into the canvas library view", () => {
    const storage = createMemoryStorage();
    const legacy = {
      ...createInitialCanvasState(),
      title: "旧画布",
      updatedAt: "2026-05-29T07:00:00.000Z",
    };
    saveCanvasState(storage, legacy);

    const entries = getCanvasHomeEntries(storage);

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("旧画布");
    expect(entries[0].nodeCount).toBe(4);
  });

  test("normalizes legacy config node dimensions when loading library records", () => {
    const legacy = createTemplateCanvasState("brand-board");
    const legacyRecord = {
      id: "canvas-legacy",
      state: {
        ...legacy,
        nodes: legacy.nodes.map((node) => (
          node.type === "config"
            ? { ...node, width: 250, height: 186 }
            : node
        )),
      },
      createdAt: "2026-05-29T07:00:00.000Z",
      updatedAt: "2026-05-29T07:00:00.000Z",
    };
    const storage = createMemoryStorage({
      "chatgpt2api:cola_canvas_library": JSON.stringify({ records: [legacyRecord] }),
    });

    const loaded = loadCanvasLibraryState(storage, "canvas-legacy");
    const configNode = loaded?.nodes.find((node) => node.type === "config");

    expect(configNode?.width).toBe(430);
    expect(configNode?.height).toBe(260);
  });

  test("uses the active canvas record when building the compatibility summary", () => {
    const storage = createMemoryStorage();
    saveCanvasLibraryRecord(storage, {
      ...createBlankCanvasState(),
      title: "第一张画布",
      updatedAt: "2026-05-29T08:00:00.000Z",
    }, { canvasId: "canvas-first" });
    saveCanvasLibraryRecord(storage, {
      ...createTemplateCanvasState("poster-concept"),
      title: "海报画布",
      updatedAt: "2026-05-29T09:00:00.000Z",
    }, { canvasId: "canvas-second" });

    setActiveCanvasId(storage, "canvas-first");

    expect(getCanvasHomeSummary(storage).title).toBe("第一张画布");
  });

  test("deletes a canvas record and promotes the next record when removing the active one", () => {
    const storage = createMemoryStorage();
    saveCanvasLibraryRecord(storage, {
      ...createBlankCanvasState(),
      title: "第一张画布",
      updatedAt: "2026-05-29T08:00:00.000Z",
    }, { canvasId: "canvas-first" });
    saveCanvasLibraryRecord(storage, {
      ...createTemplateCanvasState("poster-concept"),
      title: "海报画布",
      updatedAt: "2026-05-29T09:00:00.000Z",
    }, { canvasId: "canvas-second" });

    setActiveCanvasId(storage, "canvas-first");
    const nextRecords = deleteCanvasLibraryRecord(storage, "canvas-first");

    expect(nextRecords.map((entry) => entry.id)).toEqual(["canvas-second"]);
    expect(getActiveCanvasId(storage)).toBe("canvas-second");
    expect(loadCanvasLibraryState(storage, "canvas-first")).toBeNull();
  });

  test("deletes multiple canvas records in one pass", () => {
    const storage = createMemoryStorage();
    saveCanvasLibraryRecord(storage, {
      ...createBlankCanvasState(),
      title: "第一张画布",
      updatedAt: "2026-05-29T08:00:00.000Z",
    }, { canvasId: "canvas-first" });
    saveCanvasLibraryRecord(storage, {
      ...createTemplateCanvasState("poster-concept"),
      title: "海报画布",
      updatedAt: "2026-05-29T09:00:00.000Z",
    }, { canvasId: "canvas-second" });
    saveCanvasLibraryRecord(storage, {
      ...createTemplateCanvasState("brand-board"),
      title: "品牌画布",
      updatedAt: "2026-05-29T10:00:00.000Z",
    }, { canvasId: "canvas-third" });

    const nextRecords = deleteCanvasLibraryRecords(storage, ["canvas-first", "canvas-third"]);

    expect(nextRecords.map((entry) => entry.id)).toEqual(["canvas-second"]);
    expect(getCanvasHomeEntries(storage).map((entry) => entry.id)).toEqual(["canvas-second"]);
  });

  test("creates a blank canvas state with a fresh timestamp and default title", () => {
    const blank = createBlankCanvasState();

    expect(blank.title).toBe("未命名画布");
    expect(blank.nodes).toHaveLength(0);
    expect(blank.connections).toHaveLength(0);
    expect(blank.updatedAt).toBeTruthy();
  });

  test("treats a saved blank canvas as a resumable project", () => {
    const blank = createBlankCanvasState();

    expect(buildCanvasHomeSummary(blank)).toEqual({
      hasCanvas: true,
      title: "未命名画布",
      updatedAt: blank.updatedAt,
      nodeCount: 0,
      hasGenerativeContent: false,
      previewTitles: [],
      nodeTypeCounts: {
        text: 0,
        image: 0,
        config: 0,
        generation: 0,
      },
    });
  });

  test("creates a template canvas state with a template title and matching seed nodes", () => {
    const template = createTemplateCanvasState("brand-board");

    expect(template.title).toBe("品牌情绪板");
    expect(template.nodes.length).toBeGreaterThanOrEqual(4);
    expect(template.nodes.some((node) => node.title.includes("品牌"))).toBe(true);
    expect(template.connections.length).toBeGreaterThan(0);
  });

  test("returns four local template cards for the canvas homepage", () => {
    const cards = getCanvasTemplateCards();

    expect(cards.map((card) => card.id)).toEqual([
      "brand-board",
      "poster-concept",
      "product-collage",
      "storyboard",
    ]);
    expect(cards.every((card) => card.highlights.length === 3)).toBe(true);
  });
});
