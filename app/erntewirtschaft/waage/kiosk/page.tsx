"use client";

// Waagen-Kiosk (Nutzer-Vorgabe 2026-10-26): kleine, für einen Touchscreen am
// Waagen-PC optimierte Rückmeldungsseite - wenige, aber für den Bediener/die
// Leute beim Abladen wichtige Informationen (Gewicht, Tara, Feld, Sorte,
// Mitarbeiter mit Foto), plus grüner Punkt + Piepton bei jeder erfolgreich
// erfassten+übermittelten Wiegung.
//
// Mitarbeiter/Feld/Sorte sind NUR bekannt, wenn vorher an der Erntemaschine
// die Kiste gescannt wurde (Badge -> Feld per GPS) - die dafür nötige
// QR-Scan-Hardware an den Maschinen selbst ist noch nicht gekauft/
// pilotgetestet (siehe docs/erntewirtschaft-plan.md). Bis dahin zeigt diese
// Seite nur Gewicht+Tara an (status "ungeklaert" - der Processor legt dann
// direkt einen neuen, nicht zuordenbaren ernte_kiste_zyklus-Datensatz an,
// siehe migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql).
//
// Realtime statt Polling: tools/ernte-waage-agent ruft nach jedem
// erfolgreichen Schreiben sofort ernte_scan_verarbeiten() auf (statt bis zu
// 60s auf den naechsten pg_cron-Takt zu warten), die Kiosk-Seite bekommt die
// Aenderung an ernte_kiste_zyklus dann per Supabase-Realtime quasi sofort.
// Realtime liefert nur die Basistabellen-Spalten (keine Joins) - darum nach
// jedem Ereignis ein gezielter Nachlade-Request auf die Sicht
// ernte_kiosk_wiegung (Feld/Sorte/Mitarbeiter+Foto).

import { useCallback, useEffect, useRef, useState } from "react";
import { Scale, User } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import type { ErnteKioskWiegung } from "@/lib/types";

const FOTO_BUCKET = "mitarbeiter-fotos";
// Wie lange der grüne Punkt nach einer Wiegung sichtbar bleibt, bevor er
// wieder in den neutralen "wartet"-Zustand zurückfällt.
const ERFOLG_ANZEIGE_MS = 5000;

