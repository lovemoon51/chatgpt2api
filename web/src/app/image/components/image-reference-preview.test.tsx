import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ImageReferencePreviewStrip } from "./image-reference-preview";

const referenceImage = {
  name: "source.png",
  type: "image/png",
  dataUrl: "data:image/png;base64,AAAA",
};

describe("ImageReferencePreviewStrip", () => {
  test("renders compact right-aligned proportional previews for edit turns", () => {
    const markup = renderToStaticMarkup(
      <ImageReferencePreviewStrip
        images={[referenceImage]}
        lightboxImages={[{ id: "reference-1", src: referenceImage.dataUrl }]}
        onOpenLightbox={() => undefined}
      />,
    );

    expect(markup).toContain("aria-label=\"被编辑图片\"");
    expect(markup).toContain("justify-end");
    expect(markup).toContain("object-contain");
    expect(markup).toContain("max-h-28");
    expect(markup).not.toContain("object-cover");
    expect(markup).not.toContain("加入编辑");
  });
});
