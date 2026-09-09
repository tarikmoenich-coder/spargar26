"use client";

// Qualität - Schichtkontrolle Halle (Nutzer-Vorgabe 2026-09-09). Vom Handy in
// der Halle: "Jetzt mache ich die Schichtkontrolle" -> fertige Kiste nehmen,
// 20 Kolben prüfen, Ergebnis (i.O. von 20) + Foto + optional Notiz eintragen.
// Mehrere Kontrollen pro Tag möglich, jede mit Datum + Uhrzeit. Ergebnis
// erscheint auch in /statistik/zuckermais. Tabelle qs_kontrolle
// (kulturneutral, hier fest kultur = 'zuckermais').

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import { formatDatumDE } from "@/lib/format";
import { MENUE_RECHTE } from "@/lib/rollen";
import type { QsKontrolle, QsSchicht, UserRole } from "@/lib/types";

const KULTUR = "zuckermais";
const STANDARD_KOLBEN = 20;

function heuteIso() {
  return new Date().toISOString().slice(0, 10);
}
function jetztHhmm() {
  return new Date().toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function vorTagen(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function uhrzeit(iso: string) {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
// Schicht automatisch aus der Uhrzeit: ab 14:00 Nachmittag, davor Vormittag.
function schichtAusZeit(hhmm: string): QsSchicht {
  const stunde = Number((hhmm || "").slice(0, 2));
  return Number.isFinite(stunde) && stunde >= 14 ? "nachmittag" : "vormittag";
}

function quote(io: number, gesamt: number): number | null {
  return gesamt > 0 ? Math.round((io / gesamt) * 1000) / 10 : null;
}
function quoteKlasse(q: number | null): string {
  if (q === null) return "badge badge-neutral";
  if (q >= 95) return "badge badge-ok";
  if (q >= 85) return "badge badge-warn";
  return "badge badge-danger";
}

// Foto client-seitig verkleinern (JPEG-data-URL). Größer als beim
// Fahrzeugfoto (Defekte am Kolben müssen erkennbar sein), aber klein genug
// für eine Textspalte.
function fotoVerkleinern(datei: File, maxKante = 900, qualitaet = 0.62): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const skala = Math.min(1, maxKante / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * skala));
      const h = Math.max(1, Math.round(img.height * skala));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("Canvas nicht verfügbar."));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", qualitaet));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht gelesen werden."));
    };
    img.src = url;
  });
}

