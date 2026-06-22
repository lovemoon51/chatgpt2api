import type { CanvasPoint } from "./canvas-types";

export type CanvasConnectorHandle = {
  nodeId: string;
  kind: "input" | "output";
  center: CanvasPoint;
};

type ConnectorHitOptions = {
  excludeNodeId?: string;
  kind: CanvasConnectorHandle["kind"];
  radius: number;
};

function distanceSquared(left: CanvasPoint, right: CanvasPoint) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

export function findNearestConnectorHandle(
  handles: CanvasConnectorHandle[],
  point: CanvasPoint,
  options: ConnectorHitOptions,
) {
  const maxDistanceSquared = options.radius * options.radius;
  return handles
    .filter((handle) => handle.kind === options.kind && handle.nodeId !== options.excludeNodeId)
    .map((handle) => ({
      handle,
      distanceSquared: distanceSquared(handle.center, point),
    }))
    .filter((item) => item.distanceSquared <= maxDistanceSquared)
    .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.handle ?? null;
}
