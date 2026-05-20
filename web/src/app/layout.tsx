import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "ChatGPT 号池管理",
  description: "ChatGPT account pool management dashboard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#f0ebe3",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className="antialiased"
        style={{
          fontFamily:
            '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
        }}
      >
        <Toaster
          position="bottom-right"
          richColors
          offset={20}
          mobileOffset={16}
          toastOptions={{
            classNames: {
              toast:
                "rounded-xl border border-stone-200/80 bg-white/95 text-stone-800 shadow-lg shadow-stone-300/25 backdrop-blur",
              title: "text-sm font-medium",
              description: "text-xs text-stone-500",
            },
          }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
