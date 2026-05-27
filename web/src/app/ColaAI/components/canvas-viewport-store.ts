"use client";

import { useSyncExternalStore } from "react";

import type { CanvasViewport } from "./canvas-types";

const minZoom = 0.12;
const maxZoom = 4;
const defaultViewport: CanvasViewport = { x: 0, y: 0, k: 1 };

let currentViewport: CanvasViewport = defaultViewport;
const listeners = new Set<() => void>();

export function getCanvasViewport(): CanvasViewport {
  return currentViewport;
}

export function setCanvasViewport(viewport: CanvasViewport): void {
  const k = Math.min(maxZoom, Math.max(minZoom, viewport.k));
  if (
    currentViewport.x === viewport.x &&
    currentViewport.y === viewport.y &&
    currentViewport.k === k
  ) {
    return;
  }
  currentViewport = { x: viewport.x, y: viewport.y, k };
  listeners.forEach((listener) => listener());
}

export function subscribeCanvasViewport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCanvasViewport(): void {
  currentViewport = defaultViewport;
  listeners.clear();
}

export function useCanvasViewport(): CanvasViewport {
  return useSyncExternalStore(
    subscribeCanvasViewport,
    getCanvasViewport,
    getCanvasViewport,
  );
}
