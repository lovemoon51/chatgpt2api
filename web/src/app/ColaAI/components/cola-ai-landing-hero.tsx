"use client";

import { ArrowDown } from "lucide-react";
import type { RefObject } from "react";

import { AuthenticatedImage } from "@/components/authenticated-image";
import { cn } from "@/lib/utils";
import { colaButtonClass, colaCardClass } from "./cola-ai-style";
import type { LandingHeroItem, LandingHeroStageState } from "./cola-ai-landing-hero-state";

type ColaAILandingHeroProps = {
  items: LandingHeroItem[];
  stageState: LandingHeroStageState;
  onScrollToDiscover: () => void;
  heroRef?: RefObject<HTMLElement | null>;
};

const orbitCardClasses = [
  "orbit_card first landing-hero__card--orbit-one",
  "orbit_card second landing-hero__card--orbit-two",
  "orbit_card third landing-hero__card--orbit-three",
  "orbit_card fourth landing-hero__card--orbit-four",
];

function LandingHeroCard({
  item,
  role,
  orbitClassName,
}: {
  item: LandingHeroItem;
  role: "primary" | "orbit";
  orbitClassName?: string;
}) {
  return (
    <article
      data-cola-card-role={role}
      data-cola-card-id={item.id}
      className={cn("landing-hero__card overflow-hidden text-left", role === "orbit" ? "" : colaCardClass, orbitClassName)}
    >
      <div className="landing-hero__media relative overflow-hidden bg-black">
        {item.imageUrl ? (
          <AuthenticatedImage
            src={item.imageUrl}
            fallbackSrc={item.imageFallbackUrl}
            alt={item.alt}
            loadingMotion="static"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            data-cola-visual="landing-fallback-art"
            className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.26),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,249,255,0.9)_54%,rgba(236,253,245,0.86))]"
          />
        )}
      </div>
    </article>
  );
}

export function ColaAILandingHero({
  items,
  stageState,
  onScrollToDiscover,
  heroRef,
}: ColaAILandingHeroProps) {
  const [core, ...orbit] = items;

  return (
    <section
      ref={heroRef}
      data-cola-panel="landing-hero"
      data-cola-stage="reference-orbit-hero"
      data-cola-motion="scroll-progress"
      data-cola-state={stageState}
      data-cola-pin-state="before"
      className="landing-hero chapter_evolution relative z-10 px-4 md:pl-[104px] md:pr-8"
    >
      <div className="landing-hero__pin pin_wrapper">
        <div className="landing-hero__stage orbit_stage">
          <div className="landing-hero__copy h1_box">
            <div className="landing-hero__headline-box headline_box">
              <h1
                data-cola-copy="hero-primary-title"
                data-title-variant="primary"
                className="h1 title_h landing-hero__title landing-hero__title--primary"
              >
                接着上次灵感
                <span>继续创作</span>
              </h1>
              <h1
                aria-hidden="true"
                data-cola-copy="hero-secondary-title"
                data-title-variant="secondary"
                className="h1 hero_spec landing-hero__title landing-hero__title--secondary"
              >
                最近作品已就位
                <span>下一张从这里开始</span>
              </h1>
            </div>
            <div className="buttons_hero">
              <button
                type="button"
                data-cola-action="scroll-to-discover"
                className={colaButtonClass("primary", "h-11 px-5")}
                onClick={onScrollToDiscover}
              >
                进入发现页
                <ArrowDown className="size-4" />
              </button>
              <p className="landing-hero__hint">最近 5 张作品先亮相，挑一张继续改图。</p>
            </div>
          </div>

          {core ? (
            <article
              data-cola-card-role="primary"
              data-cola-card-id={core.id}
              data-cola-visual="landing-core-media"
              className="core_video landing-hero__core"
            >
              <div className="landing-hero__media relative h-full w-full overflow-hidden bg-black">
                {core.imageUrl ? (
                  <AuthenticatedImage
                    src={core.imageUrl}
                    fallbackSrc={core.imageFallbackUrl}
                    alt={core.alt}
                    loadingMotion="static"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    data-cola-visual="landing-fallback-art"
                    className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.26),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.95),rgba(240,249,255,0.9)_54%,rgba(236,253,245,0.86))]"
                  />
                )}
              </div>
            </article>
          ) : null}

          {orbit.map((item, index) => (
            <LandingHeroCard
              key={item.id}
              item={item}
              role="orbit"
              orbitClassName={orbitCardClasses[index] || "landing-hero__card--orbit-four"}
            />
          ))}

          <div aria-hidden="true" className="timeline_line landing-hero__timeline-line" />
          <div
            aria-hidden="true"
            data-cola-visual="timeline-ruler"
            className="landing-hero__timeline"
          >
            <div className="landing-hero__timeline-track">
              <div className="landing-hero__timeline-marks">
                {Array.from({ length: 25 }, (_, index) => (
                  <span
                    key={`timeline-mark-${index}`}
                    className={cn("landing-hero__timeline-mark", index % 10 === 0 ? "is-major" : index % 5 === 0 ? "is-medium" : "")}
                  />
                ))}
              </div>
              <div
                data-cola-visual="timeline-cursor-layer"
                className="timeline_cursor-layer landing-hero__timeline-cursor-layer"
              >
                <span className="timeline_cursor-blur landing-hero__timeline-cursor-blur" />
                <span className="timeline_cursor landing-hero__timeline-cursor">
                  <span className="timeline_cursor-head landing-hero__timeline-head" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
