"use client";

// Waagen-Kiosk (Nutzer-Vorgabe 2026-10-26, Layout-Überarbeitung 2026-11-04):
// kleine, für einen Touchscreen am Waagen-PC optimierte Rückmeldungsseite -
// wenige, aber für den Bediener/die Leute beim Abladen wichtige Informationen
// (Gewicht, Tara, Feld, Sorte, Mitarbeiter mit Foto), plus grüner Punkt +
// Piepton bei jeder erfolgreich erfassten+übermittelten Wiegung.
//
// Layout (Nutzer-Vorgabe 2026-11-04): die große Kachel links zeigt oben links
// Mitarbeiter (Foto+Name) und darunter Feld/Sorte der AKTUELLEN Wägung,
// darunter groß das Gewicht. Rechts daneben die letzten (bis zu
// MAX_VERLAUF) vorherigen Wägungen als kompakte Kacheln, neueste oben -
// rein client-seitiger Verlauf aus den Realtime-Ereignissen, keine eigene
// Tabelle/Abfrage nötig.
//
// Mitarbeiter/Feld sind NUR bekannt, wenn vorher an der Erntemaschine die
// Kiste gescannt wurde (Badge -> Feld per GPS) - das Scan-Modul ist am
// Pilotgerät bereits produktiv im Einsatz (Praxistest bestanden, siehe
// docs/erntewirtschaft-plan.md "Praxistest bestanden 2026-10-22"), die
// Scanner für den restlichen Rollout sind bereits bestellt. Fehlt die
// Zuordnung trotzdem (z.B. Testscans direkt an der Waage ohne vorherigen
// Maschinen-Scan, oder eine Kiste außerhalb des Pilotbetriebs), legt der
// Processor einen "ungeklaert"-Datensatz an statt zu blockieren, siehe
// migration_2026-10-20_erntewirtschaft_kisten_zyklus.sql - diese Seite
// zeigt dann nur Gewicht+Tara.
//
// Realtime statt Polling: tools/ernte-waage-agent ruft nach jedem
// erfolgreichen Schreiben sofort ernte_scan_verarbeiten() auf (statt bis zu
// 60s auf den naechsten pg_cron-Takt zu warten), die Kiosk-Seite bekommt die
// Aenderung an ernte_kiste_zyklus dann per Supabase-Realtime quasi sofort.
// Realtime liefert nur die Basistabellen-Spalten (keine Joins) - darum nach
// jedem Ereignis ein gezielter Nachlade-Request auf die Sicht
// ernte_kiosk_wiegung (Feld/Sorte/Mitarbeiter+Foto).
//
// Live-Verbindungsanzeige (Nutzer-Rückmeldung 2026-11-04 nach dem ersten
// Praxistest): der Waagen-Agent schreibt unabhängig vom Wiegen alle paar
// Sekunden das aktuelle <GN7>-Gewicht nach ernte_waage.live_gewicht_kg/
// live_aktualisiert_am (migration_2026-11-04_waage_live_status.sql) - diese
// Seite zeigt das im Kopf als kleinen Punkt + "vor Xs aktualisiert", damit
// sich niemand fragen muss, ob die Verbindung noch steht.

import { useCallback, useEffect, useRef, useState } from "react";
import { Scale, User } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatMenge } from "@/lib/format";
import type { ErnteKioskWiegung } from "@/lib/types";

const FOTO_BUCKET = "mitarbeiter-fotos";
// Wie lange der grüne Punkt nach einer Wiegung sichtbar bleibt, bevor er
// wieder in den neutralen "wartet"-Zustand zurückfällt.
const ERFOLG_ANZEIGE_MS = 5000;
// Wie viele vorherige Wägungen als Kacheln rechts daneben stehen (Nutzer-
// Vorgabe 2026-11-04: "die letzten 3 gescannten Kisten").
const MAX_VERLAUF = 3;
// Ab wie vielen Sekunden ohne frisches live_aktualisiert_am die
// Live-Anzeige auf "keine Verbindung" springt - deutlich über dem
// LIVE_POLL_INTERVALL_MS-Default (3s) des Agenten, damit ein einzelner
// verzögerter Poll nicht sofort als Ausfall gilt.
const WAAGE_LIVE_TIMEOUT_S = 10;

