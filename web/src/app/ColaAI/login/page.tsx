"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, LogIn, Sparkles } from "lucide-react";

import {
  createColaAuthProfile,
  createColaAuthSessionFromProfile,
  getStoredColaAuthProfile,
  setStoredColaAuthProfile,
  setStoredColaAuthSession,
} from "@/store/cola-auth";

export default function ColaAILoginPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedName = String(formData.get("name") || "").trim();
    const submittedEmail = String(formData.get("email") || "").trim();

    setIsSubmitting(true);
    setMessage("");
    try {
      const storedProfile = await getStoredColaAuthProfile();
      const profile =
        storedProfile ??
        createColaAuthProfile({
          name: submittedName || submittedEmail || "Cola Creator",
          email: submittedEmail,
        });
      const nextProfile = {
        ...profile,
        name: submittedName || profile.name,
        email: submittedEmail || profile.email,
      };

      await setStoredColaAuthProfile(nextProfile);
      await setStoredColaAuthSession(createColaAuthSessionFromProfile(nextProfile));
      if (typeof window !== "undefined") {
        window.location.href = "/ColaAI";
      }
    } catch {
      setMessage("登录失败，请稍后再试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      data-cola-panel="standalone-auth"
      data-cola-auth-mode="login"
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
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-slate-950">登录 ColaAI</h1>
          <p className="mt-3 max-w-[390px] text-sm leading-6 text-slate-500">
            使用 ColaAI 自己的创作者身份进入工作台，不会读取旧后台登录或管理员注册机状态。
          </p>
        </div>

        <form className="mt-7 space-y-4" onSubmit={(event) => void handleLogin(event)}>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">昵称</span>
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Cola Creator"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">邮箱，可选</span>
            <input
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white/86 px-4 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-cyan-300 focus:ring-4 focus:ring-cyan-100"
            />
          </label>
          {message ? <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{message}</p> : null}

          <button
            type="submit"
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.9)] transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            <LogIn className="size-4" />
            {isSubmitting ? "正在进入" : "进入 ColaAI"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          还没有 ColaAI 身份？
          <Link href="/ColaAI/register" className="font-semibold text-slate-950 hover:text-cyan-700">
            去注册
          </Link>
        </p>
      </section>
    </main>
  );
}
