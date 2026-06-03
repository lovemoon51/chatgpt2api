import type { CanvasConnectionData, CanvasNodeData, CanvasPoint, CanvasViewport } from "./canvas-types";

export type LayoutMode = "grid" | "free";

const gapX = 60;
const gapY = 60;
const smartColumnGap = 150;
const smartRowGap = 72;
const maxTreeColumnsPerBand = 8;
const treeBandGap = 240;
const workflowGroupGap = 220;
const gridSplitTileGap = 18;

type CanvasRect = CanvasPoint & {
  width: number;
  height: number;
};

type GridSplitTileGroup = {
  id: string;
  sourceNodeId: string;
  members: CanvasNodeData[];
  bounds: CanvasRect;
  memberOffsets: Map<string, CanvasPoint>;
};

type GridSplitTileCoordinate = {
  row: number;
  col: number;
};

function getNodeRect(node: CanvasNodeData): CanvasRect {
  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width,
    height: node.height,
  };
}

export function getCanvasNodesBounds(nodes: CanvasNodeData[]): CanvasRect | null {
  if (nodes.length === 0) {
    return null;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const rect = getNodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  });

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function computeGridLayout(nodes: CanvasNodeData[]): Record<string, CanvasPoint> {
  if (nodes.length === 0) {
    return {};
  }

  const cols = Math.ceil(Math.sqrt(nodes.length));
  const maxWidthPerCol: number[] = Array(cols).fill(0);
  const maxHeightPerRow: number[] = [];

  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    maxWidthPerCol[col] = Math.max(maxWidthPerCol[col], node.width);
    if (!maxHeightPerRow[row]) {
      maxHeightPerRow[row] = 0;
    }
    maxHeightPerRow[row] = Math.max(maxHeightPerRow[row], node.height);
  });

  const positions: Record<string, CanvasPoint> = {};
  let currentY = 100;

  nodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);

    if (col === 0 && row > 0) {
      currentY += maxHeightPerRow[row - 1] + gapY;
    }

    let currentX = 100;
    for (let c = 0; c < col; c++) {
      currentX += maxWidthPerCol[c] + gapX;
    }

    positions[node.id] = { x: currentX, y: row === 0 ? 100 : currentY };
  });

  return positions;
}

export function computeTreeLayout(
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
): Record<string, CanvasPoint> {
  if (nodes.length === 0) {
    return {};
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));

  connections.forEach((connection) => {
    if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) {
      return;
    }
    outgoing.get(connection.fromNodeId)?.push(connection.toNodeId);
    indegree.set(connection.toNodeId, (indegree.get(connection.toNodeId) ?? 0) + 1);
  });

  const queue = nodes
    .filter((node) => (indegree.get(node.id) ?? 0) === 0)
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const rank = new Map(nodes.map((node) => [node.id, 0]));
  const visited = new Set<string>();

  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node.id)) {
      continue;
    }
    visited.add(node.id);

    for (const targetId of outgoing.get(node.id) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(node.id) ?? 0) + 1));
      indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
      if ((indegree.get(targetId) ?? 0) <= 0) {
        const target = nodes.find((item) => item.id === targetId);
        if (target) {
          queue.push(target);
        }
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const incoming = connections.filter((connection) => connection.toNodeId === node.id && nodeIds.has(connection.fromNodeId));
      const fallbackRank = incoming.reduce((max, connection) => Math.max(max, (rank.get(connection.fromNodeId) ?? 0) + 1), 0);
      rank.set(node.id, fallbackRank);
    }
  }

  const columns = new Map<number, CanvasNodeData[]>();
  nodes.forEach((node) => {
    const column = rank.get(node.id) ?? 0;
    columns.set(column, [...(columns.get(column) ?? []), node]);
  });

  const bounds = getCanvasNodesBounds(nodes) ?? { x: 0, y: 0, width: 0, height: 0 };
  const positions: Record<string, CanvasPoint> = {};
  let cursorX = bounds.x;
  let cursorYBase = bounds.y;
  let bandHeight = 0;

  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([, columnNodes], columnIndex) => {
    if (columnIndex > 0 && columnIndex % maxTreeColumnsPerBand === 0) {
      cursorX = bounds.x;
      cursorYBase += bandHeight + treeBandGap;
      bandHeight = 0;
    }

    const sorted = [...columnNodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const columnWidth = Math.max(...sorted.map((node) => node.width));
    const totalHeight = sorted.reduce((sum, node) => sum + node.height, 0) + smartRowGap * Math.max(0, sorted.length - 1);
    let cursorY = cursorYBase + bounds.height / 2 - totalHeight / 2;

    sorted.forEach((node) => {
      positions[node.id] = {
        x: cursorX + (columnWidth - node.width) / 2,
        y: cursorY,
      };
      cursorY += node.height + smartRowGap;
    });

    bandHeight = Math.max(bandHeight, totalHeight);
    cursorX += columnWidth + smartColumnGap;
  });

  return positions;
}

