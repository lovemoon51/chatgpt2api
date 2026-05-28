"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";

import { CanvasConnections } from "./canvas-connections";
import { CanvasConnectionMenu } from "./canvas-connection-menu";
import { computeCanvasConnectionPath } from "./canvas-connection-paths";
import { CanvasContextMenu } from "./canvas-context-menu";
import { findNearestConnectorHandle, type CanvasConnectorHandle } from "./canvas-connectors";
import { CanvasGuides } from "./canvas-guides";
import { getCanvasImageFile } from "./canvas-image-files";
import { CanvasNode } from "./canvas-node";
import { createSelectionRect, getNodesInSelectionRect } from "./canvas-selection";
import { getSnappedDelta } from "./canvas-snapping";
import { getCanvasLayerBounds, getVisibleCanvasConnections, getVisibleCanvasNodes } from "./canvas-visibility";
import { getCanvasViewport, setCanvasViewport, subscribeCanvasViewport } from "./canvas-viewport-store";
import type { CanvasCreatableNodeType, CanvasGuide, CanvasPoint, CanvasSelectionRect, CanvasState, CanvasViewport } from "./canvas-types";

type InfiniteCanvasSurfaceProps = {
  state: CanvasState;
  onAddConnectedNode: (fromNodeId: string, nodeType: CanvasCreatableNodeType, position: CanvasPoint) => void;
  onAddConnection: (fromNodeId: string, toNodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
  onDeleteSelected: () => void;
  onDisconnectNode: (nodeId: string) => void;
  onDuplicateSelectedNodes: () => void;
  onFinalizeHistoryBatch: () => void;
  onImageFileDrop: (file: File, position: CanvasPoint, targetNodeId?: string) => void;
  onMoveNode: (nodeId: string, position: CanvasPoint) => void;
  onMoveNodes: (positions: Record<string, CanvasPoint>) => void;
  onNudgeSelectedNodes: (delta: CanvasPoint) => void;
  onOpenGeneration: (nodeId: string) => void;
  onRedo: () => void;
  onRenameNode: (nodeId: string, title: string) => void;
  onRetryGeneration: (nodeId: string) => void;
  onSelectAllNodes: () => void;
  onSelectConnection: (connectionId: string | null) => void;
  onSelectNode: (nodeId: string | null) => void;
  onSelectNodes: (nodeIds: string[]) => void;
  onToggleNodeSelection: (nodeId: string) => void;
  onUndo: () => void;
  onViewportChange: (viewport: CanvasViewport) => void;
};

type DragState =
  | {
      type: "canvas";
      startX: number;
      startY: number;
      initialViewport: CanvasViewport;
      moved: boolean;
    }
  | {
      type: "node";
      nodeIds: string[];
      startX: number;
      startY: number;
      initialPositions: Record<string, CanvasPoint>;
      movingNodes: CanvasState["nodes"];
      stationaryNodes: CanvasState["nodes"];
      nodeElements: Map<string, HTMLElement>;
      affectedConnections: Array<{
        element: SVGPathElement;
        hitElement: SVGPathElement;
        from: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
        to: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
      }>;
      lastPositions: Record<string, CanvasPoint>;
    }
  | {
      type: "selection";
      startX: number;
      startY: number;
      startWorld: CanvasPoint;
      moved: boolean;
    }
  | {
      type: "connection";
      fromNodeId: string;
      from: CanvasPoint;
      to: CanvasPoint;
    };

type ConnectionMenuState = {
  fromNodeId: string;
  screenPosition: CanvasPoint;
  worldPosition: CanvasPoint;
};

type CanvasContextMenuState =
  | {
      kind: "node";
      nodeId: string;
      position: CanvasPoint;
    }
  | {
      kind: "connection";
      connectionId: string;
      position: CanvasPoint;
    };

const snapThreshold = 8;
const connectorHitRadius = 22;

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input,textarea,select,[contenteditable='true']"));
}

