import type { PointerEvent as ReactPointerEvent } from "react";

import type { CanvasConnectionData, CanvasNodeData } from "./canvas-types";
import type { CanvasReferenceImage, CanvasUpstreamSummary } from "./canvas-workflow";

type CanvasLayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CanvasNodeComparableProps = {
  node: CanvasNodeData;
  selected: boolean;
  referenceImages?: CanvasReferenceImage[];
  upstreamSummary?: CanvasUpstreamSummary | null;
  onContentChange: (nodeId: string, content: string) => void;
  onOpenGeneration: (nodeId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, nodeId: string) => void;
};

type CanvasConnectionsComparableProps = {
  nodes: CanvasNodeData[];
  connections: CanvasConnectionData[];
  bounds?: CanvasLayerBounds;
  selectedConnectionId: string | null;
  onSelectConnection: (connectionId: string) => void;
};

function areShallowItemsEqual<T>(previous: T[], next: T[]) {
  return previous.length === next.length && previous.every((item, index) => item === next[index]);
}

export function areCanvasNodePropsEqual(
  previous: CanvasNodeComparableProps,
  next: CanvasNodeComparableProps,
) {
  return (
    previous.node === next.node &&
    previous.selected === next.selected &&
    previous.referenceImages === next.referenceImages &&
    previous.upstreamSummary === next.upstreamSummary
  );
}

export function areCanvasConnectionsPropsEqual(
  previous: CanvasConnectionsComparableProps,
  next: CanvasConnectionsComparableProps,
) {
  return (
    areShallowItemsEqual(previous.nodes, next.nodes) &&
    areShallowItemsEqual(previous.connections, next.connections) &&
    previous.bounds?.left === next.bounds?.left &&
    previous.bounds?.top === next.bounds?.top &&
    previous.bounds?.width === next.bounds?.width &&
    previous.bounds?.height === next.bounds?.height &&
    previous.selectedConnectionId === next.selectedConnectionId
  );
}
