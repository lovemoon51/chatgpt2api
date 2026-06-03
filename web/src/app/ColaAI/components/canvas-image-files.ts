export type CanvasImageFilePayload = {
  imageUrl: string;
  title: string;
  content: string;
};

export function getCanvasImageFile(files: Iterable<File> | ArrayLike<File> | null | undefined) {
  if (!files) {
    return null;
  }

  const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
  return imageFiles[0] ?? null;
}

export async function readCanvasImageFile(file: File): Promise<CanvasImageFilePayload> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }

  const imageUrl = typeof FileReader === "undefined"
    ? await readFileWithArrayBuffer(file)
    : await readFileWithFileReader(file);
  const title = "图片节点";

  return {
    imageUrl,
    title,
    content: `本地图片 ${title}`,
  };
}

function readFileWithFileReader(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("读取图片失败")));
    reader.readAsDataURL(file);
  });
}

async function readFileWithArrayBuffer(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return `data:${file.type || "image/png"};base64,${btoa(binary)}`;
}
