"use client";

const muxBackgroundSrc =
  "https://player.mux.com/i5P900Vm00u3LKTiYNMB5hSQ33j9jCsYCPslVCm2Cghec?autoplay=muted&muted=true&loop=true&preload=auto&controls=false&metadata-video-title=hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838&video-title=hf_20260302_085640_276ea93b-d7da-4418-a09b-2aa5b490e838";

export function RovaMediaBackground() {
  return (
    <div
      aria-hidden="true"
      data-cola-visual="rova-media-background"
      data-cola-motion="mux-video-background"
      data-cola-background="rova-export-media"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-white"
    >
      <iframe
        title="ColaAI ambient background"
        src={muxBackgroundSrc}
        data-cola-background="mux-hr-saas-video"
        className="absolute left-1/2 -top-[96px] h-[max(938px,calc((100vw+320px)*134/241))] w-[max(1687px,calc(100vw+320px))] min-w-[1687px] max-w-none -translate-x-1/2 rotate-180 scale-x-[-1] border-0 opacity-95 will-change-transform"
        style={{ aspectRatio: "241 / 134" }}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        tabIndex={-1}
      />
      <div
        data-cola-effect="svg-export-fade"
        className="absolute inset-x-0 top-0 h-[894px] bg-[linear-gradient(180deg,rgba(255,255,255,0)_30%,rgba(255,255,255,0.70)_55%,#ffffff_75%)]"
      />
      <div className="absolute inset-x-0 top-[640px] h-[360px] bg-[linear-gradient(180deg,rgba(255,255,255,0),#ffffff_50%)]" />
    </div>
  );
}
