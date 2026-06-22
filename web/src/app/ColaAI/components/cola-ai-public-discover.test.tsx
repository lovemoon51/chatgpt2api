import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ColaAIWorkbench, CreationFeed } from "./cola-ai-workbench";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const workbenchSource = readFileSync(join(testDir, "cola-ai-workbench.tsx"), "utf-8");

const publicSession = {
  key: "",
  role: "guest",
  subjectId: "public-preview",
  name: "ColaAI",
} as const;

describe("ColaAI public discover images", () => {
  test("renders the public discover feed copy in the ColaAI public preview", () => {
    const markup = renderToStaticMarkup(<ColaAIWorkbench session={publicSession} />);

    expect(markup).toContain('data-cola-panel="discover-home"');
    expect(markup).toContain('data-cola-panel="creation-feed"');
    expect(markup).toContain("公共精选");
    expect(markup).toContain("来自 ColaAI 社区");
    expect(markup).not.toContain("来自你的灵感");
  });

  test("uses public discover copy for signed-in users too", () => {
    const markup = renderToStaticMarkup(
      <CreationFeed
        creations={[]}
        isLoading={false}
        isRefreshing={false}
        title="公共精选"
        subtitle="来自 ColaAI 社区"
        onOpen={() => undefined}
        onUsePrompt={() => undefined}
        onCopyPrompt={() => undefined}
      />,
    );

    expect(markup).toContain("公共精选");
    expect(markup).toContain("来自 ColaAI 社区");
    expect(markup).not.toContain("最近创作");
    expect(markup).not.toContain("来自你的灵感");
  });

  test("loads discover images through the public discover API for every session", () => {
    expect(workbenchSource).toContain("fetchPublicDiscoverImages");
    expect(workbenchSource).toContain("setPublicDiscoverImages");
    expect(workbenchSource).toContain("() => publicDiscoverCreations");
    expect(workbenchSource).toContain('title="公共精选"');
    expect(workbenchSource).toContain('subtitle="来自 ColaAI 社区"');
    expect(workbenchSource).not.toContain("isPublicPreview ? publicDiscoverCreations : buildCreations(images)");
  });
});
