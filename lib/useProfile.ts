"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase/client";
import type { Profile } from "./types";

// Lädt Session + zugehöriges Profil (Rolle) und hält sie synchron.
// Wird von jeder Seite genutzt, um Rolle/Rechte clientseitig zu kennen
// (die eigentliche Durchsetzung passiert serverseitig via RLS).
export function useProfile() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, aktiv")
        .eq("id", uid)
        .single();
      if (!error) setProfile(data as Profile);
      setLoading(false);
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { loading, profile, userId };
}
