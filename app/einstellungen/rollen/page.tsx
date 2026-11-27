"use client";

// Einstellungen → Rollen (nur Administrator). Rollen selbst zusammenstellen
// (Nutzer-Vorgabe 2026-11-27): je Funktion aus dem Rechte-Katalog "kein
// Zugriff" / "lesen" / "lesen & schreiben", dazu die Geschäftsbereiche
// (Landwirtschaft / Vertrieb) der Rolle. Rechte gelten nur in den Bereichen
// der Rolle; hat ein Nutzer mehrere Rollen, addieren sich die Rechte - je
// Rolle in ihren eigenen Bereichen.
//
// Die Datenbank prüft alles selbst (Tabelle rolle: nur Administrator darf
// ändern, Rechte müssen im Katalog stehen, Administrator-Rolle ist fest,
// vergebene Rollen lassen sich nicht löschen). Änderungen wirken sofort für
// alle Nutzer der Rolle (profil_rechte wird per Trigger neu berechnet) und
// landen im Änderungsprotokoll.

import PageHeader from "@/components/PageHeader";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import {
  ChevronDown,
  Copy,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { useBereiche } from "@/lib/useBereiche";
import { useRollen } from "@/lib/useRollen";
import { istAdmin as istAdminProfil } from "@/lib/rollen";
import type { RechtKatalogEintrag, Rolle } from "@/lib/types";

type Stufe = "" | "L" | "S";

interface Entwurf {
  id: string | null; // null = neue Rolle
  bezeichnung: string;
  beschreibung: string;
  rechte: Record<string, "L" | "S">;
  alle_rechte: boolean;
  bereiche: string[];
}

function entwurfAus(r: Rolle): Entwurf {
  return {
    id: r.id,
    bezeichnung: r.bezeichnung,
    beschreibung: r.beschreibung ?? "",
    rechte: { ...(r.rechte ?? {}) },
    alle_rechte: r.alle_rechte,
    bereiche: [...(r.bereiche ?? [])],
  };
}

// Schlüssel aus der Bezeichnung: klein, ohne Umlaute/Sonderzeichen.
function schluesselAus(text: string, vergeben: Set<string>): string {
  const basis =
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "rolle";
  let id = basis;
  let i = 2;
  while (vergeben.has(id)) id = `${basis}_${i++}`;
  return id;
}

// Inhaltlich vergleichen: die Datenbank speichert die Rechte (jsonb) in
// eigener Schlüssel-Reihenfolge - die darf nicht als Änderung zählen.
function normal(e: Entwurf) {
  return JSON.stringify({
    bezeichnung: e.bezeichnung.trim(),
    beschreibung: e.beschreibung.trim(),
    alle_rechte: e.alle_rechte,
    rechte: e.alle_rechte ? [] : Object.entries(e.rechte).sort(([a], [b]) => a.localeCompare(b)),
    bereiche: [...e.bereiche].sort(),
  });
}

function gleich(a: Entwurf, b: Entwurf): boolean {
  return normal(a) === normal(b);
}

const STUFEN: { wert: Stufe; label: string; kurz: string }[] = [
  { wert: "", label: "Kein Zugriff", kurz: "–" },
  { wert: "L", label: "Lesen", kurz: "Lesen" },
  { wert: "S", label: "Lesen & schreiben", kurz: "Schreiben" },
];

function StufenWahl({
  wert,
  nurLesen,
  sonder,
  onChange,
  disabled,
  name,
}: {
  wert: Stufe;
  nurLesen?: boolean;
  // Sonderrecht: nur "–" / "Erlaubt" (gespeichert als S)
  sonder?: boolean;
  onChange: (s: Stufe) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex shrink-0 overflow-hidden rounded-lg border border-linie text-xs">
      {(sonder
        ? [STUFEN[0], { wert: "S" as Stufe, label: "Erlaubt", kurz: "Erlaubt" }]
        : STUFEN.filter((s) => !(nurLesen && s.wert === "S"))
      ).map((s) => {
        const an = wert === s.wert;
        const farbe =
          s.wert === "S"
            ? "bg-emerald-600 text-white"
            : s.wert === "L"
              ? "bg-sky-100 text-sky-800"
              : "bg-neutral-100 text-neutral-600";
        return (
          <button
            key={s.wert}
            type="button"
            role="radio"
            aria-checked={an}
            disabled={disabled}
            onClick={() => onChange(s.wert)}
            title={s.label}
            className={`px-2.5 py-1.5 font-medium transition first:rounded-l-lg last:rounded-r-lg disabled:cursor-not-allowed ${
              an ? farbe : "bg-white text-neutral-500 hover:bg-neutral-50"
            } border-l border-linie first:border-l-0`}
          >
            {s.kurz}
          </button>
        );
      })}
    </div>
  );
}

export default function RollenPage() {
  const { profile } = useProfile();
  const istAdmin = istAdminProfil(profile);
  const bereiche = useBereiche(profile);
  const { rollen, neuLaden } = useRollen(istAdmin);

  const [katalog, setKatalog] = useState<RechtKatalogEintrag[]>([]);
  const [nutzerJeRolle, setNutzerJeRolle] = useState<Record<string, string[]>>({});
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [zugeklappt, setZugeklappt] = useState<Set<string>>(new Set());
  const [speichert, setSpeichert] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [loeschenFrage, setLoeschenFrage] = useState(false);

  const ladeRest = useCallback(async () => {
    const sb = getSupabaseClient();
    const [k, p] = await Promise.all([
      sb.from("recht_katalog").select("*").order("sortierung"),
      sb.from("profiles").select("full_name, rollen, aktiv").order("full_name"),
    ]);
    setKatalog((k.data as RechtKatalogEintrag[]) ?? []);
    const je: Record<string, string[]> = {};
    for (const n of (p.data as { full_name: string; rollen: string[]; aktiv: boolean }[]) ?? []) {
      if (!n.aktiv) continue;
      for (const r of n.rollen ?? []) (je[r] ??= []).push(n.full_name);
    }
    setNutzerJeRolle(je);
  }, []);

  useEffect(() => {
    if (istAdmin) ladeRest();
  }, [istAdmin, ladeRest]);

  // Erste Rolle vorwählen
  useEffect(() => {
    if (!auswahl && rollen.length > 0) {
      setAuswahl(rollen[0].id);
      setEntwurf(entwurfAus(rollen[0]));
    }
  }, [rollen, auswahl]);

  const gewaehlteRolle = rollen.find((r) => r.id === auswahl) ?? null;
  const original = gewaehlteRolle ? entwurfAus(gewaehlteRolle) : null;
  const geaendert = !!entwurf && (entwurf.id === null || !original || !gleich(entwurf, original));
  const fest = !!gewaehlteRolle?.system_admin && entwurf?.id !== null;

  const module = useMemo(() => {
    const m: { name: string; eintraege: RechtKatalogEintrag[] }[] = [];
    for (const e of katalog) {
      let g = m.find((x) => x.name === e.modul);
      if (!g) m.push((g = { name: e.modul, eintraege: [] }));
      g.eintraege.push(e);
    }
    return m;
  }, [katalog]);

  function waehlen(r: Rolle) {
    if (geaendert && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setAuswahl(r.id);
    setEntwurf(entwurfAus(r));
    setMeldung(null);
    setLoeschenFrage(false);
  }

  function neu(vorlage?: Entwurf) {
    if (geaendert && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setEntwurf({
      id: null,
      bezeichnung: vorlage ? `${vorlage.bezeichnung} (Kopie)` : "",
      beschreibung: vorlage?.beschreibung ?? "",
      rechte: vorlage ? { ...vorlage.rechte } : {},
      alle_rechte: vorlage?.alle_rechte ?? false,
      bereiche: vorlage ? [...vorlage.bereiche] : ["LW"],
    });
    setMeldung(null);
    setLoeschenFrage(false);
  }

  function stufeSetzen(id: string, s: Stufe) {
    setEntwurf((e) => {
      if (!e) return e;
      const rechte = { ...e.rechte };
      if (s) rechte[id] = s;
      else delete rechte[id];
      return { ...e, rechte };
    });
  }

  function modulSetzen(eintraege: RechtKatalogEintrag[], s: Stufe) {
    setEntwurf((e) => {
      if (!e) return e;
      const rechte = { ...e.rechte };
      for (const k of eintraege) {
        const ziel: Stufe = s === "S" && k.nur_lesen ? "L" : s;
        if (ziel) rechte[k.id] = ziel;
        else delete rechte[k.id];
      }
      return { ...e, rechte };
    });
  }

  async function speichern() {
    if (!entwurf) return;
    const bez = entwurf.bezeichnung.trim();
    if (!bez) {
      setMeldung({ ok: false, text: "Bitte eine Bezeichnung eingeben." });
      return;
    }
    if (entwurf.bereiche.length === 0) {
      setMeldung({ ok: false, text: "Bitte mindestens einen Bereich wählen." });
      return;
    }
    setSpeichert(true);
    setMeldung(null);
    const sb = getSupabaseClient();
    const daten = {
      bezeichnung: bez,
      beschreibung: entwurf.beschreibung.trim(),
      rechte: entwurf.alle_rechte ? {} : entwurf.rechte,
      alle_rechte: entwurf.alle_rechte,
      bereiche: entwurf.bereiche,
    };
    let id = entwurf.id;
    let fehler: string | null = null;
    if (id === null) {
      id = schluesselAus(bez, new Set(rollen.map((r) => r.id)));
      const sortierung = Math.max(0, ...rollen.map((r) => r.sortierung)) + 1;
      const { error } = await sb.from("rolle").insert({ id, sortierung, ...daten });
      fehler = error?.message ?? null;
    } else {
      const { error } = await sb.from("rolle").update(daten).eq("id", id);
      fehler = error?.message ?? null;
    }
    setSpeichert(false);
    if (fehler) {
      setMeldung({
        ok: false,
        text: fehler.includes("duplicate") ? "Diese Bezeichnung gibt es schon." : fehler,
      });
      return;
    }
    const frisch = (await neuLaden()).find((r) => r.id === id);
    setAuswahl(id);
    setEntwurf(frisch ? entwurfAus(frisch) : { ...entwurf, id, bezeichnung: bez, beschreibung: entwurf.beschreibung.trim() });
    setMeldung({ ok: true, text: "Gespeichert. Die Rechte gelten sofort für alle Nutzer dieser Rolle." });
  }

  async function loeschen() {
    if (!entwurf?.id) return;
    const { error } = await getSupabaseClient().from("rolle").delete().eq("id", entwurf.id);
    setLoeschenFrage(false);
    if (error) {
      setMeldung({ ok: false, text: error.message });
      return;
    }
    await neuLaden();
    setAuswahl(null);
    setEntwurf(null);
    setMeldung({ ok: true, text: "Rolle gelöscht." });
  }

  if (!istAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <EinstellungenTabs />
        <PageHeader icon={ShieldCheck} titel="Rollen" />
        <p className="text-sm text-neutral-500">Nur Administratoren dürfen Rollen bearbeiten.</p>
      </div>
    );
  }

  const nutzerDerRolle = entwurf?.id ? nutzerJeRolle[entwurf.id] ?? [] : [];
  const anzahlRechte = (e: Entwurf) => Object.keys(e.rechte).length;

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <PageHeader
        icon={ShieldCheck}
        titel="Rollen"
        beschreibung="Je Funktion festlegen, was eine Rolle darf. Rechte gelten nur in den Bereichen der Rolle. Wer mehrere Rollen hat, darf alles, was eine seiner Rollen darf."
      />

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Rollenliste */}
        <aside className="flex min-w-0 flex-col gap-2">
          <button type="button" className="btn" onClick={() => neu()}>
            <Plus className="h-4 w-4" />
            Neue Rolle
          </button>
          <ul className="flex flex-col gap-1.5">
            {rollen.map((r) => {
              const an = r.id === auswahl && entwurf?.id !== null;
              const n = nutzerJeRolle[r.id]?.length ?? 0;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => waehlen(r)}
                    className={`flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition ${
                      an ? "border-emerald-400 bg-emerald-50" : "border-linie bg-white hover:border-emerald-300"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
                      {r.system_admin && <Lock className="h-3.5 w-3.5 text-neutral-400" />}
                      {r.bezeichnung}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                      {(r.system_admin ? bereiche.alle.map((b) => b.kuerzel) : r.bereiche).map((b) => (
                        <span key={b} className="rounded bg-neutral-100 px-1.5 py-0.5 font-medium text-neutral-600">
                          {b}
                        </span>
                      ))}
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {n}
                      </span>
                      <span>
                        · {r.alle_rechte ? "alle Rechte" : `${Object.keys(r.rechte ?? {}).length} Funktionen`}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {entwurf?.id === null && (
              <li className="rounded-xl border border-dashed border-emerald-400 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800">
                {entwurf.bezeichnung || "Neue Rolle"} (noch nicht gespeichert)
              </li>
            )}
          </ul>
        </aside>

        {/* Editor */}
        {entwurf && (
          <section className="flex min-w-0 flex-col gap-4">
            <div className="rounded-xl border border-linie bg-white p-5 shadow-card">
              {fest && (
                <p className="mb-3 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
                  <Lock className="h-4 w-4" />
                  Der Administrator darf immer alles und lässt sich nicht ändern.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm">
                  Bezeichnung
                  <input
                    id="rolle-bezeichnung"
                    className="mt-1 block w-full"
                    value={entwurf.bezeichnung}
                    disabled={fest}
                    onChange={(e) => setEntwurf({ ...entwurf, bezeichnung: e.target.value })}
                    placeholder="z.B. Büro Vertrieb"
                  />
                </label>
                <fieldset className="text-sm">
                  <legend>Bereiche</legend>
                  <div className="mt-2 flex flex-wrap gap-4">
                    {bereiche.alle.map((b) => (
                      <label key={b.kuerzel} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          disabled={fest}
                          checked={fest || entwurf.bereiche.includes(b.kuerzel)}
                          onChange={(e) =>
                            setEntwurf({
                              ...entwurf,
                              bereiche: bereiche.alle
                                .map((x) => x.kuerzel)
                                .filter((k) => (k === b.kuerzel ? e.target.checked : entwurf.bereiche.includes(k))),
                            })
                          }
                        />
                        {b.bezeichnung}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="text-sm sm:col-span-2">
                  Beschreibung
                  <textarea
                    id="rolle-beschreibung"
                    className="mt-1 block w-full"
                    rows={2}
                    disabled={fest}
                    value={entwurf.beschreibung}
                    onChange={(e) => setEntwurf({ ...entwurf, beschreibung: e.target.value })}
                    placeholder="Wofür ist die Rolle gedacht?"
                  />
                </label>
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    disabled={fest}
                    checked={entwurf.alle_rechte}
                    onChange={(e) => setEntwurf({ ...entwurf, alle_rechte: e.target.checked })}
                  />
                  <span>
                    <span className="font-medium">Alle Rechte</span>
                    <span className="block text-neutral-500">
                      Lesen & schreiben in allen Funktionen, auch in künftig neuen - außer Nutzer und Rollen
                      verwalten und Änderungsvorschläge (die bleiben beim Administrator).
                    </span>
                  </span>
                </label>
              </div>

              {entwurf.id && (
                <p className="mt-4 text-xs text-neutral-500">
                  {nutzerDerRolle.length === 0
                    ? "Noch keinem Nutzer zugewiesen."
                    : `Zugewiesen: ${nutzerDerRolle.join(", ")}`}
                </p>
              )}
            </div>

            {!entwurf.alle_rechte && !fest && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                    Funktionen · {anzahlRechte(entwurf)} von {katalog.length} freigegeben
                  </h2>
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="text-emerald-700 hover:underline" onClick={() => setZugeklappt(new Set())}>
                      Alle aufklappen
                    </button>
                    <button
                      type="button"
                      className="text-emerald-700 hover:underline"
                      onClick={() => setZugeklappt(new Set(module.map((m) => m.name)))}
                    >
                      Alle zuklappen
                    </button>
                  </div>
                </div>
                {module.map((m) => {
                  const zu = zugeklappt.has(m.name);
                  const frei = m.eintraege.filter((e) => entwurf.rechte[e.id]).length;
                  return (
                    <div key={m.name} className="min-w-0 rounded-xl border border-linie bg-white shadow-card">
                      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          aria-expanded={!zu}
                          onClick={() =>
                            setZugeklappt((s) => {
                              const n = new Set(s);
                              if (n.has(m.name)) n.delete(m.name);
                              else n.add(m.name);
                              return n;
                            })
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition ${zu ? "-rotate-90" : ""}`} />
                          <span className="font-semibold text-neutral-900">{m.name}</span>
                          <span className="whitespace-nowrap text-xs text-neutral-500">
                            {frei} / {m.eintraege.length}
                          </span>
                        </button>
                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                          <span className="hidden sm:inline">Alle:</span>
                          <StufenWahl
                            name={`${m.name}: alle Funktionen`}
                            wert={
                              m.eintraege.every((e) => !entwurf.rechte[e.id])
                                ? ""
                                : m.eintraege.every((e) => entwurf.rechte[e.id] === "S" || (e.nur_lesen && entwurf.rechte[e.id] === "L"))
                                  ? "S"
                                  : m.eintraege.every((e) => entwurf.rechte[e.id] === "L")
                                    ? "L"
                                    : ("x" as Stufe)
                            }
                            sonder={m.eintraege.every((e) => e.id.startsWith("sonder."))}
                            onChange={(s) => modulSetzen(m.eintraege, s)}
                          />
                        </div>
                      </div>
                      {!zu && (
                        <ul className="divide-y divide-linie border-t border-linie">
                          {m.eintraege.map((e) => (
                            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:pl-10">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 text-sm text-neutral-900">
                                  {e.titel}
                                  {e.sensibel && (
                                    <span className="rounded-full bg-beere-50 px-2 py-0.5 text-[11px] font-semibold text-beere-700">
                                      sensibel
                                    </span>
                                  )}
                                </div>
                                {e.unter && <div className="text-xs text-neutral-500">{e.unter}</div>}
                              </div>
                              <StufenWahl
                                name={e.titel}
                                wert={(entwurf.rechte[e.id] ?? "") as Stufe}
                                nurLesen={e.nur_lesen}
                                sonder={e.id.startsWith("sonder.")}
                                onChange={(s) => stufeSetzen(e.id, s)}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Aktionen */}
            {!fest && (
              <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-linie bg-sand/95 px-1 py-3 backdrop-blur">
                <button type="button" className="btn" disabled={speichert || !geaendert} onClick={speichern}>
                  <Save className="h-4 w-4" />
                  {speichert ? "Speichert…" : entwurf.id === null ? "Rolle anlegen" : "Speichern"}
                </button>
                {entwurf.id !== null && (
                  <button type="button" className="btn-secondary" onClick={() => neu(entwurf)}>
                    <Copy className="h-4 w-4" />
                    Kopieren
                  </button>
                )}
                {entwurf.id === null && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const r = rollen.find((x) => x.id === auswahl);
                      setEntwurf(r ? entwurfAus(r) : null);
                    }}
                  >
                    Verwerfen
                  </button>
                )}
                {entwurf.id !== null &&
                  (loeschenFrage ? (
                    <span className="flex items-center gap-2 text-sm">
                      Rolle wirklich löschen?
                      <button type="button" className="btn-secondary text-beere-700" onClick={loeschen}>
                        Ja, löschen
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setLoeschenFrage(false)}>
                        Nein
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={nutzerDerRolle.length > 0}
                      title={nutzerDerRolle.length > 0 ? "Erst allen Nutzern diese Rolle abnehmen" : "Rolle löschen"}
                      onClick={() => setLoeschenFrage(true)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Löschen
                    </button>
                  ))}
                {geaendert && !speichert && <span className="text-sm text-amber-700">Ungespeicherte Änderungen</span>}
                {meldung && (
                  <span className={`text-sm ${meldung.ok ? "text-emerald-700" : "text-beere-700"}`}>{meldung.text}</span>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
