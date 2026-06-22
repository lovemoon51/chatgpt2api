"use client";

import { Boxes, ImagePlus, Type, Video, X, type LucideIcon } from "lucide-react";

import type { CanvasCreatableNodeType, CanvasPoint } from "./canvas-types";

type CanvasConnectionMenuProps = {
  position: CanvasPoint;
  onClose: () => void;
  onSelect: (nodeType: CanvasCreatableNodeType) => void;
};

const menuItems: Array<{
  type: CanvasCreatableNodeType;
  label: string;
  description: string;
  Icon: LucideIcon;
}> = [
  { type: "text", label: "文本生成", description: "补充提示词", Icon: Type },
  { type: "image", label: "图片生成", description: "承接参考图", Icon: ImagePlus },
  { type: "video", label: "视频生成", description: "占位待开发", Icon: Video },
  { type: "config", label: "配置节点", description: "设置模型参数", Icon: Boxes },
];

export function CanvasConnectionMenu({ position, onClose, onSelect }: CanvasConnectionMenuProps) {
  return (
    <section
      data-cola-panel="canvas-connection-menu"
      className="absolute z-50 w-[220px] rounded-[16px] border border-black/5 bg-white/98 p-2 text-slate-950 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.34)]"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold text-slate-500">创建并连接</span>
        <button
          type="button"
          aria-label="关闭节点菜单"
          className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-1">
        {menuItems.map(({ type, label, description, Icon }) => (
          <button
            key={type}
            type="button"
            data-cola-action={`create-connected-${type}-node`}
            className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-violet-50 focus:bg-violet-50 focus:outline-none"
            onClick={() => onSelect(type)}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-white">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900">{label}</span>
              <span className="block truncate text-[11px] text-slate-400">{description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