export default function QualitaetPage() {
  const { profile } = useProfile();
  const canSee =
    !!profile &&
    (MENUE_RECHTE["/qualitaet"] ?? []).includes(profile.role as UserRole);
  const canWrite =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "zeiterfassung" ||
    profile?.role === "erntewirtschaft";
  const canDelete =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "erntewirtschaft";

  // --- Formular ---
  const [datum, setDatum] = useState(heuteIso());
  const [zeit, setZeit] = useState(jetztHhmm());
  // Standardmäßig aus der Uhrzeit abgeleitet; per Knopf überschreibbar.
  const [schicht, setSchicht] = useState<QsSchicht>(() =>
    schichtAusZeit(jetztHhmm())
  );
  const [kolbenGesamt, setKolbenGesamt] = useState(STANDARD_KOLBEN);
  // Startwert = alle i.O.; runterkorrigiert wird vorrangig mit „−".
  const [kolbenIo, setKolbenIo] = useState<number>(STANDARD_KOLBEN);
  const [notiz, setNotiz] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoLaeuft, setFotoLaeuft] = useState(false);
  const [speichern, setSpeichern] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const fotoInput = useRef<HTMLInputElement>(null);

  // --- Liste ---
  const [ab, setAb] = useState(vorTagen(14));
  const [liste, setListe] = useState<QsKontrolle[]>([]);
  const [listeLaeuft, setListeLaeuft] = useState(true);
  const [grossesFoto, setGrossesFoto] = useState<string | null>(null);

  async function ladeListe() {
    setListeLaeuft(true);
    const { data } = await getSupabaseClient()
      .from("qs_kontrolle")
      .select("*")
      .eq("kultur", KULTUR)
      .gte("datum", ab)
      .order("zeitpunkt", { ascending: false });
    setListe((data as QsKontrolle[]) ?? []);
    setListeLaeuft(false);
  }

  useEffect(() => {
    ladeListe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ab]);

  async function fotoGewaehlt(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    if (!datei) return;
    setFotoLaeuft(true);
    setFehler(null);
    try {
      setFoto(await fotoVerkleinern(datei));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Foto fehlgeschlagen.");
    } finally {
      setFotoLaeuft(false);
      if (fotoInput.current) fotoInput.current.value = "";
    }
  }

  function formularZuruecksetzen() {
    const jetzt = jetztHhmm();
    setZeit(jetzt);
    setSchicht(schichtAusZeit(jetzt));
    setKolbenIo(kolbenGesamt);
    setNotiz("");
    setFoto(null);
    // datum und kolbenGesamt bewusst stehen lassen.
  }

  async function speichernKontrolle() {
    const io = kolbenIo;
    if (!Number.isFinite(io) || io < 0 || io > kolbenGesamt) {
      setFehler(`Bitte i.O.-Kolben zwischen 0 und ${kolbenGesamt} eintragen.`);
      return;
    }
    if (!foto && !window.confirm("Ohne Foto speichern?")) return;

    setSpeichern(true);
    setFehler(null);
    const zeitpunkt = new Date(`${datum}T${zeit || "00:00"}:00`).toISOString();
    const { error } = await getSupabaseClient().from("qs_kontrolle").insert({
      kultur: KULTUR,
      datum,
      zeitpunkt,
      schicht,
      kolben_gesamt: kolbenGesamt,
      kolben_io: io,
      fehler_notiz: notiz.trim() || null,
      foto,
      erfasst_von: profile?.id ?? null,
    });
    setSpeichern(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    formularZuruecksetzen();
    ladeListe();
  }

  async function loeschen(k: QsKontrolle) {
    if (
      !window.confirm(
        `Kontrolle vom ${formatDatumDE(k.datum)} ${uhrzeit(k.zeitpunkt)} löschen?`
      )
    )
      return;
    const { error } = await getSupabaseClient()
      .from("qs_kontrolle")
      .delete()
      .eq("id", k.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    ladeListe();
  }

  const vorschau = quote(kolbenIo, kolbenGesamt);

  const heuteZusammenfassung = useMemo(() => {
    const heute = liste.filter((k) => k.datum === heuteIso());
    if (heute.length === 0) return null;
    const io = heute.reduce((s, k) => s + k.kolben_io, 0);
    const g = heute.reduce((s, k) => s + k.kolben_gesamt, 0);
    const einzel = heute
      .map((k) => quote(k.kolben_io, k.kolben_gesamt))
      .filter((q): q is number => q !== null);
    return {
      anzahl: heute.length,
      quote: quote(io, g),
      schlechteste: einzel.length ? Math.min(...einzel) : null,
    };
  }, [liste]);

  if (profile && !canSee) {
    return (
      <div className="flex flex-col gap-4">
        <ErntewirtschaftTabs />
        <p className="text-neutral-500">
          Die Schichtkontrolle ist nur für admin/hr/zeiterfassung/
          lohnabrechnung/management/erntewirtschaft.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Qualität – Schichtkontrolle Halle
        </h1>
        <p className="text-sm text-neutral-500">
          Fertige Kiste nehmen, {STANDARD_KOLBEN} Kolben prüfen, Ergebnis und
          Foto eintragen. Mehrere Kontrollen pro Tag möglich. Fließt in die
          Statistik (Erntewirtschaft → Statistik → Zuckermais).
        </p>
      </div>

      {heuteZusammenfassung && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-linie bg-white px-3 py-2 text-sm">
          <span className="font-medium">Heute:</span>
          <span>{heuteZusammenfassung.anzahl} Kontrolle(n)</span>
          <span className={quoteKlasse(heuteZusammenfassung.quote)}>
            Ø {heuteZusammenfassung.quote ?? "—"} %
          </span>
          {heuteZusammenfassung.schlechteste !== null && (
            <span className="text-neutral-500">
              schlechteste {heuteZusammenfassung.schlechteste} %
            </span>
          )}
        </div>
      )}

      {canWrite && (
        <div className="flex flex-col gap-3 rounded-lg border border-linie bg-white p-4">
          <h2 className="text-sm font-semibold text-emerald-800">
            Neue Schichtkontrolle
          </h2>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Datum
              <input
                type="date"
                className="mt-1 w-full"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
              />
            </label>
            <label className="text-sm">
              Uhrzeit
              <input
                type="time"
                className="mt-1 w-full"
                value={zeit}
                onChange={(e) => {
                  setZeit(e.target.value);
                  setSchicht(schichtAusZeit(e.target.value));
                }}
              />
            </label>
          </div>

          <div className="text-sm">
            Schicht{" "}
            <span className="text-xs text-neutral-400">
              (automatisch aus der Uhrzeit, ab 14:00 Nachmittag)
            </span>
            <div className="mt-1 flex gap-2">
              {([
                ["vormittag", "Vormittag"],
                ["nachmittag", "Nachmittag"],
              ] as [QsSchicht, string][]).map(([wert, label]) => (
                <button
                  key={wert}
                  type="button"
                  onClick={() => setSchicht(wert)}
                  className={
                    schicht === wert
                      ? "rounded border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-sm text-white"
                      : "rounded border border-linie bg-white px-3 py-1.5 text-sm text-neutral-700"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="text-sm">
            i.O.-Kolben{" "}
            <span className="text-xs text-neutral-400">
              (Start = alle i.O., mit „−" runterkorrigieren)
            </span>
            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                aria-label="einen weniger"
                className="btn-secondary h-11 w-11 text-xl"
                onClick={() => setKolbenIo((v) => Math.max(0, v - 1))}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={kolbenGesamt}
                className="w-20 text-center text-lg"
                value={kolbenIo}
                onChange={(e) =>
                  setKolbenIo(
                    Math.max(
                      0,
                      Math.min(kolbenGesamt, Number(e.target.value) || 0)
                    )
                  )
                }
              />
              <button
                type="button"
                aria-label="einen mehr"
                className="btn-secondary h-11 w-11 text-xl"
                onClick={() => setKolbenIo((v) => Math.min(kolbenGesamt, v + 1))}
              >
                +
              </button>
              <span className="text-neutral-500">
                von{" "}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={200}
                  className="w-16 text-center"
                  value={kolbenGesamt}
                  onChange={(e) => {
                    const g = Math.max(1, Number(e.target.value) || 1);
                    setKolbenGesamt(g);
                    setKolbenIo((v) => Math.min(v, g));
                  }}
                />{" "}
                Kolben
              </span>
              {vorschau !== null && (
                <span className={quoteKlasse(vorschau)}>{vorschau} %</span>
              )}
            </div>
          </div>

          <label className="text-sm">
            Notiz (optional)
            <textarea
              className="mt-1 w-full"
              rows={2}
              placeholder="Was war nicht i.O.? z.B. K1 Fäden, N1 Spitze offen …"
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
            />
          </label>

          <div className="text-sm">
            Foto
            <div className="mt-1 flex items-center gap-3">
              <input
                ref={fotoInput}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={fotoGewaehlt}
              />
              {fotoLaeuft && (
                <span className="text-xs text-neutral-500">verkleinere…</span>
              )}
              {foto && (
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setFoto(null)}
                >
                  Foto entfernen
                </button>
              )}
            </div>
            {foto && (
              <img
                src={foto}
                alt="Kontrollfoto"
                className="mt-2 max-h-48 rounded border border-linie"
              />
            )}
          </div>

          {fehler && (
            <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              ⚠ {fehler}
            </p>
          )}

          <div>
            <button
              type="button"
              className="btn"
              disabled={speichern || fotoLaeuft}
              onClick={speichernKontrolle}
            >
              {speichern ? "Speichert…" : "Kontrolle speichern"}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <h2 className="font-semibold text-emerald-800">Kontrollen</h2>
          <label>
            ab{" "}
            <input
              type="date"
              value={ab}
              onChange={(e) => setAb(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => setAb(heuteIso())}
          >
            nur heute
          </button>
        </div>

        {listeLaeuft ? (
          <p className="text-sm text-neutral-500">Lädt…</p>
        ) : liste.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Keine Kontrollen im gewählten Zeitraum.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {liste.map((k) => {
              const q = quote(k.kolben_io, k.kolben_gesamt);
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-linie bg-white p-3"
                >
                  {k.foto && (
                    <button
                      type="button"
                      onClick={() => setGrossesFoto(k.foto)}
                      className="shrink-0"
                    >
                      <img
                        src={k.foto}
                        alt=""
                        className="h-14 w-14 rounded border border-linie object-cover"
                      />
                    </button>
                  )}
                  <div className="min-w-[8rem]">
                    <div className="text-sm font-medium">
                      {formatDatumDE(k.datum)} · {uhrzeit(k.zeitpunkt)}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {k.schicht
                        ? k.schicht === "vormittag"
                          ? "Vormittag"
                          : "Nachmittag"
                        : "—"}
                    </div>
                  </div>
                  <span className={quoteKlasse(q)}>
                    {k.kolben_io}/{k.kolben_gesamt} i.O. · {q ?? "—"} %
                  </span>
                  {k.fehler_notiz && (
                    <span className="text-sm text-neutral-600">
                      {k.fehler_notiz}
                    </span>
                  )}
                  <span className="grow" />
                  {canDelete && (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => loeschen(k)}
                    >
                      Löschen
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {grossesFoto && (
        <button
          type="button"
          onClick={() => setGrossesFoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          aria-label="Foto schließen"
        >
          <img
            src={grossesFoto}
            alt="Kontrollfoto groß"
            className="max-h-full max-w-full rounded"
          />
        </button>
      )}
    </div>
  );
}