function isGridSplitTileNode(node: CanvasNodeData) {
  return node.type === "image" && node.metadata?.derivativeType === "slice" && typeof node.metadata.sourceImageNodeId === "string";
}

function getGridSplitTileCoordinate(node: CanvasNodeData): GridSplitTileCoordinate | null {
  const match = node.title.match(/^宫格\s+(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }

  const row = Number(match[1]) - 1;
  const col = Number(match[2]) - 1;
  if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) {
    return null;
  }

  return { row, col };
}

function getGridSplitTileLayout(members: CanvasNodeData[]) {
  const coordinates = members.map((node) => ({ node, coordinate: getGridSplitTileCoordinate(node) }));
  if (coordinates.some((item) => !item.coordinate)) {
    const bounds = getCanvasNodesBounds(members);
    if (!bounds) {
      return null;
    }
    return {
      bounds,
      members: [...members].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
      memberOffsets: new Map(members.map((node) => [
        node.id,
        { x: node.position.x - bounds.x, y: node.position.y - bounds.y },
      ])),
    };
  }

  const sortedMembers = [...coordinates]
    .sort((a, b) => (
      a.coordinate!.row - b.coordinate!.row ||
      a.coordinate!.col - b.coordinate!.col
    ));
  const colWidths = new Map<number, number>();
  const rowHeights = new Map<number, number>();
  sortedMembers.forEach(({ node, coordinate }) => {
    colWidths.set(coordinate!.col, Math.max(colWidths.get(coordinate!.col) ?? 0, node.width));
    rowHeights.set(coordinate!.row, Math.max(rowHeights.get(coordinate!.row) ?? 0, node.height));
  });

  const colOffsets = new Map<number, number>();
  [...colWidths.keys()].sort((a, b) => a - b).forEach((col, index, cols) => {
    const previousCol = cols[index - 1];
    colOffsets.set(col, previousCol === undefined
      ? 0
      : (colOffsets.get(previousCol) ?? 0) + (colWidths.get(previousCol) ?? 0) + gridSplitTileGap);
  });
  const rowOffsets = new Map<number, number>();
  [...rowHeights.keys()].sort((a, b) => a - b).forEach((row, index, rows) => {
    const previousRow = rows[index - 1];
    rowOffsets.set(row, previousRow === undefined
      ? 0
      : (rowOffsets.get(previousRow) ?? 0) + (rowHeights.get(previousRow) ?? 0) + gridSplitTileGap);
  });

  const memberOffsets = new Map<string, CanvasPoint>();
  sortedMembers.forEach(({ node, coordinate }) => {
    memberOffsets.set(node.id, {
      x: colOffsets.get(coordinate!.col) ?? 0,
      y: rowOffsets.get(coordinate!.row) ?? 0,
    });
  });

  const lastCol = Math.max(...colWidths.keys());
  const lastRow = Math.max(...rowHeights.keys());
  const actualBounds = getCanvasNodesBounds(members);
  return {
    bounds: {
      x: actualBounds?.x ?? 0,
      y: actualBounds?.y ?? 0,
      width: (colOffsets.get(lastCol) ?? 0) + (colWidths.get(lastCol) ?? 1),
      height: (rowOffsets.get(lastRow) ?? 0) + (rowHeights.get(lastRow) ?? 1),
    },
    members: sortedMembers.map((item) => item.node),
    memberOffsets,
  };
}

function getGridSplitTileGroups(nodes: CanvasNodeData[]): GridSplitTileGroup[] {
  const bySourceNodeId = new Map<string, CanvasNodeData[]>();
  nodes.forEach((node) => {
    if (!isGridSplitTileNode(node) || !node.metadata?.sourceImageNodeId) {
      return;
    }
    bySourceNodeId.set(node.metadata.sourceImageNodeId, [
      ...(bySourceNodeId.get(node.metadata.sourceImageNodeId) ?? []),
      node,
    ]);
  });

  return [...bySourceNodeId.entries()]
    .map(([sourceNodeId, members]) => {
      const tileLayout = getGridSplitTileLayout(members);
      if (!tileLayout || tileLayout.members.length <= 1) {
        return null;
      }
      return {
        id: `__grid_split_group_${sourceNodeId}`,
        sourceNodeId,
        members: tileLayout.members,
        bounds: tileLayout.bounds,
        memberOffsets: tileLayout.memberOffsets,
      };
    })
    .filter((group): group is GridSplitTileGroup => Boolean(group));
}

