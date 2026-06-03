import axios, {AxiosError, type AxiosRequestConfig} from "axios";

import webConfig from "@/constants/common-env";
import {getFriendlyErrorMessage} from "@/lib/error-messages";
import {clearStoredAuthSession, getStoredAuthKey} from "@/store/auth";
import {clearStoredColaAuthSession} from "@/store/cola-auth";

type RequestConfig = AxiosRequestConfig & {
    redirectOnUnauthorized?: boolean;
};

type ErrorPayload = {
    detail?: string | { error?: string | { message?: string; code?: string; type?: string } };
    error?: string | { message?: string; code?: string; type?: string };
    message?: string;
    code?: string;
    type?: string;
};

function errorMessageFromValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }
    if (!value || typeof value !== "object") {
        return "";
    }

    const item = value as { error?: unknown; message?: unknown };
    if (typeof item.message === "string") {
        return item.message;
    }
    return errorMessageFromValue(item.error);
}

export const request = axios.create({
    baseURL: webConfig.apiUrl.replace(/\/$/, ""),
});

export function getUnauthorizedRedirectPath(pathname: string) {
    return getUnauthorizedRedirectPlan(pathname).redirectPath;
}

export function getUnauthorizedRedirectPlan(pathname: string) {
    if (pathname === "/login" || pathname.startsWith("/login/") || pathname === "/ColaAI/login" || pathname.startsWith("/ColaAI/login/")) {
        return {redirectPath: "", clearColaAuth: false};
    }
    if (pathname === "/ColaAI" || pathname.startsWith("/ColaAI/")) {
        return {redirectPath: "/ColaAI/login", clearColaAuth: true};
    }
    return {redirectPath: "/login", clearColaAuth: false};
}

request.interceptors.request.use(async (config) => {
    const nextConfig = {...config};
    const authKey = await getStoredAuthKey();
    const headers = {...(nextConfig.headers || {})} as Record<string, string>;
    if (authKey && !headers.Authorization) {
        headers.Authorization = `Bearer ${authKey}`;
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    nextConfig.headers = headers;
    return nextConfig;
});

request.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<ErrorPayload>) => {
        const status = error.response?.status;
        const shouldRedirect = (error.config as RequestConfig | undefined)?.redirectOnUnauthorized !== false;
        if (status === 401 && shouldRedirect && typeof window !== "undefined") {
            const redirectPlan = getUnauthorizedRedirectPlan(window.location.pathname);
            if (redirectPlan.redirectPath) {
                await clearStoredAuthSession();
                if (redirectPlan.clearColaAuth) {
                    await clearStoredColaAuthSession();
                }
                window.location.replace(redirectPlan.redirectPath);
                // Return a never-resolving promise to prevent further error handling
                // while the browser navigates away
                return new Promise(() => {});
            }
        }

        const payload = error.response?.data;
        const rawMessage =
            errorMessageFromValue(payload?.detail) ||
            errorMessageFromValue(payload?.error) ||
            payload?.message ||
            error.message ||
            `请求失败 (${status || 500})`;
        const payloadError = typeof payload?.error === "object" && payload.error ? payload.error : undefined;
        const message = getFriendlyErrorMessage(rawMessage, `请求失败 (${status || 500})`, {
            status,
            code: payload?.code || payloadError?.code,
            type: payload?.type || payloadError?.type,
        });
        return Promise.reject(new Error(message));
    },
);

type RequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    redirectOnUnauthorized?: boolean;
};

export async function httpRequest<T>(path: string, options: RequestOptions = {}) {
    const {method = "GET", body, headers, redirectOnUnauthorized = true} = options;
    const config: RequestConfig = {
        url: path,
        method,
        data: body,
        headers,
        redirectOnUnauthorized,
    };
    const response = await request.request<T>(config);
    return response.data;
}
