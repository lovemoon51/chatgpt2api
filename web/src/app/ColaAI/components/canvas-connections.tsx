"use client";

import { memo, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import { computeCanvasConnectionPath } from "./canvas-connection-paths";
import { areCanvasConnectionsPropsEqual } from "./canvas-render-guards";
import type { CanvasConnectionData, CanvasNodeData } from "./canvas-types";

type CanvasLayerBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type CanvasConnectionsProps = {
  bounds: CanvasLayerBounds;
  nodes: CanvasNodeData[];
  connections: CanvasConnectionData[];
  selectedConnectionId: string | null;
  onConnectionContextMenu?: (connectionId: string, event: ReactMouseEvent<SVGPathElement>) => void;
  onSelectConnection: (connectionId: string) => void;
};

function CanvasConnectionsComponent({
  bounds,
  nodes,
  connections,
  selectedConnectionId,
  onConnectionContextMenu,
  onSelectConnection,
}: CanvasConnectionsProps) {
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);

  return (
    <svg
      aria-hidden="true"
      data-cola-canvas-layer="connections"
      className="pointer-events-none absolute overflow-visible"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
      viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`}
    >
      {connections.map((connection) => {
        const from = nodesById.get(connection.fromNodeId);
        const to = nodesById.get(connection.toNodeId);
        if (!from || !to) {
          return null;
        }

        const selected = selectedConnectionId === connection.id;
        const path = computeCanvasConnectionPath(from, to);

        return (
          <g
            key={connection.id}
            data-cola-state={selected ? "selected-connection" : "idle-connection"}
          >
            <path
              data-connection-id={connection.id}
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="18"
              className="pointer-events-stroke cursor-pointer"
              style={{ pointerEvents: "stroke" }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectConnection(connection.id);
              }}
              onContextMenu={(event) => onConnectionContextMenu?.(connection.id, event)}
            />
            <path
              data-connection-id={connection.id}
              d={path}
              fill="none"
              stroke={selected ? "#7c3aed" : "#a78bfa"}
              strokeDasharray={selected ? "0" : "7 9"}
              strokeLinecap="round"
              strokeOpacity={selected ? 0.95 : 0.74}
              strokeWidth={selected ? 3 : 2}
              className="pointer-events-none"
            />
          </g>
        );
      })}
    </svg>
  );
}

export const CanvasConnections = memo(CanvasConnectionsComponent, areCanvasConnectionsPropsEqual);

CanvasConnections.displayName = "CanvasConnections";