function formatZeitpunktDE(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function WaagenKioskPage() {
  const [aktuelle, setAktuelle] = useState<ErnteKioskWiegung | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [erfolgSichtbar, setErfolgSichtbar] = useState(false);
  const [gestartet, setGestartet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const letzteIdRef = useRef<number | null>(null);
  const erfolgTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const zeigeErfolg = useCallback(() => {
    setErfolgSichtbar(true);
    if (erfolgTimeoutRef.current) clearTimeout(erfolgTimeoutRef.current);
    erfolgTimeoutRef.current = setTimeout(() => setErfolgSichtbar(false), ERFOLG_ANZEIGE_MS);

    const ctx = audioCtxRef.current;
    if (!ctx) return;
    // Zwei kurze Pieptöne statt einem - auffälliger in einer lauten
    // Hof-/Verladeumgebung, besser vom allgemeinen Betriebslärm
    // unterscheidbar als ein einzelner Dauerton.
    [0, 0.25].forEach((start) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(1, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
  }, []);

  const uebernehmeZeile = useCallback(
    (row: ErnteKioskWiegung) => {
      if (row.status !== "gewogen" && row.status !== "ungeklaert") return;
      if (!row.gewogen_am) return;
      const istNeu = row.id !== letzteIdRef.current;
      letzteIdRef.current = row.id;
      setAktuelle(row);
      if (istNeu) zeigeErfolg();
    },
    [zeigeErfolg]
  );

  const ladeZeile = useCallback(
    async (id: number) => {
      const { data, error } = await getSupabaseClient()
        .from("ernte_kiosk_wiegung")
        .select("*")
        .eq("id", id)
        .single();
      if (error) {
        setFehler(error.message);
        return;
      }
      if (data) uebernehmeZeile(data as ErnteKioskWiegung);
    },
    [uebernehmeZeile]
  );

  // Letzte bekannte Wiegung beim Laden/Neuladen der Seite anzeigen, ohne auf
  // das nächste Realtime-Ereignis warten zu müssen.
  useEffect(() => {
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from("ernte_kiosk_wiegung")
        .select("*")
        .in("status", ["gewogen", "ungeklaert"])
        .order("gewogen_am", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        setFehler(error.message);
        return;
      }
      if (data) {
        // Beim ersten Laden keinen Piepton/grünen Punkt für eine
        // möglicherweise schon ältere Wiegung auslösen.
        letzteIdRef.current = (data as ErnteKioskWiegung).id;
        setAktuelle(data as ErnteKioskWiegung);
      }
    })();
  }, []);

  // Realtime-Abo auf ernte_kiste_zyklus - jede neue/aktualisierte Zeile mit
  // frischem gewogen_am löst einen gezielten Nachlade-Request auf die Sicht
  // oben aus (Realtime liefert nur die Roh-Tabellenspalten, keine Joins).
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel("ernte-kiosk-wiegung")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ernte_kiste_zyklus" },
        (payload) => void ladeZeile((payload.new as { id: number }).id)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ernte_kiste_zyklus" },
        (payload) => void ladeZeile((payload.new as { id: number }).id)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ladeZeile]);

  // Signierte Foto-URL nachladen, sobald sich der Mitarbeiter ändert
  // (mitarbeiter-fotos ist ein privater Bucket, siehe app/erntewirtschaft/
  // ausweise/page.tsx für dasselbe Muster).
  useEffect(() => {
    const pfad = aktuelle?.mitarbeiter_foto_pfad;
    if (!pfad) {
      setFotoUrl(null);
      return;
    }
    let abgebrochen = false;
    getSupabaseClient()
      .storage.from(FOTO_BUCKET)
      .createSignedUrl(pfad, 60)
      .then((r) => {
        if (!abgebrochen) setFotoUrl(r.data?.signedUrl ?? null);
      });
    return () => {
      abgebrochen = true;
    };
  }, [aktuelle?.mitarbeiter_foto_pfad]);

  function starten() {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtxRef.current = new AudioCtx();
    setGestartet(true);
  }

  if (!gestartet) {
    return (
      <button
        type="button"
        onClick={starten}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-emerald-900 text-white"
      >
        <Scale className="h-16 w-16" />
        <p className="text-2xl font-semibold">Bildschirm antippen zum Start</p>
        <p className="text-sm text-emerald-100">
          (einmalig nötig, damit der Piepton im Browser erlaubt ist)
        </p>
      </button>
    );
  }

  const hatMitarbeiter = !!aktuelle?.employee_id;
  const hatFeld = !!aktuelle?.feld_id;

  return (
    <div className="flex min-h-[85vh] flex-col gap-6 p-2">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-emerald-900">
          <Scale className="h-6 w-6" /> Waagen-Kiosk
        </h1>
        <div className="flex items-center gap-2">
          <span
            className={`h-6 w-6 rounded-full transition-colors ${
              erfolgSichtbar ? "animate-pulse bg-emerald-500" : "bg-neutral-300"
            }`}
          />
          <span className="text-sm text-neutral-500">
            {aktuelle ? formatZeitpunktDE(aktuelle.gewogen_am) : "Noch keine Wiegung"}
          </span>
        </div>
      </div>

      {fehler && <p className="text-sm text-beere-700">Konnte nicht laden: {fehler}</p>}

      {!aktuelle ? (
        <p className="text-lg text-neutral-500">
          Noch keine Wiegung erfasst. Läuft der Waagen-Agent und ist mit der Waage verbunden?
        </p>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm text-neutral-500">Gewicht (netto)</p>
            <p className="text-7xl font-bold text-emerald-900">
              {formatMenge(aktuelle.gewicht_netto_kg)} kg
            </p>
            <p className="text-base text-neutral-500">
              Brutto {formatMenge(aktuelle.gewicht_brutto_kg)} kg · Tara{" "}
              {formatMenge(aktuelle.tara_kg)} kg
            </p>
            <p className="font-mono text-sm text-neutral-400">{aktuelle.tag_uid}</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="card p-6">
              <p className="text-sm text-neutral-500">Feld / Sorte</p>
              {hatFeld ? (
                <>
                  <p className="text-3xl font-semibold text-emerald-900">
                    {aktuelle.feld_bezeichnung}
                  </p>
                  <p className="text-lg text-neutral-600">
                    {aktuelle.feld_sorte ?? "Sorte nicht hinterlegt"}
                  </p>
                </>
              ) : (
                <p className="text-xl text-neutral-400">
                  Noch keine Maschinen-Zuordnung
                </p>
              )}
            </div>

            <div className="card flex items-center gap-4 p-6">
              {hatMitarbeiter ? (
                <>
                  {fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fotoUrl}
                      alt=""
                      className="h-24 w-24 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-24 items-center justify-center rounded-full bg-sand">
                      <User className="h-10 w-10 text-neutral-400" />
                    </div>
                  )}
                  <div>
                    <p className="text-2xl font-semibold text-emerald-900">
                      {aktuelle.mitarbeiter_vorname} {aktuelle.mitarbeiter_name}
                    </p>
                    <p className="text-lg text-neutral-500">
                      Pers.-Nr. {aktuelle.mitarbeiter_personal_nr}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xl text-neutral-400">
                  Mitarbeiter unbekannt (noch keine Maschinen-Zuordnung)
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