function getWorldPoint(event: Pick<PointerEvent | ReactPointerEvent, "clientX" | "clientY">, rect: DOMRect, viewport: CanvasViewport) {
  return {
    x: (event.clientX - rect.left - viewport.x) / viewport.k,
    y: (event.clientY - rect.top - viewport.y) / viewport.k,
  };
}

function getNodePositions(nodes: CanvasState["nodes"]) {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}

function getConnectorHandles() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-cola-canvas-handle][data-node-id]")).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      nodeId: element.dataset.nodeId || "",
      kind: element.dataset.colaCanvasHandle === "output" ? "output" : "input",
      center: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    } satisfies CanvasConnectorHandle;
  }).filter((handle) => handle.nodeId);
}

export function InfiniteCanvasSurface({
  state,
  onAddConnectedNode,
  onAddConnection,
  onContentChange,
  onDeleteSelected,
  onDisconnectNode,
  onDuplicateSelectedNodes,
  onFinalizeHistoryBatch,
  onImageFileDrop,
  onMoveNodes,
  onNudgeSelectedNodes,
  onOpenGeneration,
  onRedo,
  onRenameNode,
  onRetryGeneration,
  onSelectAllNodes,
  onSelectConnection,
  onSelectNode,
  onSelectNodes,
  onToggleNodeSelection,
  onUndo,
  onViewportChange,
}: InfiniteCanvasSurfaceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const transformContainerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });
  const [selectionRect, setSelectionRect] = useState<CanvasSelectionRect | null>(null);
  const [guides, setGuides] = useState<CanvasGuide[]>([]);
  const [connectionPreview, setConnectionPreview] = useState<{ from: CanvasPoint; to: CanvasPoint } | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<ConnectionMenuState | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenuState | null>(null);
  const addConnectedNodeRef = useRef(onAddConnectedNode);
  const addConnectionRef = useRef(onAddConnection);
  const nodesRef = useRef(state.nodes);
  const selectedConnectionIdRef = useRef(state.selectedConnectionId);
  const selectedNodeIdsRef = useRef(state.selectedNodeIds);
  const viewportRef = useRef(getCanvasViewport());
  const deleteSelectedRef = useRef(onDeleteSelected);
  const disconnectNodeRef = useRef(onDisconnectNode);
  const duplicateSelectedNodesRef = useRef(onDuplicateSelectedNodes);
  const finalizeHistoryBatchRef = useRef(onFinalizeHistoryBatch);
  const imageFileDropRef = useRef(onImageFileDrop);
  const moveNodesRef = useRef(onMoveNodes);
  const nudgeSelectedNodesRef = useRef(onNudgeSelectedNodes);
  const openGenerationRef = useRef(onOpenGeneration);
  const redoRef = useRef(onRedo);
  const renameNodeRef = useRef(onRenameNode);
  const retryGenerationRef = useRef(onRetryGeneration);
  const selectAllNodesRef = useRef(onSelectAllNodes);
  const selectConnectionRef = useRef(onSelectConnection);
  const selectNodeRef = useRef(onSelectNode);
  const selectNodesRef = useRef(onSelectNodes);
  const toggleNodeSelectionRef = useRef(onToggleNodeSelection);
  const undoRef = useRef(onUndo);
  const viewportChangeRef = useRef(onViewportChange);

  useEffect(() => {
    const sync = () => {
      viewportRef.current = getCanvasViewport();
      if (transformContainerRef.current) {
        const v = viewportRef.current;
        transformContainerRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
      }
    };
    sync();
    return subscribeCanvasViewport(sync);
  }, []);

  useEffect(() => {
    nodesRef.current = state.nodes;
    selectedConnectionIdRef.current = state.selectedConnectionId;
    selectedNodeIdsRef.current = state.selectedNodeIds;
  }, [state.nodes, state.selectedConnectionId, state.selectedNodeIds]);

  useEffect(() => {
    addConnectedNodeRef.current = onAddConnectedNode;
    addConnectionRef.current = onAddConnection;
    deleteSelectedRef.current = onDeleteSelected;
    disconnectNodeRef.current = onDisconnectNode;
    duplicateSelectedNodesRef.current = onDuplicateSelectedNodes;
    finalizeHistoryBatchRef.current = onFinalizeHistoryBatch;
    imageFileDropRef.current = onImageFileDrop;
    moveNodesRef.current = onMoveNodes;
    nudgeSelectedNodesRef.current = onNudgeSelectedNodes;
    openGenerationRef.current = onOpenGeneration;
    redoRef.current = onRedo;
    renameNodeRef.current = onRenameNode;
    retryGenerationRef.current = onRetryGeneration;
    selectAllNodesRef.current = onSelectAllNodes;
    selectConnectionRef.current = onSelectConnection;
    selectNodeRef.current = onSelectNode;
    selectNodesRef.current = onSelectNodes;
    toggleNodeSelectionRef.current = onToggleNodeSelection;
    undoRef.current = onUndo;
    viewportChangeRef.current = onViewportChange;
  }, [
    onAddConnectedNode,
    onAddConnection,
    onDeleteSelected,
    onDisconnectNode,
    onDuplicateSelectedNodes,
    onFinalizeHistoryBatch,
    onImageFileDrop,
    onMoveNodes,
    onNudgeSelectedNodes,
    onOpenGeneration,
    onRedo,
    onRenameNode,
    onRetryGeneration,
    onSelectAllNodes,
    onSelectConnection,
    onSelectNode,
    onSelectNodes,
    onToggleNodeSelection,
    onUndo,
    onViewportChange,
  ]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      if (drag.type === "canvas") {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        drag.moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
        setCanvasViewport({
          x: drag.initialViewport.x + dx,
          y: drag.initialViewport.y + dy,
          k: drag.initialViewport.k,
        });
        return;
      }

      if (drag.type === "selection") {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        const endWorld = getWorldPoint(event, rect, viewportRef.current);
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        drag.moved = drag.moved || Math.abs(dx) > 2 || Math.abs(dy) > 2;
        setSelectionRect(createSelectionRect(drag.startWorld, endWorld));
        return;
      }

      if (drag.type === "connection") {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        const to = getWorldPoint(event, rect, viewportRef.current);
        drag.to = to;
        setConnectionPreview({ from: drag.from, to });
        return;
      }

      const rawDelta = {
        x: (event.clientX - drag.startX) / viewportRef.current.k,
        y: (event.clientY - drag.startY) / viewportRef.current.k,
      };
      const snapped = getSnappedDelta({
        movingNodes: drag.movingNodes,
        stationaryNodes: drag.stationaryNodes,
        delta: rawDelta,
        threshold: snapThreshold / viewportRef.current.k,
      });

      drag.lastPositions = Object.fromEntries(
        drag.nodeIds.map((nodeId) => {
          const initial = drag.initialPositions[nodeId];
          return [nodeId, { x: initial.x + snapped.delta.x, y: initial.y + snapped.delta.y }];
        }),
      );

      drag.nodeIds.forEach((nodeId) => {
        const el = drag.nodeElements.get(nodeId);
        const pos = drag.lastPositions[nodeId];
        if (el && pos) {
          el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        }
      });

      drag.affectedConnections.forEach((conn) => {
        const fromPos = drag.lastPositions[conn.from.nodeId] ?? conn.from.basePosition;
        const toPos = drag.lastPositions[conn.to.nodeId] ?? conn.to.basePosition;
        const d = computeCanvasConnectionPath(
          { position: fromPos, width: conn.from.width, height: conn.from.height },
          { position: toPos, width: conn.to.width, height: conn.to.height },
        );
        conn.element.setAttribute("d", d);
        conn.hitElement.setAttribute("d", d);
      });

      setGuides(snapped.guides);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag?.type === "canvas") {
        viewportChangeRef.current(getCanvasViewport());
      }
      if (drag?.type === "node") {
        drag.nodeElements.forEach((el) => {
          el.removeAttribute("data-cola-dragging");
          el.style.willChange = "";
        });
        const movedNodeIds = drag.nodeIds.filter((id) => {
          const initial = drag.initialPositions[id];
          const last = drag.lastPositions[id];
          return last && (initial.x !== last.x || initial.y !== last.y);
        });
        if (movedNodeIds.length > 0) {
          const finalPositions = Object.fromEntries(
            movedNodeIds.map((id) => [id, drag!.lastPositions[id]]),
          );
          moveNodesRef.current(finalPositions);
        }
        finalizeHistoryBatchRef.current();
        setGuides([]);
      }
      if (drag?.type === "selection") {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && drag.moved) {
          const endWorld = getWorldPoint(event, rect, viewportRef.current);
          const finalRect = createSelectionRect(drag.startWorld, endWorld);
          selectNodesRef.current(getNodesInSelectionRect(nodesRef.current, finalRect));
        }
        setSelectionRect(null);
      }
      if (drag?.type === "connection") {
        const rect = containerRef.current?.getBoundingClientRect();
        const inputHandle = findNearestConnectorHandle(
          getConnectorHandles(),
          { x: event.clientX, y: event.clientY },
          {
            excludeNodeId: drag.fromNodeId,
            kind: "input",
            radius: connectorHitRadius,
          },
        );
        const toNodeId = inputHandle?.nodeId;
        if (toNodeId && toNodeId !== drag.fromNodeId) {
          addConnectionRef.current(drag.fromNodeId, toNodeId);
        } else {
          setConnectionMenu({
            fromNodeId: drag.fromNodeId,
            screenPosition: rect
              ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
              : { x: event.clientX, y: event.clientY },
            worldPosition: drag.to,
          });
        }
        setConnectionPreview(null);
      }
      if (drag?.type === "canvas" && !drag.moved) {
        selectNodeRef.current(null);
        selectConnectionRef.current(null);
      }
      dragRef.current = null;
      document.body.style.cursor = "default";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        const drag = dragRef.current;
        if (drag?.type === "node") {
          drag.nodeIds.forEach((id) => {
            const el = drag.nodeElements.get(id);
            const initial = drag.initialPositions[id];
            if (el && initial) {
              el.style.transform = `translate(${initial.x}px, ${initial.y}px)`;
            }
            el?.removeAttribute("data-cola-dragging");
            if (el) el.style.willChange = "";
          });
          drag.affectedConnections.forEach((conn) => {
            const d = computeCanvasConnectionPath(
              { position: conn.from.basePosition, width: conn.from.width, height: conn.from.height },
              { position: conn.to.basePosition, width: conn.to.width, height: conn.to.height },
            );
            conn.element.setAttribute("d", d);
            conn.hitElement.setAttribute("d", d);
          });
        }
        dragRef.current = null;
        setGuides([]);
        setSelectionRect(null);
        setConnectionPreview(null);
        setConnectionMenu(null);
        setContextMenu(null);
        document.body.style.cursor = "default";
        selectNodeRef.current(null);
        selectConnectionRef.current(null);
        finalizeHistoryBatchRef.current();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setConnectionMenu(null);
        setContextMenu(null);
        if (event.shiftKey) {
          redoRef.current();
        } else {
          undoRef.current();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        setConnectionMenu(null);
        setContextMenu(null);
        redoRef.current();
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedNodeIdsRef.current.length > 0 || selectedConnectionIdRef.current) {
          event.preventDefault();
          deleteSelectedRef.current();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllNodesRef.current();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        if (selectedNodeIdsRef.current.length > 0) {
          event.preventDefault();
          duplicateSelectedNodesRef.current();
        }
        return;
      }

      const nudgeStep = event.shiftKey ? 10 : 1;
      const deltas: Record<string, CanvasPoint> = {
        ArrowDown: { x: 0, y: nudgeStep },
        ArrowLeft: { x: -nudgeStep, y: 0 },
        ArrowRight: { x: nudgeStep, y: 0 },
        ArrowUp: { x: 0, y: -nudgeStep },
      };
      const delta = deltas[event.key];
      if (delta && selectedNodeIdsRef.current.length > 0) {
        event.preventDefault();
        nudgeSelectedNodesRef.current(delta);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const preventDocumentScroll = (event: globalThis.WheelEvent) => event.preventDefault();
    container.addEventListener("wheel", preventDocumentScroll, { passive: false });
    return () => container.removeEventListener("wheel", preventDocumentScroll);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      setSurfaceSize((current) => (
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height }
      ));
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const pinnedNodeIds = useMemo(() => {
    const ids = new Set<string>(state.selectedNodeIds);

    if (state.selectedConnectionId) {
      const selectedConnection = state.connections.find((connection) => connection.id === state.selectedConnectionId);
      if (selectedConnection) {
        ids.add(selectedConnection.fromNodeId);
        ids.add(selectedConnection.toNodeId);
      }
    }

    return Array.from(ids);
  }, [state.connections, state.selectedConnectionId, state.selectedNodeIds]);

  const visibleNodes = useMemo(
    () => getVisibleCanvasNodes(state.nodes, state.viewport, surfaceSize, 280, pinnedNodeIds),
    [pinnedNodeIds, state.nodes, state.viewport, surfaceSize],
  );

  const visibleConnections = useMemo(
    () => getVisibleCanvasConnections(state.connections, visibleNodes),
    [state.connections, visibleNodes],
  );

  const canvasLayerBounds = useMemo(
    () => getCanvasLayerBounds(visibleNodes, 160),
    [visibleNodes],
  );

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const current = getCanvasViewport();
    const factor = Math.pow(1.1, -event.deltaY / 100);
    const nextK = Math.min(4, Math.max(0.12, current.k * factor));
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - current.x) / current.k;
    const worldY = (mouseY - current.y) / current.k;

    const next = {
      x: mouseX - worldX * nextK,
      y: mouseY - worldY * nextK,
      k: nextK,
    };
    setCanvasViewport(next);
    onViewportChange(next);
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-node-id],[data-connection-id],button,textarea,input,select")) {
      return;
    }

    setConnectionMenu(null);
    setContextMenu(null);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.shiftKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const startWorld = getWorldPoint(event, rect, viewportRef.current);
      dragRef.current = {
        type: "selection",
        startX: event.clientX,
        startY: event.clientY,
        startWorld,
        moved: false,
      };
      setSelectionRect(createSelectionRect(startWorld, startWorld));
      document.body.style.cursor = "crosshair";
      return;
    }

    dragRef.current = {
      type: "canvas",
      startX: event.clientX,
      startY: event.clientY,
      initialViewport: getCanvasViewport(),
      moved: false,
    };
    document.body.style.cursor = "grabbing";
  }

  function isImageFileDrag(event: ReactDragEvent<HTMLDivElement>) {
    return Boolean(
      getCanvasImageFile(event.dataTransfer.files) ||
      Array.from(event.dataTransfer.types).includes("Files"),
    );
  }

  function handleCanvasDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!isImageFileDrag(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: ReactDragEvent<HTMLDivElement>) {
    const file = getCanvasImageFile(event.dataTransfer.files);
    if (!file) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = event.target instanceof Element ? event.target : null;
    const targetNodeId = target?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
    const targetNode = targetNodeId
      ? nodesRef.current.find((node) => node.id === targetNodeId && (node.type === "image" || node.type === "generation"))
      : null;

    imageFileDropRef.current(
      file,
      getWorldPoint(event, rect, viewportRef.current),
      targetNode?.id,
    );
  }

  function handleNodePointerDown(event: ReactPointerEvent<HTMLElement>, nodeId: string) {
    if (event.button !== 0) {
      return;
    }

    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    event.stopPropagation();
    setConnectionMenu(null);
    setContextMenu(null);

    if (event.shiftKey) {
      toggleNodeSelectionRef.current(nodeId);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const wasAlreadySelected = selectedNodeIdsRef.current.includes(nodeId);
    const selectedNodeIds = wasAlreadySelected && selectedNodeIdsRef.current.length > 0
      ? selectedNodeIdsRef.current
      : [nodeId];
    const selectedNodeIdSet = new Set(selectedNodeIds);
    const movingNodes = nodesRef.current.filter((item) => selectedNodeIdSet.has(item.id));

    if (!wasAlreadySelected || selectedNodeIdsRef.current.length === 0) {
      selectNodeRef.current(nodeId);
    }

    const nodeElements = new Map<string, HTMLElement>();
    selectedNodeIds.forEach((id) => {
      const el = document.querySelector<HTMLElement>(`article[data-node-id="${id}"]`);
      if (el) {
        nodeElements.set(id, el);
        el.setAttribute("data-cola-dragging", "true");
        el.style.willChange = "transform";
      }
    });

    const movingNodeIdSet2 = new Set(selectedNodeIds);
    const nodesById = new Map(nodesRef.current.map((n) => [n.id, n]));
    const affectedConnections: Array<{
      element: SVGPathElement;
      hitElement: SVGPathElement;
      from: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
      to: { nodeId: string; width: number; height: number; basePosition: CanvasPoint };
    }> = [];
    state.connections.forEach((connection) => {
      const fromNode = nodesById.get(connection.fromNodeId);
      const toNode = nodesById.get(connection.toNodeId);
      if (!fromNode || !toNode) return;
      if (!movingNodeIdSet2.has(connection.fromNodeId) && !movingNodeIdSet2.has(connection.toNodeId)) return;
      const paths = document.querySelectorAll<SVGPathElement>(
        `[data-connection-id="${connection.id}"]`,
      );
      const hitElement = paths[0];
      const visibleElement = (paths[1] ?? paths[0]) as SVGPathElement | undefined;
      if (!hitElement || !visibleElement) return;
      affectedConnections.push({
        element: visibleElement,
        hitElement,
        from: {
          nodeId: fromNode.id,
          width: fromNode.width,
          height: fromNode.height,
          basePosition: fromNode.position,
        },
        to: {
          nodeId: toNode.id,
          width: toNode.width,
          height: toNode.height,
          basePosition: toNode.position,
        },
      });
    });

    dragRef.current = {
      type: "node",
      nodeIds: selectedNodeIds,
      startX: event.clientX,
      startY: event.clientY,
      initialPositions: getNodePositions(movingNodes),
      movingNodes,
      stationaryNodes: nodesRef.current.filter((item) => !selectedNodeIdSet.has(item.id)),
      nodeElements,
      affectedConnections,
      lastPositions: getNodePositions(movingNodes),
    };
    document.body.style.cursor = "grabbing";
  }

  function handleConnectionStart(event: ReactPointerEvent<HTMLElement>, nodeId: string) {
    if (event.button !== 0) {
      return;
    }

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setConnectionMenu(null);
    setContextMenu(null);
    const from = getWorldPoint(event, rect, viewportRef.current);
    dragRef.current = {
      type: "connection",
      fromNodeId: nodeId,
      from,
      to: from,
    };
    setConnectionPreview({ from, to: from });
    document.body.style.cursor = "crosshair";
  }

  function getSurfacePosition(event: Pick<ReactMouseEvent, "clientX" | "clientY">) {
    const rect = containerRef.current?.getBoundingClientRect();
    return rect
      ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
      : { x: event.clientX, y: event.clientY };
  }

  function handleNodeContextMenu(event: ReactMouseEvent<HTMLElement>, nodeId: string) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setConnectionMenu(null);
    setConnectionPreview(null);
    setGuides([]);
    setSelectionRect(null);
    selectNodeRef.current(nodeId);
    setContextMenu({
      kind: "node",
      nodeId,
      position: getSurfacePosition(event),
    });
  }

  function handleConnectionContextMenu(connectionId: string, event: ReactMouseEvent<SVGPathElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    setConnectionMenu(null);
    setConnectionPreview(null);
    setGuides([]);
    setSelectionRect(null);
    selectConnectionRef.current(connectionId);
    setContextMenu({
      kind: "connection",
      connectionId,
      position: getSurfacePosition(event),
    });
  }

  function handleRenameNode(nodeId: string) {
    const node = nodesRef.current.find((item) => item.id === nodeId);
    if (!node) {
      setContextMenu(null);
      return;
    }

    const nextTitle = window.prompt("重命名节点", node.title);
    if (nextTitle !== null) {
      renameNodeRef.current(nodeId, nextTitle);
    }
    setContextMenu(null);
  }

  return (
    <div
      ref={containerRef}
      data-cola-canvas-layer="surface"
      data-cola-drop-target="canvas-image-file"
      className="absolute inset-0 cursor-grab overflow-hidden"
      onDragOver={handleCanvasDragOver}
      onDrop={handleCanvasDrop}
      onPointerDown={handleCanvasPointerDown}
      onWheel={handleWheel}
    >
      <div
        ref={transformContainerRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${getCanvasViewport().x}px, ${getCanvasViewport().y}px) scale(${getCanvasViewport().k})`,
          willChange: "transform",
        }}
      >
        <CanvasConnections
          bounds={canvasLayerBounds}
          nodes={visibleNodes}
          connections={visibleConnections}
          selectedConnectionId={state.selectedConnectionId}
          onConnectionContextMenu={handleConnectionContextMenu}
          onSelectConnection={onSelectConnection}
        />
        {visibleNodes.map((node) => (
          <CanvasNode
            key={node.id}
            node={node}
            selected={state.selectedNodeIds.includes(node.id)}
            onConnectionStart={handleConnectionStart}
            onContentChange={onContentChange}
            onContextMenu={handleNodeContextMenu}
            onOpenGeneration={onOpenGeneration}
            onPointerDown={handleNodePointerDown}
            onRetryGeneration={(nodeId) => retryGenerationRef.current(nodeId)}
          />
        ))}
        <CanvasGuides connectionPreview={connectionPreview} guides={guides} selectionRect={selectionRect} />
      </div>
      {connectionMenu ? (
        <CanvasConnectionMenu
          position={connectionMenu.screenPosition}
          onClose={() => setConnectionMenu(null)}
          onSelect={(nodeType) => {
            addConnectedNodeRef.current(connectionMenu.fromNodeId, nodeType, connectionMenu.worldPosition);
            setConnectionMenu(null);
          }}
        />
      ) : null}
      {contextMenu?.kind === "node" ? (
        <CanvasContextMenu
          kind="node"
          position={contextMenu.position}
          canGenerate={Boolean(state.nodes.find((node) => node.id === contextMenu.nodeId && ["image", "config", "generation"].includes(node.type)))}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            selectNodeRef.current(contextMenu.nodeId);
            deleteSelectedRef.current();
            setContextMenu(null);
          }}
          onDisconnect={() => {
            disconnectNodeRef.current(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onDuplicate={() => {
            selectNodeRef.current(contextMenu.nodeId);
            duplicateSelectedNodesRef.current();
            setContextMenu(null);
          }}
          onGenerate={() => {
            openGenerationRef.current(contextMenu.nodeId);
            setContextMenu(null);
          }}
          onRename={() => handleRenameNode(contextMenu.nodeId)}
        />
      ) : null}
      {contextMenu?.kind === "connection" ? (
        <CanvasContextMenu
          kind="connection"
          position={contextMenu.position}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            selectConnectionRef.current(contextMenu.connectionId);
            deleteSelectedRef.current();
            setContextMenu(null);
          }}
        />
      ) : null}
    </div>
  );
}
