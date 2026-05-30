"use client";

import { useEffect, useRef } from "react";

import type { CanvasGuide, CanvasPoint, CanvasSelectionRect } from "./canvas-types";

const MAX_GUIDE_POOL = 12;

type CanvasGuidesProps = {
  connectionPreview?: {
    from: CanvasPoint;
    to: CanvasPoint;
  } | null;
  selectionRect: CanvasSelectionRect | null;
};

export function renderGuidesToDOM(container: HTMLElement, guides: CanvasGuide[]) {
  const children = container.querySelectorAll<HTMLElement>("[data-cola-guide-slot]");
  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    if (i < guides.length) {
      const guide = guides[i];
      el.style.display = "";
      if (guide.axis === "vertical") {
        el.style.left = `${guide.position}px`;
        el.style.top = `${guide.start}px`;
        el.style.width = "2px";
        el.style.height = `${Math.max(1, guide.end - guide.start)}px`;
        el.style.transform = "translateX(-1px)";
      } else {
        el.style.left = `${guide.start}px`;
        el.style.top = `${guide.position}px`;
        el.style.width = `${Math.max(1, guide.end - guide.start)}px`;
        el.style.height = "2px";
        el.style.transform = "translateY(-1px)";
      }
    } else {
      el.style.display = "none";
    }
  }
}

export function clearGuidesDOM(container: HTMLElement) {
  const children = container.querySelectorAll<HTMLElement>("[data-cola-guide-slot]");
  for (let i = 0; i < children.length; i++) {
    children[i].style.display = "none";
  }
}

export function CanvasGuides({ connectionPreview = null, selectionRect }: CanvasGuidesProps) {
  const guidesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = guidesContainerRef.current;
    if (!container || container.children.length > 0) return;
    for (let i = 0; i < MAX_GUIDE_POOL; i++) {
      const el = document.createElement("div");
      el.setAttribute("data-cola-guide-slot", String(i));
      el.className = "absolute bg-violet-500/80";
      el.style.display = "none";
      container.appendChild(el);
    }
  }, []);

  return (
    <div
      aria-hidden="true"
      data-cola-canvas-layer="interaction-guides"
      className="pointer-events-none absolute left-0 top-0 z-40"
    >
      <div ref={guidesContainerRef} data-cola-guides-container="true" />

      {connectionPreview ? (
        <svg
          data-cola-canvas-connection-preview="true"
          className="absolute overflow-visible"
          style={{
            left: 0,
            top: 0,
            width: 1,
            height: 1,
          }}
        >
          <path
            d={`M ${connectionPreview.from.x} ${connectionPreview.from.y} C ${connectionPreview.from.x + 96} ${connectionPreview.from.y}, ${connectionPreview.to.x - 96} ${connectionPreview.to.y}, ${connectionPreview.to.x} ${connectionPreview.to.y}`}
            fill="none"
            stroke="#7c3aed"
            strokeDasharray="8 8"
            strokeLinecap="round"
            strokeOpacity={0.86}
            strokeWidth={3}
          />
        </svg>
      ) : null}

      {selectionRect ? (
        <div
          data-cola-canvas-selection="marquee"
          className="absolute border border-violet-500/80 bg-violet-400/12"
          style={{
            left: selectionRect.left,
            top: selectionRect.top,
            width: Math.max(1, selectionRect.right - selectionRect.left),
            height: Math.max(1, selectionRect.bottom - selectionRect.top),
          }}
        />
      ) : null}
    </div>
  );
}
