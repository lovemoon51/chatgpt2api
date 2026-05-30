export type CanvasPoint = {
  x: number;
  y: number;
};

export type CanvasViewport = CanvasPoint & {
  k: number;
};

export type CanvasInteractionMode = "pointer" | "hand";

export type CanvasNodeType = "text" | "image" | "video" | "config" | "generation";
export type CanvasCreatableNodeType = Exclude<CanvasNodeType, "generation">;

export type CanvasNodeStatus = "idle" | "loading" | "success" | "error";

export type CanvasNodeMetadata = {
  content?: string;
  imageUrl?: string;
  prompt?: string;
  model?: "gpt-image-2" | "codex-gpt-image-2" | string;
  size?: string;
  count?: number;
  status?: CanvasNodeStatus;
  sourceTaskId?: string;
  errorDetails?: string;
  retrying?: boolean;
  attempt?: number;
};

export type CanvasNodeData = {
  id: string;
  type: CanvasNodeType;
  title: string;
  position: CanvasPoint;
  width: number;
  height: number;
  metadata?: CanvasNodeMetadata;
};

export type CanvasConnectionData = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
};

export type CanvasSelectionRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CanvasGuide = {
  axis: "horizontal" | "vertical";
  position: number;
  start: number;
  end: number;
};

export type CanvasState = {
  title: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnectionData[];
  viewport: CanvasViewport;
  selectedNodeIds: string[];
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  updatedAt: string;
};

export type CanvasGenerationPayload = {
  prompt: string;
  imageUrl: string;
  sourceTaskId?: string;
  status?: CanvasNodeStatus;
  errorDetails?: string;
  model?: string;
  size?: string;
  attempt?: number;
};

export type CanvasStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
