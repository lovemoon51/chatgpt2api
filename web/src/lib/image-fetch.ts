"use client";

import webConfig from "@/constants/common-env";
import { getStoredAuthKey } from "@/store/auth";

function appendUnique(items: string[], value: string) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function getApiBaseUrl() {
  const configured = webConfig.apiUrl.replace(/\/$/, "");
  if (configured) {
    return configured;
  }
  return typeof window === "undefined" ? "" : window.location.origin;
}

function protectedImagePath(pathname: string) {
  return (
    pathname.startsWith("/images/") ||
    pathname.startsWith("/image-thumbnails/") ||
    pathname.startsWith("/api/images/download/")
  );
}

export function shouldFetchImageWithAuth(rawUrl: string) {
  if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
    return false;
  }
  // 如果是公开签名 URL，不需要认证
  if (rawUrl.includes("/public-images/") && rawUrl.includes("signature=")) {
    return false;
  }
  try {
    const parsed = new URL(rawUrl, typeof window === "undefined" ? getApiBaseUrl() : window.location.href);
    return protectedImagePath(parsed.pathname);
  } catch {
    return false;
  }
}

export function getImageFetchCandidates(rawUrl: string) {
  const candidates: string[] = [];
  const apiBaseUrl = getApiBaseUrl();
  const pageBaseUrl = typeof window === "undefined" ? apiBaseUrl : window.location.href;

  try {
    const parsed = new URL(rawUrl, pageBaseUrl || undefined);
    const pathAndSearch = `${parsed.pathname}${parsed.search}`;
    if (apiBaseUrl && parsed.pathname.startsWith("/images/")) {
      const relativeImagePath = parsed.pathname.slice("/images/".length);
      appendUnique(candidates, `${apiBaseUrl}/api/images/download/${relativeImagePath}${parsed.search}`);
      appendUnique(candidates, `${apiBaseUrl}${pathAndSearch}`);
    } else if (apiBaseUrl && protectedImagePath(parsed.pathname)) {
      appendUnique(candidates, `${apiBaseUrl}${pathAndSearch}`);
    }
  } catch {
    // The original URL is still attempted below.
  }

  appendUnique(candidates, rawUrl);
  return candidates;
}

export async function fetchImageBlob(rawUrl: string) {
  if (!rawUrl) {
    throw new Error("图片地址为空");
  }

  if (rawUrl.startsWith("data:") || rawUrl.startsWith("blob:")) {
    const response = await fetch(rawUrl);
    if (!response.ok) {
      throw new Error("读取图片失败");
    }
    return response.blob();
  }

  const authKey = await getStoredAuthKey();
  let lastError: unknown = null;
  for (const candidate of getImageFetchCandidates(rawUrl)) {
    try {
      const parsed = new URL(candidate, typeof window === "undefined" ? getApiBaseUrl() : window.location.href);
      const headers: HeadersInit = {};
      if (authKey && protectedImagePath(parsed.pathname)) {
        headers.Authorization = `Bearer ${authKey}`;
      }
      const response = await fetch(candidate, { headers });
      if (!response.ok) {
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      return response.blob();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("读取图片失败");
}

export async function createImageObjectUrl(rawUrl: string) {
  const blob = await fetchImageBlob(rawUrl);
  return URL.createObjectURL(blob);
}

export async function fetchImageFile(rawUrl: string, fileName: string) {
  const blob = await fetchImageBlob(rawUrl);
  return new File([blob], fileName, { type: blob.type || "image/png" });
}

export async function downloadImageUrl(rawUrl: string, fileName: string) {
  const blob = await fetchImageBlob(rawUrl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "image.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 获取图片的最佳 URL
 *
 * 优先使用 signed_url（公开访问，无需认证），
 * 如果没有则使用 url（需要认证下载）
 */
export function getBestImageUrl(imageData: { signed_url?: string; url?: string; b64_json?: string }): string {
  // 优先使用签名 URL（公开访问，快速）
  if (imageData.signed_url) {
    return imageData.signed_url;
  }

  // 其次使用 base64（无需下载）
  if (imageData.b64_json) {
    return `data:image/png;base64,${imageData.b64_json}`;
  }

  // 最后使用需要认证的 URL（需要下载）
  return imageData.url || "";
}
