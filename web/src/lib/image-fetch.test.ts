import { describe, expect, test } from "bun:test";

import { getPreviewFallbackUrl, getPreferredPreviewUrl } from "./image-fetch";

describe("preview image priority helpers", () => {
  test("prefers original sources for work previews", () => {
    expect(
      getPreferredPreviewUrl(
        {
          signed_url: "https://cdn.example.com/signed.png",
          url: "/images/original.png",
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferOriginal",
      ),
    ).toBe("https://cdn.example.com/signed.png");

    expect(
      getPreferredPreviewUrl(
        {
          url: "/images/original.png",
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferOriginal",
      ),
    ).toBe("/images/original.png");
  });

  test("falls back to thumbnail when original sources are unavailable", () => {
    expect(
      getPreferredPreviewUrl(
        {
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferOriginal",
      ),
    ).toBe("/image-thumbnails/original.png");
  });

  test("prefers thumbnails for template and discovery covers", () => {
    expect(
      getPreferredPreviewUrl(
        {
          url: "/images/original.png",
          signed_url: "https://cdn.example.com/signed.png",
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferThumbnail",
      ),
    ).toBe("/image-thumbnails/original.png");
  });

  test("returns the next-best fallback for the selected preview strategy", () => {
    expect(
      getPreviewFallbackUrl(
        {
          url: "/images/original.png",
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferOriginal",
      ),
    ).toBe("/image-thumbnails/original.png");

    expect(
      getPreviewFallbackUrl(
        {
          url: "/images/original.png",
          thumbnail_url: "/image-thumbnails/original.png",
        },
        "preferThumbnail",
      ),
    ).toBe("/images/original.png");
  });
});