function collapseGridSplitTileGroups(
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
) {
  const groups = getGridSplitTileGroups(nodes);
  if (groups.length === 0) {
    return null;
  }

  const tileIdToGroup = new Map<string, GridSplitTileGroup>();
  const firstTileIdToGroup = new Map<string, GridSplitTileGroup>();
  groups.forEach((group) => {
    group.members.forEach((node) => tileIdToGroup.set(node.id, group));
    firstTileIdToGroup.set(group.members[0].id, group);
  });

  const collapsedNodes = nodes.flatMap((node): CanvasNodeData[] => {
    const group = tileIdToGroup.get(node.id);
    if (!group) {
      return [node];
    }
    if (firstTileIdToGroup.get(node.id) !== group) {
      return [];
    }
    return [{
      id: group.id,
      type: "image",
      title: "Grid split tiles",
      position: { x: group.bounds.x, y: group.bounds.y },
      width: group.bounds.width,
      height: group.bounds.height,
    }];
  });
  const collapsedNodeIds = new Set(collapsedNodes.map((node) => node.id));
  const seenConnections = new Set<string>();
  const collapsedConnections = connections.flatMap((connection): CanvasConnectionData[] => {
    const fromNodeId = tileIdToGroup.get(connection.fromNodeId)?.id ?? connection.fromNodeId;
    const toNodeId = tileIdToGroup.get(connection.toNodeId)?.id ?? connection.toNodeId;
    if (fromNodeId === toNodeId || !collapsedNodeIds.has(fromNodeId) || !collapsedNodeIds.has(toNodeId)) {
      return [];
    }
    const key = `${fromNodeId}->${toNodeId}`;
    if (seenConnections.has(key)) {
      return [];
    }
    seenConnections.add(key);
    return [{ ...connection, fromNodeId, toNodeId }];
  });

  return { nodes: collapsedNodes, connections: collapsedConnections, groups };
}

function expandGridSplitTileGroups(
  collapsedPositions: Record<string, CanvasPoint>,
  groups: GridSplitTileGroup[],
) {
  const groupIds = new Set(groups.map((group) => group.id));
  const positions: Record<string, CanvasPoint> = {};
  Object.entries(collapsedPositions).forEach(([nodeId, position]) => {
    if (!groupIds.has(nodeId)) {
      positions[nodeId] = position;
    }
  });

  groups.forEach((group) => {
    const groupPosition = collapsedPositions[group.id] ?? group.bounds;
    group.members.forEach((node) => {
      const offset = group.memberOffsets.get(node.id) ?? {
        x: node.position.x - group.bounds.x,
        y: node.position.y - group.bounds.y,
      };
      positions[node.id] = {
        x: groupPosition.x + offset.x,
        y: groupPosition.y + offset.y,
      };
    });
  });

  return positions;
}

