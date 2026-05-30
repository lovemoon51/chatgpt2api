import { describe, expect, test } from "bun:test";

import { getCanvasImageFile, readCanvasImageFile } from "./canvas-image-files";

describe("canvas image file helpers", () => {
  test("reads image files as data URLs with node metadata", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "reference.png", { type: "image/png" });
    const result = await readCanvasImageFile(file);

    expect(result.imageUrl).toBe("data:image/png;base64,AQID");
    expect(result.title).toBe("reference.png");
    expect(result.content).toBe("本地图片 reference.png");
  });

  test("picks the first image file from a file list", () => {
    const textFile = new File(["hello"], "notes.txt", { type: "text/plain" });
    const imageFile = new File([new Uint8Array([4, 5])], "photo.jpeg", { type: "image/jpeg" });

    expect(getCanvasImageFile([textFile, imageFile])).toBe(imageFile);
    expect(getCanvasImageFile([textFile])).toBeNull();
  });
});
