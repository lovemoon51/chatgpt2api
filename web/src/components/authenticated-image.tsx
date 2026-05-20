"use client";

import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";

import { createImageObjectUrl, shouldFetchImageWithAuth } from "@/lib/image-fetch";

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

export function AuthenticatedImage({ src, fallbackSrc, ...props }: AuthenticatedImageProps) {
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

  return <img {...props} src={resolvedSrc} />;
}
