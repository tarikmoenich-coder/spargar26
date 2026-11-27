"use client";

// Spargelprämien Stufe 2 (docs/spargel-praemien-konzept.md, Abschnitt 1 + 3):
// - KategorienPflege: Preis je kg je Kategorie und Saison, Standard-Kategorie
//   je Feld, neue Saison aus der vorherigen übernehmen.
// - KategorienFestlegen: je Tag die wirksame Kategorie jedes Feldes (mit
//   Herkunft) und Festlegungen für alle Felder / je Feld / je Person.
// Ändern nur mit Sonderrecht "Spargel-Kategorien festlegen" (Geschäftsführung);
// die Datenbank prüft das selbst (RLS) und lehnt unbekannte Kategorien ab.
// Abgerechnete Tage (z.B. 2026) behalten ihren festgeschriebenen Preis.

import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { formatDatumDE, formatMenge } from "@/lib/format";

interface Kat {
  saison_jahr: number;
  kategorie: number;
  preis_kg: number;
}
interface FeldKat {
  saison_jahr: number;
  feld_id: number;
  kategorie: number;
}
interface FeldAm {
  feld_id: number;
  feld: string;
  kultur: string | null;
  kategorie: number | null;
  herkunft: string;
  herkunft_datum: string | null;
}
interface Festlegung {
  id: number;
  datum: string;
  feld_id: number | null;
  employee_id: string | null;
  kategorie: number;
}

// Preis mit 3 Nachkommastellen, wenn nötig (0,975 €)
const preisText = (p: number) => formatMenge(Number(p), Math.round(Number(p) * 1000) % 10 ? 3 : 2) + " €";

const katText = (k: number | null | undefined) =>
  k === null || k === undefined ? "—" : formatMenge(Number(k), Number(k) % 1 ? 1 : 0);

