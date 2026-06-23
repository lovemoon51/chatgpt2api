import { NextRequest } from "next/server";

import webConfig from "@/constants/common-env";

/**
 * OpenAI 兼容的 chat completions API 代理
 * 将前端请求转发到后端服务
 */
export async function POST(request: NextRequest) {
  try {
    // 获取请求体和请求头
    const body = await request.json();
    const authorization = request.headers.get("authorization");

    if (!authorization) {
      return new Response(
        JSON.stringify({
          error: {
            message: "缺少 Authorization 请求头",
            type: "invalid_request_error",
            code: "missing_authorization",
          },
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // 构建后端 API URL
    const backendUrl = `${webConfig.apiUrl}/v1/chat/completions`;

    // 转发请求到后端
    const backendResponse = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authorization,
      },
      body: JSON.stringify(body),
    });

    // 如果是流式响应，直接转发流
    if (body.stream && backendResponse.ok) {
      return new Response(backendResponse.body, {
        status: backendResponse.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // 非流式响应或错误响应，返回 JSON
    const data = await backendResponse.json();

    // 记录错误日志便于调试
    if (!backendResponse.ok) {
      console.error(`Backend error (${backendResponse.status}):`, data);
    }

    return new Response(JSON.stringify(data), {
      status: backendResponse.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chat completions proxy error:", error);
    return new Response(
      JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : "代理请求失败",
          type: "proxy_error",
          code: "internal_error",
        },
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
