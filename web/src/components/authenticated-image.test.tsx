import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthenticatedImage } from "./authenticated-image";

describe("AuthenticatedImage", () => {
  test("can render a static loading placeholder for dense image grids", () => {
    const markup = renderToStaticMarkup(
      <AuthenticatedImage
        src="http://localhost/images/protected-preview.png"
        alt="Protected preview"
        loadingMotion="static"
        className="size-32"
      />,
    );

    expect(markup).toContain('data-auth-image-motion="static"');
    expect(markup).not.toContain("auth-image-loader__mist");
    expect(markup).not.toContain("auth-image-loader__cursor");
  });
});
