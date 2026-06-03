import type { CanvasPoint } from "./canvas-types";

type CanvasConnectionPathInput = {
  position: CanvasPoint;
  width: number;
  height: number;
};

export function computeCanvasConnectionPath(
  from: CanvasConnectionPathInput,
  to: CanvasConnectionPathInput,
): string {
  const startX = from.position.x + from.width;
  const startY = from.position.y + from.height / 2;
  const endX = to.position.x;
  const endY = to.position.y + to.height / 2;
  const distance = Math.abs(endX - startX);
  const curvature = Math.max(distance * 0.46, 68);
  return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}