interface WaageLiveStatus {
  live_gewicht_kg: number | null;
  live_aktualisiert_am: string | null;
}

function formatZeitpunktDE(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// Mitarbeiterfoto aus dem privaten Bucket - eigene Komponente, weil sowohl
// die große aktuelle Wägung als auch jede Verlaufs-Kachel ein (eigenes)
// Foto brauchen, jede mit ihrem eigenen Mitarbeiter (gleiches Signier-Muster
// wie app/erntewirtschaft/ausweise/page.tsx).
function MitarbeiterAvatar({
  pfad,
  groesseKlasse,
  iconKlasse,
}: {
  pfad: string | null;
  groesseKlasse: string;
  iconKlasse: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pfad) {
      setUrl(null);
      return;
    }
    let abgebrochen = false;
    getSupabaseClient()
      .storage.from(FOTO_BUCKET)
      .createSignedUrl(pfad, 60)
      .then((r) => {
        if (!abgebrochen) setUrl(r.data?.signedUrl ?? null);
      });
    return () => {
      abgebrochen = true;
    };
  }, [pfad]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`${groesseKlasse} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`flex ${groesseKlasse} shrink-0 items-center justify-center rounded-full bg-sand`}>
      <User className={`${iconKlasse} text-neutral-400`} />
    </div>
  );
}

// Kompakte Zusammenfassung einer zurückliegenden Wägung (Nutzer-Vorgabe
// 2026-11-04) - Foto+Name, Feld, Gewicht, Zeitstempel.
function VerlaufKachel({ wiegung }: { wiegung: ErnteKioskWiegung }) {
  return (
    <div className="card flex items-center gap-3 p-3">
      <MitarbeiterAvatar pfad={wiegung.mitarbeiter_foto_pfad} groesseKlasse="h-10 w-10" iconKlasse="h-5 w-5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-800">
          {wiegung.employee_id ? `${wiegung.mitarbeiter_vorname} ${wiegung.mitarbeiter_name}` : "Mitarbeiter unbekannt"}
        </p>
        <p className="truncate text-xs text-neutral-500">{wiegung.feld_id ? wiegung.feld_bezeichnung : "Kein Feld"}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold text-emerald-900">{formatMenge(wiegung.gewicht_netto_kg)} kg</p>
        <p className="text-xs text-neutral-400">{formatZeitpunktDE(wiegung.gewogen_am)}</p>
      </div>
    </div>
  );
}

export default function WaagenKioskPage() {
  const [aktuelle, setAktuelle] = useState<ErnteKioskWiegung | null>(null);
  const [verlauf, setVerlauf] = useState<ErnteKioskWiegung[]>([]);
  const [erfolgSichtbar, setErfolgSichtbar] = useState(false);
  const [gestartet, setGestartet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zaehler, setZaehler] = useState({ vormittag: 0, nachmittag: 0, offen: 0 });
  const [waageLive, setWaageLive] = useState<WaageLiveStatus | null>(null);

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
      setAktuelle((vorherige) => {
        // Die bisherige "aktuelle" Wägung rutscht nach rechts in den
        // Verlauf, sobald eine wirklich NEUE Wägung reinkommt (nicht bei
        // einem UPDATE derselben Zeile) - älteste Verlaufs-Kachel fällt ab
        // MAX_VERLAUF automatisch raus.
        if (istNeu && vorherige) {
          setVerlauf((v) => [vorherige, ...v.filter((w) => w.id !== row.id)].slice(0, MAX_VERLAUF));
        }
        return row;
      });
      if (istNeu) zeigeErfolg();
    },
    [zeigeErfolg],
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
    [uebernehmeZeile],
  );

  // Kistenzähler Vormittag (00:00-14:59) / Nachmittag (15:00-23:59) -
  // bewusst zwei reine Zähl-Abfragen (count, "head: true", keine Zeilen)
  // statt alle Zeilen des Tages zu laden: an Spitzentagen werden bis zu
  // 1600 Kisten erwartet (docs/erntewirtschaft-plan.md) - das reisst locker
  // den Supabase/PostgREST-1000-Zeilen-Cap (siehe [[postgrest-1000-zeilen-
  // cap]]), ein reiner Zählwert ist davon nicht betroffen. Grenzen in
  // lokaler Zeit (Browser-Zeitzone des Kiosk-Rechners), nicht UTC.
  const ladeZaehler = useCallback(async () => {
    const jetzt = new Date();
    const mitternacht = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
    const fuenfzehnUhr = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate(), 15);
    const naechsteMitternacht = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 1);

    const basis = () =>
      getSupabaseClient()
        .from("ernte_kiste_zyklus")
        .select("*", { count: "exact", head: true })
        .in("status", ["gewogen", "ungeklaert"]);

    // "Kisten im Umlauf" (Nutzer-Vorgabe 2026-10-27: Abschaetzung, wieviel
    // noch von den Maschinen kommt / Kontrolle, ob am Tagesende alle Kisten
    // abgeholt wurden): bewusst ein einzelner Live-Zaehlwert (Status
    // "offen" = an der Maschine gescannt, noch nicht gewogen) statt
    // "heute an Maschinen gescannt" minus "heute gewogen" zu rechnen -
    // kein Tagesgrenzen-Sonderfall noetig und eine seit gestern vergessene
    // offene Kiste faellt dadurch nicht unbemerkt aus der Zaehlung heraus.
    const [{ count: vormittag, error: e1 }, { count: nachmittag, error: e2 }, { count: offen, error: e3 }] =
      await Promise.all([
        basis().gte("gewogen_am", mitternacht.toISOString()).lt("gewogen_am", fuenfzehnUhr.toISOString()),
        basis().gte("gewogen_am", fuenfzehnUhr.toISOString()).lt("gewogen_am", naechsteMitternacht.toISOString()),
        getSupabaseClient()
          .from("ernte_kiste_zyklus")
          .select("*", { count: "exact", head: true })
          .eq("status", "offen"),
      ]);
    if (e1 || e2 || e3) {
      setFehler((e1 ?? e2 ?? e3)?.message ?? "Kistenzähler konnte nicht geladen werden.");
      return;
    }
    setZaehler({ vormittag: vormittag ?? 0, nachmittag: nachmittag ?? 0, offen: offen ?? 0 });
  }, []);

  // Live-Status der Waage selbst (Gewicht + letztes erfolgreiches Polling
  // des Agenten) - eigener, kurzer Intervall statt der 60s-Netz-Abfrage der
  // Kistenzähler, damit die Verbindungsanzeige wirklich "live" wirkt.
  const ladeWaageLive = useCallback(async () => {
    const { data } = await getSupabaseClient()
      .from("ernte_waage")
      .select("live_gewicht_kg, live_aktualisiert_am")
      .eq("aktiv", true)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    setWaageLive((data as WaageLiveStatus | null) ?? null);
  }, []);

  // Letzte bekannten Wägungen beim Laden/Neuladen der Seite anzeigen, ohne
  // auf die nächsten (bis zu MAX_VERLAUF) Realtime-Ereignisse warten zu
  // müssen.
  useEffect(() => {
    (async () => {
      const { data, error } = await getSupabaseClient()
        .from("ernte_kiosk_wiegung")
        .select("*")
        .in("status", ["gewogen", "ungeklaert"])
        .order("gewogen_am", { ascending: false })
        .limit(MAX_VERLAUF + 1);
      if (error) {
        setFehler(error.message);
        return;
      }
      const zeilen = (data as ErnteKioskWiegung[]) ?? [];
      if (zeilen.length > 0) {
        // Beim ersten Laden keinen Piepton/grünen Punkt für eine
        // möglicherweise schon ältere Wiegung auslösen.
        letzteIdRef.current = zeilen[0].id;
        setAktuelle(zeilen[0]);
        setVerlauf(zeilen.slice(1));
      }
    })();
    ladeZaehler();
    ladeWaageLive();
    // Netz gegen verpasste Realtime-Ereignisse und für den Mitternachts-
    // Umbruch (Vormittag/Nachmittag-Grenzen hängen vom aktuellen Tag ab).
    const intervall = setInterval(ladeZaehler, 60_000);
    const liveIntervall = setInterval(ladeWaageLive, 5000);
    return () => {
      clearInterval(intervall);
      clearInterval(liveIntervall);
    };
  }, [ladeZaehler, ladeWaageLive]);

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
        (payload) => {
          void ladeZeile((payload.new as { id: number }).id);
          void ladeZaehler();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "ernte_kiste_zyklus" },
        (payload) => {
          void ladeZeile((payload.new as { id: number }).id);
          void ladeZaehler();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ladeZeile, ladeZaehler]);

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
  const waageSekunden = waageLive?.live_aktualisiert_am
    ? Math.round((Date.now() - new Date(waageLive.live_aktualisiert_am).getTime()) / 1000)
    : null;
  const waageVerbunden = waageSekunden !== null && waageSekunden <= WAAGE_LIVE_TIMEOUT_S;

  return (
    <div className="flex min-h-[85vh] flex-col gap-6 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-emerald-900">
          <Scale className="h-6 w-6" /> Waagen-Kiosk
        </h1>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-neutral-500" title="Live-Gewicht laut Waagen-Agent, unabhängig vom Wiegen">
            <span className={`h-2.5 w-2.5 rounded-full ${waageVerbunden ? "bg-emerald-500" : "bg-beere-500"}`} />
            {waageLive?.live_gewicht_kg != null
              ? `Waage ${formatMenge(waageLive.live_gewicht_kg)} kg`
              : "Waage ohne Verbindung"}
            {waageSekunden !== null && ` · vor ${waageSekunden}s`}
          </span>
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
      </div>

      <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
        <div className="card p-3">
          <p className="text-xs text-neutral-500">Kisten Vormittag</p>
          <p className="text-2xl font-semibold text-emerald-900">{zaehler.vormittag}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-neutral-500">Kisten Nachmittag</p>
          <p className="text-2xl font-semibold text-emerald-900">{zaehler.nachmittag}</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-neutral-500">Kisten Gesamt (Waage)</p>
          <p className="text-2xl font-semibold text-emerald-900">
            {zaehler.vormittag + zaehler.nachmittag}
          </p>
        </div>
        <div className="card p-3" title="An der Maschine gescannt, noch nicht gewogen">
          <p className="text-xs text-neutral-500">Kisten im Umlauf</p>
          <p className="text-2xl font-semibold text-emerald-900">{zaehler.offen}</p>
        </div>
      </div>

      {fehler && <p className="text-sm text-beere-700">Konnte nicht laden: {fehler}</p>}

      {!aktuelle ? (
        <p className="text-lg text-neutral-500">
          Noch keine Wiegung erfasst. Läuft der Waagen-Agent und ist mit der Waage verbunden?
        </p>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2">
          <div className="card flex flex-col gap-4 p-6">
            <div className="flex items-start gap-3">
              <MitarbeiterAvatar pfad={aktuelle.mitarbeiter_foto_pfad} groesseKlasse="h-14 w-14" iconKlasse="h-6 w-6" />
              <div className="min-w-0">
                {hatMitarbeiter ? (
                  <>
                    <p className="truncate text-lg font-semibold text-emerald-900">
                      {aktuelle.mitarbeiter_vorname} {aktuelle.mitarbeiter_name}
                    </p>
                    <p className="text-xs text-neutral-500">Pers.-Nr. {aktuelle.mitarbeiter_personal_nr}</p>
                  </>
                ) : (
                  <p className="text-sm text-neutral-400">Mitarbeiter unbekannt</p>
                )}
                <p className="mt-1 text-sm text-neutral-600">
                  {hatFeld ? (
                    <>
                      {aktuelle.feld_bezeichnung}
                      {aktuelle.feld_sorte && ` · ${aktuelle.feld_sorte}`}
                    </>
                  ) : (
                    "Kein Feld zugeordnet"
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
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
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-neutral-500">Letzte Wägungen</p>
            {verlauf.length === 0 ? (
              <p className="text-sm text-neutral-400">Noch keine weiteren Wägungen.</p>
            ) : (
              verlauf.map((w) => <VerlaufKachel key={w.id} wiegung={w} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
