import type { CanvasGuide, CanvasNodeData, CanvasPoint } from "./canvas-types";

export type NodeAnchors = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

export type PrecomputedStationaryAnchors = {
  node: CanvasNodeData;
  anchors: NodeAnchors;
}[];

type SnapArgs = {
  movingNodes: CanvasNodeData[];
  stationaryNodes: CanvasNodeData[];
  delta: CanvasPoint;
  threshold: number;
  precomputedStationary?: PrecomputedStationaryAnchors;
};

type SnapCandidate = {
  difference: number;
  guide: CanvasGuide;
};

function getNodeAnchors(node: CanvasNodeData, delta: CanvasPoint): NodeAnchors {
  const left = node.position.x + delta.x;
  const right = left + node.width;
  const top = node.position.y + delta.y;
  const bottom = top + node.height;
  const centerX = left + node.width / 2;
  const centerY = top + node.height / 2;

  return {
    left,
    right,
    top,
    bottom,
    centerX,
    centerY,
  };
}

export function precomputeStationaryAnchors(nodes: CanvasNodeData[]): PrecomputedStationaryAnchors {
  return nodes.map((node) => ({
    node,
    anchors: getNodeAnchors(node, { x: 0, y: 0 }),
  }));
}

function getVerticalCandidate(
  movingNode: CanvasNodeData,
  movingDelta: CanvasPoint,
  movingAnchor: number,
  stationaryAnchors: NodeAnchors,
  stationaryAnchor: number,
  threshold: number,
): SnapCandidate | null {
  const difference = stationaryAnchor - movingAnchor;
  if (Math.abs(difference) > threshold) {
    return null;
  }

  const moving = getNodeAnchors(movingNode, movingDelta);

  return {
    difference,
    guide: {
      axis: "vertical",
      position: stationaryAnchor,
      start: Math.min(moving.top, stationaryAnchors.top),
      end: Math.max(moving.bottom, stationaryAnchors.bottom),
    },
  };
}

function getHorizontalCandidate(
  movingNode: CanvasNodeData,
  movingDelta: CanvasPoint,
  movingAnchor: number,
  stationaryAnchors: NodeAnchors,
  stationaryAnchor: number,
  threshold: number,
): SnapCandidate | null {
  const difference = stationaryAnchor - movingAnchor;
  if (Math.abs(difference) > threshold) {
    return null;
  }

  const moving = getNodeAnchors(movingNode, movingDelta);

  return {
    difference,
    guide: {
      axis: "horizontal",
      position: stationaryAnchor,
      start: Math.min(moving.left, stationaryAnchors.left),
      end: Math.max(moving.right, stationaryAnchors.right),
    },
  };
}

function getClosestCandidate(candidates: Array<SnapCandidate | null>) {
  return candidates
    .filter((candidate): candidate is SnapCandidate => candidate !== null)
    .sort((left, right) => Math.abs(left.difference) - Math.abs(right.difference))[0] ?? null;
}

function createVerticalCandidates(
  movingNode: CanvasNodeData,
  movingDelta: CanvasPoint,
  stationaryAnchors: NodeAnchors,
  threshold: number,
) {
  const moving = getNodeAnchors(movingNode, movingDelta);
  const movingAnchorValues = [moving.left, moving.centerX, moving.right];
  const stationaryAnchorValues = [stationaryAnchors.left, stationaryAnchors.centerX, stationaryAnchors.right];

  return movingAnchorValues.flatMap((movingAnchor) => (
    stationaryAnchorValues.map((stationaryAnchor) => (
      getVerticalCandidate(movingNode, movingDelta, movingAnchor, stationaryAnchors, stationaryAnchor, threshold)
    ))
  ));
}

function createHorizontalCandidates(
  movingNode: CanvasNodeData,
  movingDelta: CanvasPoint,
  stationaryAnchors: NodeAnchors,
  threshold: number,
) {
  const moving = getNodeAnchors(movingNode, movingDelta);
  const movingAnchorValues = [moving.top, moving.centerY, moving.bottom];
  const stationaryAnchorValues = [stationaryAnchors.top, stationaryAnchors.centerY, stationaryAnchors.bottom];

  return movingAnchorValues.flatMap((movingAnchor) => (
    stationaryAnchorValues.map((stationaryAnchor) => (
      getHorizontalCandidate(movingNode, movingDelta, movingAnchor, stationaryAnchors, stationaryAnchor, threshold)
    ))
  ));
}

export function getSnappedDelta({
  movingNodes,
  stationaryNodes,
  delta,
  threshold,
  precomputedStationary,
}: SnapArgs) {
  if (movingNodes.length === 0 || stationaryNodes.length === 0) {
    return {
      delta,
      guides: [] as CanvasGuide[],
    };
  }

  const stationaryData = precomputedStationary ?? precomputeStationaryAnchors(stationaryNodes);

  const verticalCandidates = movingNodes.flatMap((movingNode) => {
    return stationaryData.flatMap(({ anchors }) => {
      return createVerticalCandidates(movingNode, delta, anchors, threshold);
    });
  });

  const horizontalCandidates = movingNodes.flatMap((movingNode) => {
    return stationaryData.flatMap(({ anchors }) => {
      return createHorizontalCandidates(movingNode, delta, anchors, threshold);
    });
  });

  const vertical = getClosestCandidate(verticalCandidates);
  const horizontal = getClosestCandidate(horizontalCandidates);
  const guides: CanvasGuide[] = [];

  if (vertical) {
    guides.push(vertical.guide);
  }
  if (horizontal) {
    guides.push(horizontal.guide);
  }

  return {
    delta: {
      x: delta.x + (vertical?.difference ?? 0),
      y: delta.y + (horizontal?.difference ?? 0),
    },
    guides,
  };
}
