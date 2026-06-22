"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Sparkles, UserPlus } from "lucide-react";

import { activateUser } from "@/lib/api";
import { createStoredAuthSessionFromLoginResponse, setStoredAuthSession } from "@/store/auth";
import {
  createColaAuthProfileFromSharedSession,
  createColaAuthSessionFromSharedSession,
  setStoredColaAuthProfile,
  setStoredColaAuthSession,
} from "@/store/cola-auth";

export default function ColaAIRegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedEmail = String(formData.get("email") || "").trim();
    const submittedPassword = String(formData.get("password") || "");
    const displayName = String(formData.get("name") || "").trim();
    const submittedAccessCode = String(formData.get("accessCode") || "").trim();

    if (!submittedEmail || !submittedPassword || !submittedAccessCode) {
      setMessage("请输入邮箱、密码和管理员发放的普通用户访问码。");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      const data = await activateUser({
        email: submittedEmail,
        password: submittedPassword,
        accessCode: submittedAccessCode,
        name: displayName,
      });
      if (data.role !== "user") {
        setMessage("这个访问码不能用于 ColaAI 普通用户身份。");
        return;
      }
      const sharedSession = {
        ...createStoredAuthSessionFromLoginResponse(submittedEmail, data),
        name: displayName || data.name || "Cola Creator",
      };
      const colaProfile = createColaAuthProfileFromSharedSession(sharedSession);

      await setStoredAuthSession(sharedSession);
      await setStoredColaAuthProfile(colaProfile);
      await setStoredColaAuthSession(createColaAuthSessionFromSharedSession(sharedSession));
      if (typeof window !== "undefined") {
        window.location.href = "/ColaAI";
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "激活失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      data-cola-panel="standalone-auth"
      data-cola-auth-mode="register"
      className="relative isolate grid min-h-dvh place-items-center overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(236,253,245,0.9),rgba(240,249,255,0.94)_42%,rgba(248,250,252,1)_100%)] px-4 py-8 text-slate-950"
    >
      <div aria-hidden="true" className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl" />
      <div aria-hidden="true" className="absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-emerald-200/50 blur-3xl" />

      <section className="relative w-full max-w-[520px] overflow-hidden rounded-[30px] border border-white/80 bg-white/88 p-6 shadow-[0_34px_100px_-64px_rgba(15,23,42,0.74)] ring-1 ring-slate-200/70 backdrop-blur-2xl sm:p-8">
        <Link href="/ColaAI" className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-white hover:text-slate-950">
          <ArrowLeft className="size-3.5" />
          返回 ColaAI
        </Link>

        <div className="mt-8">
          <div className="grid size-12 place-items-center rounded-2xl bg-slate-950 text-white">
            <Sparkles className="size-5" />
          </div>
          <p className="mt-5 text-sm font-semibold text-cyan-700">ColaAI Account</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-slate-950">注册 ColaAI</h1>
          <p className="mt-3 max-w-[390px] text-sm leading-6 text-slate-500">
            使用邮箱、密码和管理员发放的一次性访问码激活 ColaAI 身份。访问码绑定后不能再用于其他账号。
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleRegister(event)}>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">邮箱</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="用于后续登录"
              autoComplete="email"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">密码</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              autoComplete="new-password"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">显示名称，可选</span>
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：可乐设计实验室"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">普通用户访问码</span>
            <input
              name="accessCode"
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              placeholder="输入管理员发放的访问码"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          {message ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{message}</p> : null}

          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.9)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            <UserPlus className="size-4" />
            {isSubmitting ? "正在激活" : "激活 ColaAI 身份"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          已经有 ColaAI 身份？
          <Link href="/ColaAI/login" className="font-semibold text-slate-950 hover:text-cyan-700">
            去登录
          </Link>
        </p>
      </section>
    </main>
  );
}
