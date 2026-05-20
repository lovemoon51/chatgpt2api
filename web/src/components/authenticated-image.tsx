"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type MouseEventHandler,
} from "react";

import { createImageObjectUrl, shouldFetchImageWithAuth } from "@/lib/image-fetch";
import { cn } from "@/lib/utils";

type AuthenticatedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fallbackSrc?: string;
};

const IMAGE_FETCH_RETRY_DELAYS_MS = [250, 750, 1500, 3000];

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function createImageObjectUrlWithRetry(candidate: string, shouldCancel: () => boolean) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= IMAGE_FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await createImageObjectUrl(candidate);
    } catch (error) {
      lastError = error;
      const delay = IMAGE_FETCH_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || shouldCancel()) {
        break;
      }
      await wait(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("读取图片失败");
}

function ImageLoadingPlaceholder({
  className,
  alt,
  style,
  onClick,
  onDoubleClick,
  title,
}: Pick<AuthenticatedImageProps, "className" | "alt" | "style" | "onClick" | "onDoubleClick" | "title">) {
  const label = typeof alt === "string" && alt ? `${alt} 加载中` : "图片加载中";
  const classNameText = typeof className === "string" ? className : "";
  const hasStableFrame = /(?:^|\s)(?:aspect-|size-|min-h-|h-(?!auto|full)\S+)/.test(classNameText);
  const handleClick: MouseEventHandler<HTMLSpanElement> = (event) => {
    onClick?.(event as unknown as Parameters<NonNullable<typeof onClick>>[0]);
  };
  const handleDoubleClick: MouseEventHandler<HTMLSpanElement> = (event) => {
    onDoubleClick?.(event as unknown as Parameters<NonNullable<typeof onDoubleClick>>[0]);
  };

  return (
    <span
      aria-busy="true"
      aria-label={label}
      className={cn(
        "auth-image-loader relative block overflow-hidden bg-stone-100 text-stone-400 dark:bg-slate-900",
        !hasStableFrame && "aspect-square w-[min(78vw,78vh)]",
        className,
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      role="img"
      style={style}
      title={title}
    >
      <span className="auth-image-loader__mist" aria-hidden="true" />
      <span className="auth-image-loader__grid" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <span key={index} style={{ "--cell-index": index } as CSSProperties} />
        ))}
      </span>
      <span className="auth-image-loader__cursor" aria-hidden="true" />
    </span>
  );
}

export function AuthenticatedImage({ src, fallbackSrc, className, alt, style, ...props }: AuthenticatedImageProps) {
  const candidates = useMemo(
    () => [src, fallbackSrc].filter((item): item is string => Boolean(item)),
    [src, fallbackSrc],
  );
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(() =>
    shouldFetchImageWithAuth(src) ? undefined : src,
  );

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function resolve() {
      for (const candidate of candidates) {
        if (!shouldFetchImageWithAuth(candidate)) {
          if (!cancelled) {
            setResolvedSrc(candidate);
          }
          return;
        }
        try {
          const nextObjectUrl = await createImageObjectUrlWithRetry(candidate, () => cancelled);
          if (cancelled) {
            URL.revokeObjectURL(nextObjectUrl);
            return;
          }
          objectUrl = nextObjectUrl;
          setResolvedSrc(nextObjectUrl);
          return;
        } catch {
          // Try the fallback candidate below.
        }
      }

      if (!cancelled) {
        const plainFallback = candidates.find((candidate) => !shouldFetchImageWithAuth(candidate));
        setResolvedSrc(plainFallback);
      }
    }

    setResolvedSrc(shouldFetchImageWithAuth(src) ? undefined : src);
    void resolve();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [candidates, src]);

  if (!resolvedSrc) {
    return (
      <ImageLoadingPlaceholder
        alt={alt}
        className={className}
        onClick={props.onClick}
        onDoubleClick={props.onDoubleClick}
        style={style}
        title={props.title}
      />
    );
  }

  return <img {...props} src={resolvedSrc} className={className} alt={alt} style={style} />;
}
