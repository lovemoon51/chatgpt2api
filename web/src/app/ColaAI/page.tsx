"use client";

import { useEffect, useState } from "react";

import { getValidatedAuthSession } from "@/lib/auth-session";
import type { StoredAuthSession } from "@/store/auth";
import { ColaAIWorkbench } from "./components/cola-ai-workbench";

const publicPreviewSession: StoredAuthSession = {
  key: "",
  role: "user",
  subjectId: "public-preview",
  name: "ColaAI",
};

export default function ColaAIPage() {
  const [session, setSession] = useState<StoredAuthSession | null>(null);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      try {
        const storedSession = await getValidatedAuthSession();
        if (active && storedSession) {
          setSession(storedSession);
        }
      } catch {
        if (active) {
          setSession(null);
        }
      }
    };

    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  return <ColaAIWorkbench session={session ?? publicPreviewSession} />;
}
