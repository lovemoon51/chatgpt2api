import type { CanvasNodeData, CanvasPoint, CanvasSelectionRect } from "./canvas-types";

export function createSelectionRect(
  start: CanvasPoint,
  end: CanvasPoint,
): CanvasSelectionRect {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

export function getNodesInSelectionRect(
  nodes: CanvasNodeData[],
  rect: CanvasSelectionRect,
) {
  return nodes
    .filter((node) => (
      node.position.x < rect.right &&
      node.position.x + node.width > rect.left &&
      node.position.y < rect.bottom &&
      node.position.y + node.height > rect.top
    ))
    .map((node) => node.id);
}
