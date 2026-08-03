"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

// Ein einzelner, wiederverwendeter Supabase-Client für den Browser.
// Nutzt die öffentlichen (anon) Zugangsdaten - Rechte werden serverseitig
// über Row Level Security (siehe supabase/schema.sql) durchgesetzt, nicht
// durch Verstecken von UI-Elementen.
export function getSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen. " +
        "Siehe .env.local.example."
    );
  }

  browserClient = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return browserClient;
}
