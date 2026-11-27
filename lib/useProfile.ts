"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase/client";
import type { Profile } from "./types";

// Bekanntes supabase-js-Problem (Auth-Lock via navigator.locks): kommt ein
// Tab/die App nach längerem Hintergrund wieder in den Vordergrund, bleibt
// supabase.auth.getSession() manchmal für immer hängen - die Seite zeigt
// dann nur noch Menüleiste + "Abmelden" und ansonsten dauerhaft "Lädt…".
// Bisher half nur Abmelden+neu anmelden (am Handy: Fenster schließen und neu
// öffnen). Ein einfaches Neuladen der Seite reicht aber schon - der Lock
// hängt nur im laufenden JS-Kontext fest, die Session selbst ist meist noch
// gültig. Deshalb: jeder Ladevorgang bekommt ein Zeitlimit, danach wird die
// Seite automatisch einmal neu geladen (gedrosselt, damit ein echter
// Netzausfall nicht in eine Reload-Schleife läuft).
const LADE_TIMEOUT_MS = 5000;
const RELOAD_SPERRE_MS = 30000;
const RELOAD_KEY = "spargar_profil_reload_versucht";

function mitTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Zeitlimit (${ms} ms) beim Laden überschritten`)),
      ms
    );
    Promise.resolve(promise).then(
      (wert) => {
        clearTimeout(timer);
        resolve(wert);
      },
      (fehler) => {
        clearTimeout(timer);
        reject(fehler);
      }
    );
  });
}

function seiteNeuLadenGedrosselt() {
  try {
    const letzter = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
    if (Date.now() - letzter < RELOAD_SPERRE_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage z.B. im privaten Modus blockiert - dann eben ohne
    // Drosselung neu laden, besser als dauerhaft hängen zu bleiben.
  }
  window.location.reload();
}

// Lädt Session + zugehöriges Profil (Rolle) und hält sie synchron.
// Wird von jeder Seite genutzt, um Rolle/Rechte clientseitig zu kennen
// (die eigentliche Durchsetzung passiert serverseitig via RLS).
export function useProfile() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let abgehaengt = false;

    async function load() {
      try {
        const { data: sessionData } = await mitTimeout(
          supabase.auth.getSession(),
          LADE_TIMEOUT_MS
        );
        if (abgehaengt) return;
        const uid = sessionData.session?.user?.id ?? null;
        setUserId(uid);
        if (!uid) {
          setProfile(null);
          setLoading(false);
          return;
        }
        const { data, error } = await mitTimeout(
          supabase
            .from("profiles")
            // "*" statt Spaltenliste (profiles hat keine Spaltenrechte) plus die
            // vorberechneten Rechte (profil_rechte, Rechte-Umbau 2026-11-28) -
            // eine Abfrage, kein zusätzlicher Weg zur Datenbank.
            .select("*, profil_rechte(*)")
            .eq("id", uid)
            .single(),
          LADE_TIMEOUT_MS
        );
        if (abgehaengt) return;
        if (!error && data) {
          const p = data as Profile & { profil_rechte?: unknown };
          // PostgREST liefert die 1:1-Beziehung als Objekt (ältere Versionen
          // als Liste mit einem Eintrag).
          const pr = Array.isArray(p.profil_rechte) ? p.profil_rechte[0] : p.profil_rechte;
          setProfile({
            ...p,
            profil_rechte: (pr as Profile["profil_rechte"]) ?? null,
            rollen: Array.isArray(p.rollen) && p.rollen.length > 0 ? p.rollen : [p.role],
          });
        } else if (!error) {
          setProfile(null);
        }
        setLoading(false);
      } catch {
        if (!abgehaengt) seiteNeuLadenGedrosselt();
      }
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });
    return () => {
      abgehaengt = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { loading, profile, userId };
}
