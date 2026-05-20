"use client";

import { useEffect, useMemo, useState, type ImgHTMLAttributes } from "react";

import { createImageObjectUrl, shouldFetchImageWithAuth } from "@/lib/image-fetch";

type AuthenticatedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fallbackSrc?: string;
};

export function AuthenticatedImage({ src, fallbackSrc, ...props }: AuthenticatedImageProps) {
  const candidates = useMemo(
    () => [src, fallbackSrc].filter((item): item is string => Boolean(item)),
    [src, fallbackSrc],
  );
  const [resolvedSrc, setResolvedSrc] = useState(src);

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
          const nextObjectUrl = await createImageObjectUrl(candidate);
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
        setResolvedSrc(src);
      }
    }

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
