import { cn } from "@/lib/utils";

export const colaFocusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

const colaCoolBorderClass = "border border-slate-200/80 ring-1 ring-white/80";
const colaCoolSurfaceClass = "bg-white/86 backdrop-blur-xl";
const colaCoolShadowClass = "shadow-[0_18px_54px_-44px_rgba(15,23,42,0.42)]";
const colaStudioTransitionClass = "transition duration-200";

export const colaShellClass =
  "min-h-dvh bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(240,249,255,0.92)_36%,rgba(236,253,245,0.9)_72%,rgba(248,250,252,0.98)_100%)] text-slate-950";

export const colaPanelClass =
  cn("rounded-[24px]", colaCoolBorderClass, "bg-white/84 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.48)]", "backdrop-blur-xl");

export const colaCardClass =
  cn(
    "rounded-[20px]",
    colaCoolBorderClass,
    "bg-white/82",
    colaCoolShadowClass,
    colaStudioTransitionClass,
    "hover:-translate-y-0.5 hover:bg-white/92 hover:shadow-[0_24px_70px_-52px_rgba(15,23,42,0.54)] active:translate-y-0",
  );

export const colaInputShellClass =
  cn("rounded-[20px]", colaCoolBorderClass, colaCoolSurfaceClass, "shadow-[0_18px_54px_-46px_rgba(15,23,42,0.38)]");

export const colaMutedPanelClass =
  cn("rounded-[18px]", "border border-slate-200/70 ring-1 ring-white/70", "bg-slate-50/80");

type ColaButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function colaButtonClass(variant: ColaButtonVariant = "secondary", className?: string) {
  const base =
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0";

  const variants: Record<ColaButtonVariant, string> = {
    primary:
      "rounded-full bg-slate-950 px-4 py-2.5 text-sm text-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.9)] hover:-translate-y-0.5 hover:bg-slate-800",
    secondary:
      "rounded-full border border-slate-200/80 bg-white/82 px-4 py-2.5 text-sm text-slate-700 shadow-[0_12px_32px_-28px_rgba(15,23,42,0.48)] hover:-translate-y-0.5 hover:border-cyan-200 hover:bg-white hover:text-slate-950",
    ghost:
      "rounded-full bg-transparent px-3 py-2 text-sm text-slate-500 hover:bg-slate-100/80 hover:text-slate-950",
    danger:
      "rounded-full border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 hover:-translate-y-0.5 hover:bg-rose-100",
  };

  return cn(base, colaFocusClass, variants[variant], className);
}

export function colaSurfaceClass(variant: "raised" | "flat" | "overlay" = "raised", className?: string) {
  const variants = {
    raised: colaPanelClass,
    flat: colaMutedPanelClass,
    overlay:
      "rounded-[22px] border border-slate-200/80 bg-white/96 shadow-[0_24px_64px_-42px_rgba(15,23,42,0.54)] ring-1 ring-white/80 backdrop-blur-xl",
  };

  return cn(variants[variant], className);
}
