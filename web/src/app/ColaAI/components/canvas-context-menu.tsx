"use client";

import { Copy, Pencil, Sparkles, Trash2, Unlink, X } from "lucide-react";
import type { ReactNode } from "react";

import type { CanvasPoint } from "./canvas-types";

type NodeContextMenuProps = {
  kind: "node";
  position: CanvasPoint;
  canGenerate: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDisconnect: () => void;
  onDuplicate: () => void;
  onGenerate: () => void;
  onRename: () => void;
};

type ConnectionContextMenuProps = {
  kind: "connection";
  position: CanvasPoint;
  onClose: () => void;
  onDelete: () => void;
};

type CanvasContextMenuProps = NodeContextMenuProps | ConnectionContextMenuProps;

export function CanvasContextMenu(props: CanvasContextMenuProps) {
  return (
    <section
      data-cola-panel="canvas-context-menu"
      className="absolute z-50 w-[210px] rounded-[14px] border border-black/5 bg-white/98 p-2 text-slate-950 shadow-[0_18px_48px_-28px_rgba(15,23,42,0.34)]"
      style={{ transform: `translate(${props.position.x}px, ${props.position.y}px)` }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold text-slate-500">{props.kind === "node" ? "节点操作" : "连接操作"}</span>
        <button
          type="button"
          aria-label="关闭右键菜单"
          className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={props.onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      {props.kind === "node" ? <NodeContextMenuItems {...props} /> : <ConnectionContextMenuItems {...props} />}
    </section>
  );
}

function NodeContextMenuItems({
  canGenerate,
  onDelete,
  onDisconnect,
  onDuplicate,
  onGenerate,
  onRename,
}: NodeContextMenuProps) {
  return (
    <div className="grid gap-1">
      <MenuButton action="rename-node" label="重命名" onClick={onRename}>
        <Pencil className="size-4" />
      </MenuButton>
      <MenuButton action="duplicate-node" label="复制节点" onClick={onDuplicate}>
        <Copy className="size-4" />
      </MenuButton>
      <MenuButton action="disconnect-node" label="断开连接" onClick={onDisconnect}>
        <Unlink className="size-4" />
      </MenuButton>
      <MenuButton action="context-generate-node" label="基于节点继续生成" disabled={!canGenerate} onClick={onGenerate}>
        <Sparkles className="size-4" />
      </MenuButton>
      <MenuButton action="delete-node" label="删除节点" danger onClick={onDelete}>
        <Trash2 className="size-4" />
      </MenuButton>
    </div>
  );
}

function ConnectionContextMenuItems({ onDelete }: ConnectionContextMenuProps) {
  return (
    <div className="grid gap-1">
      <MenuButton action="delete-connection" label="删除连接" danger onClick={onDelete}>
        <Trash2 className="size-4" />
      </MenuButton>
    </div>
  );
}

function MenuButton({
  action,
  children,
  danger = false,
  disabled = false,
  label,
  onClick,
}: {
  action: string;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-cola-action={action}
      className={`flex min-h-10 w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm font-semibold transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-rose-600 hover:bg-rose-50 focus:bg-rose-50"
          : "text-slate-800 hover:bg-violet-50 focus:bg-violet-50"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={danger ? "text-rose-500" : "text-slate-500"}>{children}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
