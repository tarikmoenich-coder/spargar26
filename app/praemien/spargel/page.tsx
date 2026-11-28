"use client";

// Prämien → Spargel (Stufe 1, docs/spargel-praemien-konzept.md). Rechnet wie
// die bisherige Excel: Preis je kg aus der Kategorie, Akkordwert = kg × Preis,
// Lohnanspruch = Stunden × Stundensatz (Mindestlohn), Prämie = Differenz nur
// wenn positiv, Fehlbetrag nur zur Information (wird nicht verrechnet).
// Gruppenzeilen (z.B. Grünspargel-Gruppen 2026) bekommen keine Prämie.
// Daten 2026 einmalig aus der Excel übernommen; ab 2027 aus der Ernteerfassung.
// Stufe 2: Kategorien pflegen und je Tag/Feld/Person festlegen
// (components/SpargelKategorien.tsx, ändern nur Geschäftsführung).

import PageHeader from "@/components/PageHeader";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import { Kennzahl } from "@/components/Uebersicht";
import { Award, Clock, Euro, Printer, Scale, TrendingDown, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { formatDatumDE, formatEuro, formatMenge } from "@/lib/format";
import { darf } from "@/lib/rollen";
import { KategorienFestlegen, KategorienPflege } from "@/components/SpargelKategorien";
import SpargelAushang from "@/components/SpargelAushang";
import SpargelFreigabe from "@/components/SpargelFreigabe";

interface TagZeile {
  datum: string;
  saison_jahr: number;
  employee_id: string | null;
  personal_nr: string | null;
  gruppe: string | null;
  feld_name: string | null;
  felder: number;
  kg: number;
  stunden: number;
  kisten: number | null;
  kategorie_min: number | null;
  kategorie_max: number | null;
  kategorie_geaendert: boolean;
  unvollstaendig: boolean;
  akkordwert: number | null;
  lohnanspruch: number | null;
  praemie: number;
  fehlbetrag: number;
  gruppenanteil?: boolean;
}

interface Kat {
  saison_jahr: number;
  kategorie: number;
  preis_kg: number;
}

type Ansicht = "personen" | "tag" | "freigabe" | "festlegen" | "kategorien";
const MONATE = ["März", "April", "Mai", "Juni", "Juli"];
const monatVon = (iso: string) => Number(iso.slice(5, 7));

export default function PraemienSpargelPage() {
  const { profile } = useProfile();
  const darfLesen = darf(profile, "ernte.praemien:L", "ernte.statistik:L", "lohn.uebersicht:L");
  const darfKategorien = darf(profile, "sonder.spargel_kategorie:S");

  const [zeilen, setZeilen] = useState<TagZeile[]>([]);
  const [kats, setKats] = useState<Kat[]>([]);
  const [namen, setNamen] = useState<Record<string, string>>({});
  const [mindestlohn, setMindestlohn] = useState<Record<number, number>>({});
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [saison, setSaison] = useState<number | null>(null);
  const [ansicht, setAnsicht] = useState<Ansicht>("personen");
  const [tag, setTag] = useState<string>("");
  const [suche, setSuche] = useState("");

  useEffect(() => {
    if (!darfLesen) return;
    (async () => {
      setLaedt(true);
      const sb = getSupabaseClient();
      try {
        const [z, k, e, v] = await Promise.all([
          ladeAlleSeiten<TagZeile>((von, bis) =>
            sb.from("spargel_praemie_tag").select("*").order("datum").order("personal_nr").range(von, bis)
          ),
          sb.from("spargel_kategorie").select("*").order("saison_jahr").order("kategorie"),
          ladeAlleSeiten<{ id: string; name: string; vorname: string }>((von, bis) =>
            sb.from("employees").select("id, name, vorname").order("id").range(von, bis)
          ),
          sb.from("verpflegungssaetze").select("saison_jahr, mindestlohn"),
        ]);
        setMindestlohn(
          Object.fromEntries(
            ((v.data as { saison_jahr: number; mindestlohn: number | null }[]) ?? [])
              .filter((x) => x.mindestlohn)
              .map((x) => [x.saison_jahr, Number(x.mindestlohn)])
          )
        );
        setZeilen(z);
        setKats((k.data as Kat[]) ?? []);
        setNamen(Object.fromEntries(e.map((x) => [x.id, `${x.name}, ${x.vorname}`])));
        const jahre = Array.from(new Set(z.map((x) => x.saison_jahr))).sort();
        setSaison((s) => s ?? jahre[jahre.length - 1] ?? new Date().getFullYear());
        setFehler(null);
      } catch (err) {
        setFehler(String(err));
      }
      setLaedt(false);
    })();
  }, [darfLesen]);

  const [extraJahre, setExtraJahre] = useState<number[]>([]);
  const jahre = useMemo(
    () => Array.from(new Set([...zeilen.map((x) => x.saison_jahr), ...kats.map((k) => k.saison_jahr), ...extraJahre])).sort(),
    [zeilen, kats, extraJahre]
  );
  const saisonZeilen = useMemo(() => zeilen.filter((z) => z.saison_jahr === saison), [zeilen, saison]);
  const tage = useMemo(() => Array.from(new Set(saisonZeilen.map((z) => z.datum))).sort(), [saisonZeilen]);
  useEffect(() => {
    if (tage.length > 0 && !tage.includes(tag)) setTag(tage[tage.length - 1]);
  }, [tage, tag]);

  const person = (z: Pick<TagZeile, "employee_id" | "personal_nr" | "gruppe">) =>
    z.gruppe ?? (z.employee_id ? namen[z.employee_id] ?? z.personal_nr ?? "?" : `Pers.-Nr. ${z.personal_nr ?? "?"}`);

  const summe = useMemo(() => {
    const s = { kg: 0, std: 0, praemie: 0, fehl: 0, personen: new Set<string>() };
    for (const z of saisonZeilen) {
      s.kg += Number(z.kg);
      s.std += Number(z.stunden);
      s.praemie += Number(z.praemie);
      if (!z.gruppe) {
        s.fehl += Number(z.fehlbetrag);
        s.personen.add(z.employee_id ?? z.personal_nr ?? "");
      }
    }
    return s;
  }, [saisonZeilen]);

  const jePerson = useMemo(() => {
    const m = new Map<
      string,
      { name: string; pnr: string; kg: number; std: number; praemie: number; fehl: number; tage: number; monat: Record<number, number> }
    >();
    for (const z of saisonZeilen) {
      if (z.gruppe) continue;
      const key = z.employee_id ?? `p:${z.personal_nr}`;
      const p = m.get(key) ?? { name: person(z), pnr: z.personal_nr ?? "", kg: 0, std: 0, praemie: 0, fehl: 0, tage: 0, monat: {} };
      p.kg += Number(z.kg);
      p.std += Number(z.stunden);
      p.praemie += Number(z.praemie);
      p.fehl += Number(z.fehlbetrag);
      p.tage += 1;
      p.monat[monatVon(z.datum)] = (p.monat[monatVon(z.datum)] ?? 0) + Number(z.praemie);
      m.set(key, p);
    }
    const q = suche.trim().toLowerCase();
    return Array.from(m.values())
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.pnr.includes(q))
      .sort((a, b) => b.praemie - a.praemie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saisonZeilen, namen, suche]);

  const monate = useMemo(
    () => Array.from(new Set(saisonZeilen.map((z) => monatVon(z.datum)))).sort((a, b) => a - b),
    [saisonZeilen]
  );
  const tagZeilen = useMemo(
    () =>
      saisonZeilen
        .filter((z) => z.datum === tag)
        .sort((a, b) => (a.feld_name ?? "").localeCompare(b.feld_name ?? "") || person(a).localeCompare(person(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saisonZeilen, tag, namen]
  );
  const quelle =
    saison === 2026
      ? "Übernommen aus der Excel „Spargelprämien 2026“ (nicht lohnwirksam, lief über die Excel)."
      : "Nur freigegebene Tage (Reiter „Prüfen & Freigeben“)."

  if (!darfLesen) {
    return (
      <div className="flex flex-col gap-4">
        <ErntewirtschaftTabs />
        <PageHeader icon={Award} titel="Prämien – Spargel" />
        <p className="text-sm text-neutral-500">Keine Berechtigung.</p>
      </div>
    );
  }

  const kat = (z: TagZeile) =>
    z.kategorie_min === null
      ? "—"
      : z.kategorie_min === z.kategorie_max
        ? formatMenge(z.kategorie_min, z.kategorie_min % 1 ? 1 : 0)
        : `${formatMenge(z.kategorie_min, 1)}–${formatMenge(z.kategorie_max, 1)}`;

  return (
    <div className="flex flex-col gap-5">
      <ErntewirtschaftTabs />
      <div className="print:hidden">
      <PageHeader
        icon={Award}
        titel="Prämien – Spargel"
        beschreibung="Prämie = kg × Preis der Kategorie − Stunden × Mindestlohn, nur wenn positiv. Liegt jemand darunter, steht der Fehlbetrag nur zur Information daneben."
        aktionen={
          jahre.length > 0 && (
            <select value={saison ?? ""} onChange={(e) => setSaison(Number(e.target.value))} aria-label="Saison">
              {jahre.map((j) => (
                <option key={j} value={j}>
                  Saison {j}
                </option>
              ))}
            </select>
          )
        }
      />
      </div>

      {fehler && <p className="text-sm text-beere-700">Konnte nicht geladen werden: {fehler}</p>}
      {laedt ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : zeilen.length === 0 ? (
        <p className="text-sm text-neutral-500">Noch keine Spargeldaten vorhanden.</p>
      ) : (
        <>
          {quelle && <p className="-mt-2 text-xs text-neutral-500 print:hidden">{quelle}</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
            <Kennzahl icon={Scale} titel="Geerntet" wert={`${formatMenge(summe.kg / 1000, 1)} t`} />
            <Kennzahl icon={Clock} titel="Stunden" wert={formatMenge(summe.std, 0)} />
            <Kennzahl icon={Scale} titel="Ø kg je Stunde" wert={formatMenge(summe.std ? summe.kg / summe.std : null, 1)} />
            <Kennzahl icon={Users} titel="Personen" wert={summe.personen.size} />
            <Kennzahl icon={Euro} titel="Prämie" wert={formatEuro(summe.praemie)} ton="gruen" />
            <Kennzahl icon={TrendingDown} titel="Unter der Schwelle" wert={formatEuro(summe.fehl)} unter="nicht verrechnet" />
          </div>

          <div className="flex flex-wrap gap-4 border-b border-linie text-sm print:hidden">
            {(
              [
                ["personen", "Je Person"],
                ["tag", "Tagesliste"],
                ["freigabe", "Prüfen & Freigeben"],
                ["festlegen", "Kategorien festlegen"],
                ["kategorien", "Preise & Standard"],
              ] as [Ansicht, string][]
            ).map(([w, l]) => (
              <button
                key={w}
                type="button"
                onClick={() => setAnsicht(w)}
                className={`-mb-px border-b-2 px-1 pb-2 ${
                  ansicht === w ? "border-emerald-600 font-semibold text-emerald-800" : "border-transparent text-neutral-600 hover:text-emerald-800"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {ansicht === "personen" && (
            <div className="flex flex-col gap-3">
              <input
                id="spargel-suche"
                className="max-w-xs"
                placeholder="Name oder Personalnummer suchen"
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
              />
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Pers.-Nr.</th>
                      <th className="text-right">Tage</th>
                      <th className="text-right">kg</th>
                      <th className="text-right">Std.</th>
                      <th className="text-right">kg/h</th>
                      {monate.map((m) => (
                        <th key={m} className="text-right">
                          {MONATE[m - 3] ?? m}
                        </th>
                      ))}
                      <th className="text-right">Prämie</th>
                      <th className="text-right">Unter der Schwelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jePerson.map((p) => (
                      <tr key={p.pnr + p.name}>
                        <td className="whitespace-nowrap">{p.name}</td>
                        <td className="text-neutral-500">{p.pnr}</td>
                        <td className="text-right tabular-nums">{p.tage}</td>
                        <td className="text-right tabular-nums">{formatMenge(p.kg, 0)}</td>
                        <td className="text-right tabular-nums">{formatMenge(p.std, 1)}</td>
                        <td className="text-right tabular-nums">{formatMenge(p.std ? p.kg / p.std : null, 1)}</td>
                        {monate.map((m) => (
                          <td key={m} className="text-right tabular-nums">
                            {p.monat[m] ? formatEuro(p.monat[m]) : ""}
                          </td>
                        ))}
                        <td className="text-right font-medium tabular-nums">{formatEuro(p.praemie)}</td>
                        <td className="text-right tabular-nums text-neutral-500">{p.fehl ? formatEuro(p.fehl) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {ansicht === "tag" && (
            <div className="flex flex-col gap-3">
              <SpargelAushang tag={tag} zeilen={tagZeilen} name={person} />
              <div className="flex flex-wrap items-center gap-2 print:hidden">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={tage.indexOf(tag) <= 0}
                  onClick={() => setTag(tage[tage.indexOf(tag) - 1])}
                >
                  ←
                </button>
                <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
                  {tage.map((t) => (
                    <option key={t} value={t}>
                      {formatDatumDE(t)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={tage.indexOf(tag) >= tage.length - 1}
                  onClick={() => setTag(tage[tage.indexOf(tag) + 1])}
                >
                  →
                </button>
                <span className="text-sm text-neutral-500">
                  {tagZeilen.length} Zeilen · Prämie {formatEuro(tagZeilen.reduce((a, z) => a + Number(z.praemie), 0))}
                </span>
                <button
                  type="button"
                  className="btn-secondary ml-auto"
                  onClick={() => window.print()}
                  title="Aushang für die Erntehelfer: A3 hochkant, einfache Liste nach Namen"
                >
                  <Printer className="h-4 w-4" />
                  Aushang drucken (A3)
                </button>
              </div>
              <div className="overflow-x-auto print:hidden">
                <table>
                  <thead>
                    <tr>
                      <th>Feld</th>
                      <th>Person</th>
                      <th>Pers.-Nr.</th>
                      <th className="text-right">kg</th>
                      <th className="text-right">Std.</th>
                      <th className="text-right">kg/h</th>
                      <th className="text-right">Kat.</th>
                      <th className="text-right">Akkordwert</th>
                      <th className="text-right">Lohn</th>
                      <th className="text-right">Prämie</th>
                      <th className="text-right">Unter der Schwelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tagZeilen.map((z, i) => (
                      <tr key={i} className={z.gruppe ? "text-neutral-500" : ""}>
                        <td className="whitespace-nowrap">{z.feld_name || "—"}</td>
                        <td className="whitespace-nowrap">{person(z)}</td>
                        <td className="text-neutral-500">{z.gruppe ? "" : z.personal_nr}</td>
                        <td className="text-right tabular-nums">{formatMenge(z.kg, 1)}</td>
                        <td className="text-right tabular-nums">{formatMenge(z.stunden, 2)}</td>
                        <td className="text-right tabular-nums">{formatMenge(z.stunden ? z.kg / z.stunden : null, 1)}</td>
                        <td className="text-right tabular-nums" title={z.kategorie_geaendert ? "von der vorgeschlagenen Kategorie abweichend" : undefined}>
                          {kat(z)}
                          {z.kategorie_geaendert && <span className="ml-1 text-amber-600">•</span>}
                        </td>
                        <td className="text-right tabular-nums">{formatEuro(z.akkordwert)}</td>
                        <td className="text-right tabular-nums">{formatEuro(z.lohnanspruch)}</td>
                        <td className="text-right font-medium tabular-nums">
                          {z.gruppe ? <span className="text-xs font-normal">Gruppe</span> : z.unvollstaendig ? <span className="text-xs text-beere-700">Kategorie fehlt</span> : z.praemie ? formatEuro(z.praemie) : ""}
                        </td>
                        <td className="text-right tabular-nums text-neutral-500">{z.fehlbetrag && !z.gruppe ? formatEuro(z.fehlbetrag) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td colSpan={3}>Summe</td>
                      <td className="text-right tabular-nums">{formatMenge(tagZeilen.reduce((a, z) => a + Number(z.kg), 0), 1)}</td>
                      <td className="text-right tabular-nums">{formatMenge(tagZeilen.reduce((a, z) => a + Number(z.stunden), 0), 2)}</td>
                      <td colSpan={4} />
                      <td className="text-right tabular-nums">{formatEuro(tagZeilen.reduce((a, z) => a + Number(z.praemie), 0))}</td>
                      <td className="text-right tabular-nums">
                        {formatEuro(tagZeilen.filter((z) => !z.gruppe).reduce((a, z) => a + Number(z.fehlbetrag), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-neutral-500 print:hidden">
                <span className="text-amber-600">•</span> Kategorie weicht vom Vorschlag ab. Gruppenzeilen bekommen keine Prämie.
              </p>
            </div>
          )}

          {ansicht === "festlegen" && <KategorienFestlegen darfAendern={darfKategorien} />}

          {ansicht === "freigabe" && <SpargelFreigabe darfFreigeben={darfKategorien} namen={namen} />}

          {ansicht === "kategorien" && saison && (
            <KategorienPflege
              saison={saison}
              darfAendern={darfKategorien}
              mindestlohn={mindestlohn[saison] ?? null}
              onSaisonAngelegt={(j) => {
                setExtraJahre((x) => [...x, j]);
                setSaison(j);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
