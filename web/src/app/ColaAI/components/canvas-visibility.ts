import type { CanvasConnectionData, CanvasNodeData, CanvasViewport } from "./canvas-types";

type CanvasViewportSize = {
  width: number;
  height: number;
};

type CanvasLayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function getVisibleCanvasNodes(
  nodes: CanvasNodeData[],
  viewport: CanvasViewport,
  size: CanvasViewportSize,
  padding = 280,
  pinnedNodeIds: string[] = [],
) {
  if (size.width <= 0 || size.height <= 0) {
    return nodes;
  }

  const pinned = new Set(pinnedNodeIds);
  const scale = Number.isFinite(viewport.k) && viewport.k > 0 ? viewport.k : 1;
  const viewLeft = -viewport.x / scale - padding;
  const viewTop = -viewport.y / scale - padding;
  const viewRight = viewLeft + size.width / scale + padding * 2;
  const viewBottom = viewTop + size.height / scale + padding * 2;

  return nodes.filter((node) => (
    pinned.has(node.id) ||
    (
      node.position.x + node.width > viewLeft &&
      node.position.x < viewRight &&
      node.position.y + node.height > viewTop &&
      node.position.y < viewBottom
    )
  ));
}

export function getVisibleCanvasConnections(
  connections: CanvasConnectionData[],
  nodes: CanvasNodeData[],
) {
  const visibleNodeIds = new Set(nodes.map((node) => node.id));

  return connections.filter((connection) => (
    visibleNodeIds.has(connection.fromNodeId) &&
    visibleNodeIds.has(connection.toNodeId)
  ));
}

export function getCanvasLayerBounds(nodes: CanvasNodeData[], padding = 160): CanvasLayerBounds {
  if (nodes.length === 0) {
    return {
      left: -padding,
      top: -padding,
      width: padding * 2,
      height: padding * 2,
    };
  }

  const left = Math.min(...nodes.map((node) => node.position.x)) - padding;
  const top = Math.min(...nodes.map((node) => node.position.y)) - padding;
  const right = Math.max(...nodes.map((node) => node.position.x + node.width)) + padding;
  const bottom = Math.max(...nodes.map((node) => node.position.y + node.height)) + padding;

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
