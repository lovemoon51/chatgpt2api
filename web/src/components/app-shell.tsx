"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStudio = pathname === "/studio" || pathname.startsWith("/studio/");
  const isColaAI = pathname === "/ColaAI" || pathname.startsWith("/ColaAI/");
  const isFullScreenWorkbench = isStudio || isColaAI;

  return (
    <main
      className={cn(
        "min-h-screen overflow-x-hidden text-stone-900",
        isFullScreenWorkbench
          ? "bg-[#f3f6fb] p-0"
          : "bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_rgba(245,239,231,0.96)_42%,_rgba(240,235,227,0.99)_100%)] px-4 pt-0 pb-2 sm:px-6 sm:pt-2 lg:px-8",
      )}
    >
      <div
        className={cn(
          "box-border flex min-h-screen flex-col",
          isFullScreenWorkbench
            ? "w-full"
            : "mx-auto min-h-[calc(100dvh-0.5rem)] max-w-[1440px] gap-2 pt-[env(safe-area-inset-top)] sm:min-h-[calc(100dvh-1rem)] sm:gap-5 sm:pt-0",
        )}
      >
        {isFullScreenWorkbench ? null : <TopNav />}
        {children}
      </div>
    </main>
  );
}
