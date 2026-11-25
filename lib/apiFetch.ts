"use client";

import { getSupabaseClient } from "@/lib/supabase/client";

// fetch auf eine eigene API-Route mit dem Zugangstoken des angemeldeten
// Nutzers (Prüfung serverseitig in lib/apiAuth.ts).
export async function apiFetch(pfad: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await getSupabaseClient().auth.getSession();
  const headers = new Headers(init.headers);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(pfad, { ...init, headers });
}