function alignGridSplitTileGroupsWithConfig(
  collapsedPositions: Record<string, CanvasPoint>,
  nodes: CanvasNodeData[],
  groups: GridSplitTileGroup[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nextPositions = { ...collapsedPositions };

  groups.forEach((group) => {
    const configNode = nodesById.get(group.sourceNodeId);
    const configPosition = nextPositions[group.sourceNodeId] ?? configNode?.position;
    const groupPosition = nextPositions[group.id];
    if (
      configNode?.type !== "config" ||
      configNode.metadata?.derivativeType !== "slice" ||
      !configPosition ||
      !groupPosition
    ) {
      return;
    }

    nextPositions[group.id] = {
      ...groupPosition,
      y: configPosition.y + configNode.height / 2 - group.bounds.height / 2,
    };
  });

  return nextPositions;
}

function isSuccessfulUpscaleResult(node: CanvasNodeData) {
  return node.type === "generation" && (
    node.metadata?.status === "success" ||
    typeof node.metadata?.imageUrl === "string"
  );
}

function alignUpscaleResultNodes(
  positions: Record<string, CanvasPoint>,
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const successfulResultIdsByConfigId = new Map<string, string[]>();

  connections.forEach((connection) => {
    const configNode = nodesById.get(connection.fromNodeId);
    const resultNode = nodesById.get(connection.toNodeId);
    if (
      configNode?.type !== "config" ||
      configNode.metadata?.derivativeType !== "upscale" ||
      !resultNode ||
      !isSuccessfulUpscaleResult(resultNode)
    ) {
      return;
    }

    successfulResultIdsByConfigId.set(connection.fromNodeId, [
      ...(successfulResultIdsByConfigId.get(connection.fromNodeId) ?? []),
      connection.toNodeId,
    ]);
  });

  if (successfulResultIdsByConfigId.size === 0) {
    return positions;
  }

  const nextPositions = { ...positions };
  successfulResultIdsByConfigId.forEach((resultIds, configId) => {
    if (resultIds.length !== 1) {
      return;
    }

    const configNode = nodesById.get(configId);
    const resultNode = nodesById.get(resultIds[0]);
    const configPosition = nextPositions[configId] ?? configNode?.position;
    const resultPosition = nextPositions[resultIds[0]] ?? resultNode?.position;
    if (!configNode || !resultNode || !configPosition || !resultPosition) {
      return;
    }

    nextPositions[resultNode.id] = {
      ...resultPosition,
      y: configPosition.y + configNode.height / 2 - resultNode.height / 2,
    };
  });

  return nextPositions;
}

function getConnectedNodeGroups(
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
): CanvasNodeData[][] {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const neighbors = new Map(nodes.map((node) => [node.id, [] as string[]]));

  connections.forEach((connection) => {
    if (!nodeIds.has(connection.fromNodeId) || !nodeIds.has(connection.toNodeId)) {
      return;
    }
    neighbors.get(connection.fromNodeId)?.push(connection.toNodeId);
    neighbors.get(connection.toNodeId)?.push(connection.fromNodeId);
  });

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const groups: CanvasNodeData[][] = [];

  nodes
    .slice()
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
    .forEach((node) => {
      if (visited.has(node.id)) {
        return;
      }
      const queue = [node.id];
      const group: CanvasNodeData[] = [];
      visited.add(node.id);
      while (queue.length) {
        const id = queue.shift()!;
        const item = nodesById.get(id);
        if (item) {
          group.push(item);
        }
        for (const neighbor of neighbors.get(id) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      groups.push(group.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y));
    });

  return groups;
}

export function computeGroupedTreeLayout(
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
): Record<string, CanvasPoint> {
  if (nodes.length === 0) {
    return {};
  }

  const groups = getConnectedNodeGroups(nodes, connections);
  if (groups.length <= 1) {
    return computeTreeLayout(nodes, connections);
  }

  const bounds = getCanvasNodesBounds(nodes) ?? { x: 0, y: 0, width: 0, height: 0 };
  const positions: Record<string, CanvasPoint> = {};
  let cursorX = bounds.x;
  let cursorY = bounds.y;
  let rowHeight = 0;
  const maxRowWidth = Math.max(1200, Math.min(3600, bounds.width));

  groups.forEach((group, groupIndex) => {
    const groupNodeIds = new Set(group.map((node) => node.id));
    const groupConnections = connections.filter((connection) => (
      groupNodeIds.has(connection.fromNodeId) &&
      groupNodeIds.has(connection.toNodeId)
    ));
    const groupPositions = computeTreeLayout(group, groupConnections);
    const arrangedGroup = group.map((node) => ({
      ...node,
      position: groupPositions[node.id] ?? node.position,
    }));
    const groupBounds = getCanvasNodesBounds(arrangedGroup);
    if (!groupBounds) {
      return;
    }

    if (groupIndex > 0 && cursorX > bounds.x && cursorX + groupBounds.width > bounds.x + maxRowWidth) {
      cursorX = bounds.x;
      cursorY += rowHeight + workflowGroupGap;
      rowHeight = 0;
    }

    arrangedGroup.forEach((node) => {
      positions[node.id] = {
        x: cursorX + node.position.x - groupBounds.x,
        y: cursorY + node.position.y - groupBounds.y,
      };
    });

    cursorX += groupBounds.width + workflowGroupGap;
    rowHeight = Math.max(rowHeight, groupBounds.height);
  });

  return positions;
}

export function computeFitViewport(
  nodes: CanvasNodeData[],
  viewportSize: { width: number; height: number },
): CanvasViewport | null {
  const bounds = getCanvasNodesBounds(nodes);
  if (!bounds) {
    return null;
  }

  const width = Math.max(360, viewportSize.width);
  const height = Math.max(280, viewportSize.height);
  const padding = Math.min(160, Math.max(80, Math.min(width, height) * 0.16));
  const k = Math.min((width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height, 2);
  const zoom = Math.min(4, Math.max(0.12, k));

  return {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    k: zoom,
  };
}

export function computeAutoLayout(
  mode: "grid" | "tree",
  nodes: CanvasNodeData[],
  connections: CanvasConnectionData[],
): Record<string, CanvasPoint> {
  const collapsed = collapseGridSplitTileGroups(nodes, connections);
  if (collapsed) {
    const collapsedPositions = mode === "grid"
      ? computeGridLayout(collapsed.nodes)
      : computeGroupedTreeLayout(collapsed.nodes, collapsed.connections);
    const alignedCollapsedPositions = mode === "tree"
      ? alignGridSplitTileGroupsWithConfig(collapsedPositions, nodes, collapsed.groups)
      : collapsedPositions;
    const expandedPositions = expandGridSplitTileGroups(alignedCollapsedPositions, collapsed.groups);
    return mode === "tree" ? alignUpscaleResultNodes(expandedPositions, nodes, connections) : expandedPositions;
  }
  if (mode === "grid") {
    return computeGridLayout(nodes);
  }
  return alignUpscaleResultNodes(computeGroupedTreeLayout(nodes, connections), nodes, connections);
}
