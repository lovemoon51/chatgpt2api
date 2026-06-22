"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HeaderActions } from "@/components/header-actions";
import { login } from "@/lib/api";
import { getFriendlyErrorMessage } from "@/lib/error-messages";
import { useRedirectIfAuthenticated } from "@/lib/use-auth-guard";
import { createStoredAuthSessionFromLoginResponse, setStoredAuthSession } from "@/store/auth";

export default function LoginPage() {
  const router = useRouter();
  const [authKey, setAuthKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCheckingAuth } = useRedirectIfAuthenticated();

  const handleLogin = async () => {
    const normalizedLoginValue = authKey.trim();
    if (!normalizedLoginValue) {
      toast.error("请输入管理员密钥");
      return;
    }

    setIsSubmitting(true);
    try {
      const data = await login(normalizedLoginValue);
      if (data.role !== "admin") {
        toast.error("普通用户请在 ColaAI 内登录。");
        router.replace("/ColaAI/login");
        return;
      }
      await setStoredAuthSession(createStoredAuthSessionFromLoginResponse(normalizedLoginValue, data));
      router.replace("/accounts");
    } catch (error) {
      toast.error(getFriendlyErrorMessage(error, "登录失败"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100vh-1rem)] w-full place-items-center px-4 py-6">
      <HeaderActions className="fixed top-4 right-4 z-10" />
      <Card className="w-full max-w-[505px] rounded-[30px] border-white/80 bg-white/95 shadow-[0_28px_90px_rgba(28,25,23,0.10)]">
        <CardContent className="space-y-7 p-6 sm:p-8">
          <div className="space-y-4 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-[18px] bg-stone-950 text-white shadow-sm">
              <LockKeyhole className="size-5" />
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-950">后台管理登录</h1>
              <p className="text-sm leading-6 text-stone-500">此入口仅供管理员使用。普通用户请在 ColaAI 内登录和激活访问码。</p>
            </div>
          </div>

          <div className="space-y-3">
            <label htmlFor="auth-key" className="block text-sm font-medium text-stone-700">
              管理员密钥
            </label>
            <Input
              id="auth-key"
              type="password"
              value={authKey}
              onChange={(event) => setAuthKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void handleLogin();
                }
              }}
              placeholder="输入管理员密钥"
              className="h-13 rounded-2xl border-stone-200 bg-white px-4"
            />
          </div>

          <Button
            className="h-13 w-full rounded-2xl bg-stone-950 text-white hover:bg-stone-800"
            onClick={() => void handleLogin()}
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
            登录后台
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
