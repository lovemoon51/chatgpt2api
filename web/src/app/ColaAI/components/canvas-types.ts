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
export type CanvasImageOption = "panorama" | "multiAngle" | "lighting" | "grid" | "upscale" | "slice" | "crop";
export type CanvasUpscaleResolution = "1k" | "2k" | "4k";
export type CanvasVideoResolution = "480p" | "720p" | "custom";
export type CanvasGridSplitMode = "2x2" | "3x3" | "4x4" | "5x5";
export type CanvasCropRatio = "original" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export type CanvasNodeMetadata = {
  content?: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: "image" | "video" | string;
  generationMode?: "image" | "video";
  imageOptions?: CanvasImageOption[];
  derivativeType?: CanvasImageOption;
  sourceImageNodeId?: string;
  prompt?: string;
  promptMode?: "optimize" | "imageReverse" | "imageToText";
  referenceImageNodeIds?: string[];
  imageTextResult?: {
    description?: string;
    tags?: string[];
    prompt?: string;
    analysis?: {
      subject: string;
      scene: string;
      lighting: string;
      style: string;
      composition: string;
      [key: string]: string;
    };
  };
  model?: "gpt-image-2" | "codex-gpt-image-2" | string;
  size?: string;
  upscaleResolution?: CanvasUpscaleResolution | string;
  videoDurationSeconds?: number;
  videoResolution?: CanvasVideoResolution | string;
  videoCustomWidth?: number;
  videoCustomHeight?: number;
  gridSplitMode?: CanvasGridSplitMode | string;
  cropRatio?: CanvasCropRatio | string;
  count?: number;
  status?: CanvasNodeStatus;
  sourceTaskId?: string;
  errorDetails?: string;
  retrying?: boolean;
  attempt?: number;
  imageNaturalWidth?: number;
  imageNaturalHeight?: number;
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
  videoUrl?: string;
  mediaType?: "image" | "video";
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
