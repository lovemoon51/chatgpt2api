"use client";

import { cn } from "@/lib/utils";
import type { StoredReferenceImage } from "@/store/image-conversations";

export type ImageReferenceLightboxItem = {
  id: string;
  src: string;
};

type ImageReferencePreviewStripProps = {
  images: StoredReferenceImage[];
  lightboxImages: ImageReferenceLightboxItem[];
  onOpenLightbox: (images: ImageReferenceLightboxItem[], index: number) => void;
  className?: string;
};

export function ImageReferencePreviewStrip({
  images,
  lightboxImages,
  onOpenLightbox,
  className,
}: ImageReferencePreviewStripProps) {
  if (images.length === 0) {
    return null;
  }

  return (
    <div aria-label="被编辑图片" className={cn("flex justify-end pr-3 sm:pr-5", className)}>
      <div className="flex max-w-[min(760px,92%)] flex-wrap justify-end gap-2">
        {images.map((image, index) => (
          <div key={`${image.name || "reference"}-${index}`} className="max-w-[min(48vw,180px)] rounded-[18px] border border-white/85 bg-white/95 p-1.5 shadow-[0_16px_40px_-32px_rgba(15,23,42,0.65)] dark:border-slate-800 dark:bg-slate-900/95">
            <button
              type="button"
              onClick={() => onOpenLightbox(lightboxImages, index)}
              className="group relative block overflow-hidden rounded-[14px] bg-slate-100 dark:bg-slate-800"
              aria-label={`预览被编辑图片 ${image.name || index + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Local data URL previews are not served through Next image optimization. */}
              <img
                src={image.dataUrl}
                alt={image.name || `被编辑图片 ${index + 1}`}
                className="block max-h-28 max-w-[min(42vw,150px)] object-contain transition duration-200 group-hover:brightness-95 sm:max-h-32 sm:max-w-[168px]"
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
