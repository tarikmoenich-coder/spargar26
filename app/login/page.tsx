"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";

function LoginFormular() {
  const router = useRouter();
  // Nutzer-Vorgabe 2026-08-28 (automatische Abmeldung nach 60 Min.
  // Inaktivität, siehe components/InaktivitaetsAbmeldung.tsx): zeigt einen
  // erklärenden Hinweis statt die Person einfach kommentarlos wieder vor
  // dem Anmeldeformular stehen zu lassen.
  const wegenInaktivitaet = useSearchParams().get("grund") === "inaktivitaet";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError("Anmeldung fehlgeschlagen: " + error.message);
      return;
    }
    router.replace("/erfassung");
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-lg font-semibold text-emerald-800">
        Spargar Anmeldung
      </h1>
      {wegenInaktivitaet && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Du wurdest wegen 60 Minuten Inaktivität automatisch abgemeldet.
          Bitte erneut anmelden.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="text-sm">
          E-Mail
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full"
          />
        </label>
        <label className="text-sm">
          Passwort
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
      <p className="mt-4 text-xs text-neutral-500">
        Nutzerkonten werden vom Administrator in Supabase angelegt (Auth →
        Users) und über die Tabelle „profiles“ einer Rolle zugeordnet.
      </p>
    </div>
  );
}

// useSearchParams() (für den Inaktivitäts-Hinweis, siehe LoginFormular)
// verlangt einen Suspense-Rand, sonst schlägt das statische Prerendering
// dieser Seite beim Build fehl ("should be wrapped in a suspense boundary").
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginFormular />
    </Suspense>
  );
}
