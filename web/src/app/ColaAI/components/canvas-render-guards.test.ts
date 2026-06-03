import { describe, expect, test } from "bun:test";

import type { CanvasConnectionData, CanvasNodeData } from "./canvas-types";
import { areCanvasConnectionsPropsEqual, areCanvasNodePropsEqual } from "./canvas-render-guards";

const node: CanvasNodeData = {
  id: "node-1",
  type: "text",
  title: "节点",
  position: { x: 120, y: 80 },
  width: 260,
  height: 160,
  metadata: { content: "hello" },
};

const connection: CanvasConnectionData = {
  id: "connection-1",
  fromNodeId: "node-1",
  toNodeId: "node-2",
};

describe("canvas render guards", () => {
  test("treats viewport-only parent updates as no-op for nodes", () => {
    const noop = () => undefined;

    expect(
      areCanvasNodePropsEqual(
        {
          node,
          selected: false,
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
        {
          node,
          selected: false,
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
      ),
    ).toBe(true);
  });

  test("detects when node selection changes", () => {
    const noop = () => undefined;

    expect(
      areCanvasNodePropsEqual(
        {
          node,
          selected: false,
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
        {
          node,
          selected: true,
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
      ),
    ).toBe(false);
  });

  test("detects when node interaction mode changes", () => {
    const noop = () => undefined;

    expect(
      areCanvasNodePropsEqual(
        {
          node,
          selected: false,
          interactionMode: "pointer",
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
        {
          node,
          selected: false,
          interactionMode: "hand",
          onContentChange: noop,
          onOpenGeneration: noop,
          onPointerDown: noop,
        },
      ),
    ).toBe(false);
  });

  test("treats viewport-only parent updates as no-op for connections", () => {
    const noop = () => undefined;
    const nodes = [node];
    const connections = [connection];

    expect(
      areCanvasConnectionsPropsEqual(
        {
          nodes,
          connections,
          selectedConnectionId: null,
          onSelectConnection: noop,
        },
        {
          nodes,
          connections,
          selectedConnectionId: null,
          onSelectConnection: noop,
        },
      ),
    ).toBe(true);
  });

  test("detects when selected connection changes", () => {
    const noop = () => undefined;
    const nodes = [node];
    const connections = [connection];

    expect(
      areCanvasConnectionsPropsEqual(
        {
          nodes,
          connections,
          selectedConnectionId: null,
          onSelectConnection: noop,
        },
        {
          nodes,
          connections,
          selectedConnectionId: connection.id,
          onSelectConnection: noop,
        },
      ),
    ).toBe(false);
  });
});
