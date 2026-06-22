"use client";

import { LoaderCircle, UsersRound } from "lucide-react";

import { UserKeysCard } from "@/app/settings/components/user-keys-card";
import { useAuthGuard } from "@/lib/use-auth-guard";

function UsersPageContent() {
  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-stone-500">
            <UsersRound className="size-4" />
            用户管理
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">普通用户</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-500">
            查询、筛选和分页管理普通用户资料、图片余额、登录记录与访问码。
          </p>
        </div>
      </div>
      <UserKeysCard />
    </section>
  );
}

export default function UsersPage() {
  const { isCheckingAuth, session } = useAuthGuard(["admin"]);

  if (isCheckingAuth || !session || session.role !== "admin") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoaderCircle className="size-5 animate-spin text-stone-400" />
      </div>
    );
  }

  return <UsersPageContent />;
}
