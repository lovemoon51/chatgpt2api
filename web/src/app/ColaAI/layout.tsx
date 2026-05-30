import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ColaAI",
};

export default function ColaAILayout({ children }: { children: React.ReactNode }) {
  return children;
}
