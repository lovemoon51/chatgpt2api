"use client";

import { useEffect, useState } from "react";

import {
  createColaAuthProfileFromSharedSession,
  createColaAuthSessionFromSharedSession,
  getStoredColaAuthSession,
  setStoredColaAuthProfile,
  setStoredColaAuthSession,
  type ColaAuthSession,
} from "@/store/cola-auth";
import { getStoredAuthSession } from "@/store/auth";
import { ColaAIWorkbench } from "./components/cola-ai-workbench";

const publicPreviewSession: ColaAuthSession = {
  key: "",
  role: "guest",
  subjectId: "public-preview",
  name: "ColaAI",
};

export default function ColaAIPage() {
  const [session, setSession] = useState<ColaAuthSession | null>(null);

  useEffect(() => {
    let active = true;

    const loadSession = async () => {
      try {
        const storedSession = await getStoredColaAuthSession();
        if (active && storedSession) {
          setSession(storedSession);
          return;
        }

        const sharedSession = await getStoredAuthSession();
        const colaSession = sharedSession ? createColaAuthSessionFromSharedSession(sharedSession) : null;
        const colaProfile = sharedSession ? createColaAuthProfileFromSharedSession(sharedSession) : null;
        if (active && colaSession && colaProfile) {
          await setStoredColaAuthProfile(colaProfile);
          await setStoredColaAuthSession(colaSession);
          setSession(colaSession);
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