function KatAuswahl({
  wert,
  kategorien,
  onChange,
  leer = "—",
  disabled,
  label,
}: {
  wert: number | null;
  kategorien: number[];
  onChange: (k: number | null) => void;
  leer?: string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      disabled={disabled}
      value={wert === null ? "" : String(wert)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-24"
    >
      <option value="">{leer}</option>
      {kategorien.map((k) => (
        <option key={k} value={k}>
          {katText(k)}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
export function KategorienPflege({
  saison,
  darfAendern,
  mindestlohn,
  onSaisonAngelegt,
}: {
  saison: number;
  darfAendern: boolean;
  mindestlohn: number | null;
  onSaisonAngelegt: (jahr: number) => void;
}) {
  const sb = getSupabaseClient();
  const [kats, setKats] = useState<Kat[]>([]);
  const [feldKats, setFeldKats] = useState<FeldKat[]>([]);
  const [felder, setFelder] = useState<{ id: number; bezeichnung: string; kultur: string | null }[]>([]);
  const [neu, setNeu] = useState({ kategorie: "", preis: "" });
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  const laden = useCallback(async () => {
    const [k, fk, f] = await Promise.all([
      sb.from("spargel_kategorie").select("*").order("kategorie"),
      sb.from("spargel_feld_kategorie").select("*"),
      sb.from("feld").select("id, bezeichnung, kultur").eq("aktiv", true).in("kultur", ["spargel", "gruenspargel"]).order("bezeichnung"),
    ]);
    setKats((k.data as Kat[]) ?? []);
    setFeldKats((fk.data as FeldKat[]) ?? []);
    setFelder((f.data as { id: number; bezeichnung: string; kultur: string | null }[]) ?? []);
  }, [sb]);
  useEffect(() => {
    laden();
  }, [laden]);

  const saisonKats = kats.filter((k) => k.saison_jahr === saison);
  const jahre = Array.from(new Set(kats.map((k) => k.saison_jahr))).sort();
  const naechste = (jahre[jahre.length - 1] ?? saison) + 1;

  async function ausfuehren(p: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await p;
    setMeldung(error ? { ok: false, text: error.message } : { ok: true, text: ok });
    await laden();
    return !error;
  }

  async function saisonAnlegen() {
    const quelle = jahre[jahre.length - 1];
    const zeilen = kats.filter((k) => k.saison_jahr === quelle).map((k) => ({ ...k, saison_jahr: naechste }));
    if (await ausfuehren(sb.from("spargel_kategorie").insert(zeilen), `Saison ${naechste} mit den Kategorien von ${quelle} angelegt.`))
      onSaisonAngelegt(naechste);
  }

  // Standard je Feld: in dieser Saison gesetzt, sonst aus einer früheren übernommen
  const standard = (feldId: number) => {
    const eigene = feldKats.find((f) => f.feld_id === feldId && f.saison_jahr === saison);
    if (eigene) return { kategorie: eigene.kategorie, geerbt: null as number | null };
    const frueher = feldKats
      .filter((f) => f.feld_id === feldId && f.saison_jahr < saison)
      .sort((a, b) => b.saison_jahr - a.saison_jahr)[0];
    return { kategorie: frueher?.kategorie ?? null, geerbt: frueher?.saison_jahr ?? null };
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Preis je Kategorie · Saison {saison}</h2>
          {darfAendern && (
            <button type="button" className="btn-secondary" onClick={saisonAnlegen}>
              <Plus className="h-4 w-4" />
              Saison {naechste} anlegen
            </button>
          )}
        </div>
        {saisonKats.length === 0 ? (
          <p className="text-sm text-neutral-500">Für {saison} sind noch keine Kategorien angelegt.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th className="text-right">Kategorie</th>
                <th className="text-right">€ je kg</th>
                <th className="text-right">Lohnt ab (kg/h)</th>
                {darfAendern && <th />}
              </tr>
            </thead>
            <tbody>
              {saisonKats.map((k) => (
                <tr key={k.kategorie}>
                  <td className="text-right tabular-nums">{katText(k.kategorie)}</td>
                  <td className="text-right tabular-nums">
                    {darfAendern ? (
                      <input
                        aria-label={`Preis Kategorie ${katText(k.kategorie)}`}
                        className="w-24 text-right"
                        defaultValue={String(k.preis_kg).replace(".", ",")}
                        onBlur={(e) => {
                          const v = Number(e.target.value.replace(",", "."));
                          if (!Number.isFinite(v) || v < 0 || v === Number(k.preis_kg)) return;
                          ausfuehren(
                            sb.from("spargel_kategorie").update({ preis_kg: v }).eq("saison_jahr", saison).eq("kategorie", k.kategorie),
                            `Kategorie ${katText(k.kategorie)}: ${preisText(v)} je kg gespeichert.`
                          );
                        }}
                      />
                    ) : (
                      preisText(k.preis_kg)
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatMenge(k.preis_kg && mindestlohn ? mindestlohn / Number(k.preis_kg) : null, 1)}
                  </td>
                  {darfAendern && (
                    <td className="text-right">
                      <button
                        type="button"
                        title="Kategorie löschen"
                        aria-label={`Kategorie ${katText(k.kategorie)} löschen`}
                        className="text-neutral-400 hover:text-beere-700"
                        onClick={() =>
                          ausfuehren(
                            sb.from("spargel_kategorie").delete().eq("saison_jahr", saison).eq("kategorie", k.kategorie),
                            `Kategorie ${katText(k.kategorie)} gelöscht.`
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {darfAendern && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const k = Number(neu.kategorie.replace(",", "."));
              const p = Number(neu.preis.replace(",", "."));
              if (!(k > 0) || !(p >= 0)) {
                setMeldung({ ok: false, text: "Kategorie muss größer als 0 sein, Preis 0 oder mehr." });
                return;
              }
              ausfuehren(
                sb.from("spargel_kategorie").insert({ saison_jahr: saison, kategorie: k, preis_kg: p }),
                `Kategorie ${katText(k)} angelegt.`
              ).then((ok) => ok && setNeu({ kategorie: "", preis: "" }));
            }}
          >
            <label className="text-sm">
              Neue Kategorie
              <input id="neu-kategorie" className="mt-1 block w-24" value={neu.kategorie} onChange={(e) => setNeu({ ...neu, kategorie: e.target.value })} />
            </label>
            <label className="text-sm">
              € je kg
              <input id="neu-preis" className="mt-1 block w-24" value={neu.preis} onChange={(e) => setNeu({ ...neu, preis: e.target.value })} />
            </label>
            <button type="submit" className="btn">
              <Plus className="h-4 w-4" />
              Anlegen
            </button>
          </form>
        )}
        {meldung && <p className={`text-sm ${meldung.ok ? "text-emerald-700" : "text-beere-700"}`}>{meldung.text}</p>}
        <p className="text-xs text-neutral-500">
          Abgerechnete Tage behalten ihren damaligen Preis – eine Preisänderung gilt nur für noch nicht freigegebene Tage.
        </p>
      </section>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Standard-Kategorie je Feld · Saison {saison}</h2>
        <p className="text-sm text-neutral-500">
          Gilt am ersten Erntetag eines Feldes, bis eine andere Kategorie festgelegt wird. Grau = aus einer früheren Saison übernommen.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Feld</th>
                <th className="text-right">Standard</th>
              </tr>
            </thead>
            <tbody>
              {felder.map((f) => {
                const s = standard(f.id);
                return (
                  <tr key={f.id}>
                    <td>
                      {f.bezeichnung}
                      {f.kultur === "gruenspargel" && <span className="ml-1.5 text-xs text-neutral-400">Grünspargel</span>}
                    </td>
                    <td className="text-right">
                      {darfAendern ? (
                        <span className="inline-flex items-center gap-2">
                          {s.geerbt && <span className="text-xs text-neutral-400">aus {s.geerbt}</span>}
                          <KatAuswahl
                            label={`Standard ${f.bezeichnung}`}
                            wert={s.geerbt ? null : s.kategorie}
                            leer={s.geerbt ? katText(s.kategorie) : "—"}
                            kategorien={saisonKats.map((k) => Number(k.kategorie))}
                            onChange={(k) =>
                              ausfuehren(
                                k === null
                                  ? sb.from("spargel_feld_kategorie").delete().eq("saison_jahr", saison).eq("feld_id", f.id)
                                  : sb.from("spargel_feld_kategorie").upsert({ saison_jahr: saison, feld_id: f.id, kategorie: k }),
                                `${f.bezeichnung}: Standard gespeichert.`
                              )
                            }
                          />
                        </span>
                      ) : (
                        <span className={`tabular-nums ${s.geerbt ? "text-neutral-400" : ""}`}>{katText(s.kategorie)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function KategorienFestlegen({ darfAendern }: { darfAendern: boolean }) {
  const sb = getSupabaseClient();
  const [datum, setDatum] = useState(() => new Date().toISOString().slice(0, 10));
  const [felder, setFelder] = useState<FeldAm[]>([]);
  const [fest, setFest] = useState<Festlegung[]>([]);
  const [kats, setKats] = useState<number[]>([]);
  const [personen, setPersonen] = useState<{ id: string; name: string }[]>([]);
  const [neuPerson, setNeuPerson] = useState<{ employee_id: string; feld_id: string; kategorie: number | null }>({
    employee_id: "",
    feld_id: "",
    kategorie: null,
  });
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const jahr = Number(datum.slice(0, 4));

  const laden = useCallback(async () => {
    const [f, t, k] = await Promise.all([
      sb.rpc("spargel_kategorien_am", { p_datum: datum }),
      sb.from("spargel_kategorie_tag").select("*").eq("datum", datum),
      sb.from("spargel_kategorie").select("kategorie").eq("saison_jahr", jahr).order("kategorie"),
    ]);
    setFelder((f.data as FeldAm[]) ?? []);
    setFest((t.data as Festlegung[]) ?? []);
    setKats(((k.data as { kategorie: number }[]) ?? []).map((x) => Number(x.kategorie)));
  }, [sb, datum, jahr]);
  useEffect(() => {
    laden();
  }, [laden]);
  useEffect(() => {
    ladeAlleSeiten<{ id: string; name: string; vorname: string }>((von, bis) =>
      sb.from("employees").select("id, name, vorname").eq("praemien_spargel", true).order("name").range(von, bis)
    ).then((e) => setPersonen(e.map((x) => ({ id: x.id, name: `${x.name}, ${x.vorname}` }))));
  }, [sb]);

  const alle = fest.find((f) => f.feld_id === null && f.employee_id === null) ?? null;
  const personFest = fest.filter((f) => f.employee_id !== null);
  const feldName = useMemo(() => Object.fromEntries(felder.map((f) => [f.feld_id, f.feld])), [felder]);
  const personName = useMemo(() => Object.fromEntries(personen.map((p) => [p.id, p.name])), [personen]);

  async function setzen(feldId: number | null, employeeId: string | null, kategorie: number | null) {
    const vorhanden = fest.find((f) => f.feld_id === feldId && f.employee_id === employeeId);
    let error: { message: string } | null = null;
    if (kategorie === null) {
      if (vorhanden) ({ error } = await sb.from("spargel_kategorie_tag").delete().eq("id", vorhanden.id));
    } else if (vorhanden) {
      ({ error } = await sb.from("spargel_kategorie_tag").update({ kategorie }).eq("id", vorhanden.id));
    } else {
      ({ error } = await sb.from("spargel_kategorie_tag").insert({ datum, feld_id: feldId, employee_id: employeeId, kategorie }));
    }
    setMeldung(error ? { ok: false, text: error.message } : { ok: true, text: "Gespeichert." });
    await laden();
  }

  const herkunft = (f: FeldAm) =>
    f.herkunft === "übernommen" && f.herkunft_datum ? `übernommen vom ${formatDatumDE(f.herkunft_datum)}` : f.herkunft;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-neutral-500">
        Ohne Festlegung gilt am ersten Erntetag die Standard-Kategorie des Feldes, danach die Kategorie vom Vortag. Eine
        Festlegung für ein Feld geht vor der für alle Felder; eine Festlegung je Person geht vor beiden.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Tag
          <input id="festlegen-datum" type="date" className="mt-1 block" value={datum} onChange={(e) => e.target.value && setDatum(e.target.value)} />
        </label>
        <label className="text-sm">
          Kategorie für alle Felder
          <span className="mt-1 flex items-center gap-2">
            <KatAuswahl
              label="Kategorie für alle Felder"
              wert={alle ? Number(alle.kategorie) : null}
              kategorien={kats}
              disabled={!darfAendern}
              onChange={(k) => setzen(null, null, k)}
            />
          </span>
        </label>
        {kats.length === 0 && <p className="text-sm text-beere-700">Für {jahr} sind noch keine Kategorien angelegt (Reiter Kategorien).</p>}
        {meldung && <p className={`text-sm ${meldung.ok ? "text-emerald-700" : "text-beere-700"}`}>{meldung.text}</p>}
      </div>

      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Feld</th>
              <th className="text-right">Kategorie</th>
              <th>Herkunft</th>
              <th>Für dieses Feld festlegen</th>
            </tr>
          </thead>
          <tbody>
            {felder.map((f) => {
              const eigene = fest.find((x) => x.feld_id === f.feld_id && x.employee_id === null);
              return (
                <tr key={f.feld_id}>
                  <td className="whitespace-nowrap">
                    {f.feld}
                    {f.kultur === "gruenspargel" && <span className="ml-1.5 text-xs text-neutral-400">Grünspargel</span>}
                  </td>
                  <td className={`text-right font-medium tabular-nums ${f.herkunft.startsWith("für") ? "text-amber-700" : ""}`}>
                    {katText(f.kategorie)}
                  </td>
                  <td className="whitespace-nowrap text-xs text-neutral-500">{herkunft(f)}</td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <KatAuswahl
                        label={`Kategorie ${f.feld}`}
                        wert={eigene ? Number(eigene.kategorie) : null}
                        kategorien={kats}
                        disabled={!darfAendern}
                        onChange={(k) => setzen(f.feld_id, null, k)}
                      />
                      {eigene && darfAendern && (
                        <button
                          type="button"
                          title="Festlegung entfernen"
                          aria-label={`Festlegung ${f.feld} entfernen`}
                          className="text-neutral-400 hover:text-emerald-700"
                          onClick={() => setzen(f.feld_id, null, null)}
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Je Person an diesem Tag</h2>
        {personFest.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine Festlegungen je Person.</p>
        ) : (
          <ul className="divide-y divide-linie text-sm">
            {personFest.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1">
                  {personName[p.employee_id ?? ""] ?? "Person"}
                  {p.feld_id && <span className="text-neutral-500"> · {feldName[p.feld_id] ?? "Feld"}</span>}
                </span>
                <span className="font-medium tabular-nums text-amber-700">{katText(p.kategorie)}</span>
                {darfAendern && (
                  <button
                    type="button"
                    aria-label="Festlegung entfernen"
                    className="text-neutral-400 hover:text-beere-700"
                    onClick={() => setzen(p.feld_id, p.employee_id, null)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {darfAendern && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!neuPerson.employee_id || neuPerson.kategorie === null) {
                setMeldung({ ok: false, text: "Bitte Person und Kategorie wählen." });
                return;
              }
              setzen(neuPerson.feld_id ? Number(neuPerson.feld_id) : null, neuPerson.employee_id, neuPerson.kategorie).then(() =>
                setNeuPerson({ employee_id: "", feld_id: "", kategorie: null })
              );
            }}
          >
            <label className="text-sm">
              Person
              <select
                id="festlegen-person"
                className="mt-1 block max-w-[16rem]"
                value={neuPerson.employee_id}
                onChange={(e) => setNeuPerson({ ...neuPerson, employee_id: e.target.value })}
              >
                <option value="">— wählen —</option>
                {personen.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Feld (optional)
              <select
                id="festlegen-feld"
                className="mt-1 block max-w-[12rem]"
                value={neuPerson.feld_id}
                onChange={(e) => setNeuPerson({ ...neuPerson, feld_id: e.target.value })}
              >
                <option value="">alle</option>
                {felder.map((f) => (
                  <option key={f.feld_id} value={f.feld_id}>
                    {f.feld}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Kategorie
              <span className="mt-1 block">
                <KatAuswahl
                  label="Kategorie Person"
                  wert={neuPerson.kategorie}
                  kategorien={kats}
                  onChange={(k) => setNeuPerson({ ...neuPerson, kategorie: k })}
                />
              </span>
            </label>
            <button type="submit" className="btn">
              <Plus className="h-4 w-4" />
              Festlegen
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
