"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import webConfig from "@/constants/common-env";
import { useAuthGuard } from "@/lib/use-auth-guard";
import type { RegisterConfig } from "@/lib/api";
import { getStoredAuthKey } from "@/store/auth";

import { useSettingsStore } from "../settings/store";
import { RegisterCard } from "./components/register-card";

export type RegisterSseStatus = {
  state: "connecting" | "connected" | "error" | "closed" | "unauthorized";
  lastEventAt?: string;
  message?: string;
};

function RegisterDataController({ onSseStatusChange }: { onSseStatusChange: (status: RegisterSseStatus) => void }) {
  const didLoadRef = useRef(false);
  const loadRegister = useSettingsStore((state) => state.loadRegister);
  const setRegisterConfig = useSettingsStore((state) => state.setRegisterConfig);

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void loadRegister();
  }, [loadRegister]);

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    onSseStatusChange({ state: "connecting", message: "正在连接实时事件" });
    void getStoredAuthKey().then((token) => {
      if (closed) return;
      if (!token) {
        onSseStatusChange({ state: "unauthorized", message: "缺少登录令牌，无法连接实时事件" });
        return;
      }
      const baseUrl = webConfig.apiUrl.replace(/\/$/, "");
      source = new EventSource(`${baseUrl}/api/register/events?token=${encodeURIComponent(token)}`);
      source.onopen = () => {
        onSseStatusChange({ state: "connected", lastEventAt: new Date().toISOString(), message: "实时事件已连接" });
      };
      source.onmessage = (event) => {
        setRegisterConfig(JSON.parse(event.data) as RegisterConfig);
        onSseStatusChange({ state: "connected", lastEventAt: new Date().toISOString(), message: "已收到最新状态" });
      };
      source.onerror = () => {
        if (!closed) {
          onSseStatusChange({ state: "error", message: "实时事件连接异常，浏览器将自动重连" });
        }
      };
    });
    return () => {
      closed = true;
      source?.close();
      onSseStatusChange({ state: "closed", message: "实时事件已关闭" });
    };
  }, [onSseStatusChange, setRegisterConfig]);

  return null;
}

function RegisterPageContent() {
  const [sseStatus, setSseStatus] = useState<RegisterSseStatus>({ state: "connecting" });

  return (
    <>
      <RegisterDataController onSseStatusChange={setSseStatus} />
      <section className="mb-2 flex flex-col gap-1 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <div className="text-xs font-semibold tracking-[0.18em] text-stone-500 uppercase">Register</div>
          <h1 className="text-2xl font-semibold tracking-tight">ChatGPT注册机</h1>
        </div>
      </section>
      <section>
        <RegisterCard sseStatus={sseStatus} />
      </section>
    </>
  );
}

export default function RegisterPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <RegisterPageContent />;
}
