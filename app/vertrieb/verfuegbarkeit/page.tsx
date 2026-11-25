"use client";

// Vertrieb → Verfügbarkeit (Vertriebsplanung V2, docs/vertriebsplanung-plan.md).
// Je Verkäufer und Saison ein Wochenraster Mo-So x Vormittag/Nachmittag:
// "kann" / "kann nicht" / offen. Darunter Angebot (wie viele können) gegen
// Bedarf (wie viele Stände sind offen) je Halbtag - die Grundlage für den
// Grundplan (V3). Dazu Abwesenheiten mit Datum und der Führerschein (Pflicht
// für den Fahrer der Tour).

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import { formatDatumDE } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import VertriebTabs from "@/components/VertriebTabs";
import type {
  FuehrerscheinEintrag,
  VtAbwesenheit,
  VtHalbtag,
  VtStand,
  VtStandZeit,
  VtVerfuegbarkeit,
  VtVerkaeuferSaison,
} from "@/lib/types";
import { HALBTAGE, WOCHENTAGE, planungsSaison } from "@/lib/vertrieb";
import { ladeAlleSeiten } from "@/lib/ladeAlle";

type Person = {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  aktiv: boolean;
  fuehrerschein_b: boolean | null;
};

const SPALTEN = WOCHENTAGE.flatMap((t) => HALBTAGE.map((h) => ({ tag: t.nr, kurz: t.kurz, halbtag: h.wert })));
const k = (tag: number, h: VtHalbtag) => `${tag}-${h}`;

export default function VertriebVerfuegbarkeitPage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");

  const [saison, setSaison] = useState(planungsSaison());
  const [personen, setPersonen] = useState<Person[]>([]);
  const [fsDoku, setFsDoku] = useState<FuehrerscheinEintrag[]>([]);
  const [planung, setPlanung] = useState<VtVerkaeuferSaison[]>([]);
  const [raster, setRaster] = useState<VtVerfuegbarkeit[]>([]);
  const [abwesenheiten, setAbwesenheiten] = useState<VtAbwesenheit[]>([]);
  const [staende, setStaende] = useState<VtStand[]>([]);
  const [zeiten, setZeiten] = useState<VtStandZeit[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hinzu, setHinzu] = useState("");
  const [abw, setAbw] = useState({ employee_id: "", von: "", bis: "", halbtag: "", grund: "" });

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    // employees (Vertrieb) und Führerschein-Einträge (alle Bereiche)
    // seitenweise - PostgREST liefert je Abfrage höchstens 1000 Zeilen.
    const [p, fs, pl, r, a, s, z] = await Promise.all([
      ladeAlleSeiten<Person>((von, bis) =>
        sb
          .from("employees")
          .select("id, personal_nr, name, vorname, aktiv, fuehrerschein_b")
          .eq("bereich", "VT")
          .order("name")
          .order("id")
          .range(von, bis)
      ),
      ladeAlleSeiten<FuehrerscheinEintrag>((von, bis) =>
        sb.from("employee_fuehrerschein_kategorien").select("*").order("employee_id").range(von, bis)
      ),
      sb.from("vt_verkaeufer_saison").select("*").eq("saison_jahr", saison),
      sb.from("vt_verfuegbarkeit").select("*").eq("saison_jahr", saison),
      sb.from("vt_abwesenheit").select("*").gte("bis", `${saison}-01-01`).lte("von", `${saison}-12-31`).order("von"),
      sb.from("vt_stand").select("*").eq("aktiv", true),
      sb.from("vt_stand_zeit").select("*"),
    ]);
    const err = pl.error ?? r.error ?? a.error ?? s.error ?? z.error;
    setFehler(err ? err.message : null);
    setPersonen(p);
    setFsDoku(fs);
    setPlanung((pl.data as VtVerkaeuferSaison[]) ?? []);
    setRaster((r.data as VtVerfuegbarkeit[]) ?? []);
    setAbwesenheiten((a.data as VtAbwesenheit[]) ?? []);
    setStaende((s.data as VtStand[]) ?? []);
    setZeiten((z.data as VtStandZeit[]) ?? []);
    setLoading(false);
  }, [saison]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const personById = useMemo(() => new Map(personen.map((p) => [p.id, p])), [personen]);
  const rasterMap = useMemo(() => {
    const m = new Map<string, VtVerfuegbarkeit>();
    for (const r of raster) m.set(`${r.employee_id}|${k(r.wochentag, r.halbtag)}`, r);
    return m;
  }, [raster]);

  const zeilen = useMemo(
    () =>
      planung
        .map((pl) => ({ pl, p: personById.get(pl.employee_id) }))
        .filter((x): x is { pl: VtVerkaeuferSaison; p: Person } => !!x.p)
        .sort((a, b) => a.p.name.localeCompare(b.p.name, "de") || a.p.vorname.localeCompare(b.p.vorname, "de")),
    [planung, personById]
  );

  const hatFuehrerschein = (p: Person) =>
    !!p.fuehrerschein_b || fsDoku.some((f) => f.employee_id === p.id && f.fuehrerschein_kategorien.length > 0);

  // Bedarf je Halbtag = Anzahl aktiver Stände, die dann geöffnet sind.
  const bedarf = useMemo(() => {
    const aktiv = new Set(staende.map((s) => s.id));
    const m = new Map<string, number>();
    for (const z of zeiten) if (aktiv.has(z.stand_id)) m.set(k(z.wochentag, z.halbtag), (m.get(k(z.wochentag, z.halbtag)) ?? 0) + 1);
    return m;
  }, [staende, zeiten]);

  const angebot = useMemo(() => {
    const geplant = new Set(planung.map((p) => p.employee_id));
    const m = new Map<string, number>();
    for (const r of raster)
      if (r.kann && geplant.has(r.employee_id)) m.set(k(r.wochentag, r.halbtag), (m.get(k(r.wochentag, r.halbtag)) ?? 0) + 1);
    return m;
  }, [raster, planung]);

  async function fehlerOderNeu(err: { message: string } | null) {
    if (err) setFehler(err.message);
    await load();
  }

  // Zelle weiterschalten: offen -> kann -> kann nicht -> offen
  async function zelleKlick(empId: string, tag: number, h: VtHalbtag) {
    if (!darfPflegen) return;
    const sb = getSupabaseClient();
    const alt = rasterMap.get(`${empId}|${k(tag, h)}`);
    if (!alt) {
      setRaster((r) => [...r, { id: -Date.now(), employee_id: empId, saison_jahr: saison, wochentag: tag, halbtag: h, kann: true }]);
      const { error } = await sb.from("vt_verfuegbarkeit").insert({ employee_id: empId, saison_jahr: saison, wochentag: tag, halbtag: h, kann: true });
      return fehlerOderNeu(error);
    }
    if (alt.kann) {
      setRaster((r) => r.map((x) => (x.id === alt.id ? { ...x, kann: false } : x)));
      const { error } = await sb.from("vt_verfuegbarkeit").update({ kann: false }).eq("id", alt.id);
      return fehlerOderNeu(error);
    }
    setRaster((r) => r.filter((x) => x.id !== alt.id));
    const { error } = await sb.from("vt_verfuegbarkeit").delete().eq("id", alt.id);
    return fehlerOderNeu(error);
  }

  // Ganze Zeile setzen: true = alles "kann", false = alles "kann nicht", null = leeren
  async function zeileSetzen(empId: string, wert: boolean | null) {
    const sb = getSupabaseClient();
    if (wert === null) {
      const { error } = await sb.from("vt_verfuegbarkeit").delete().eq("employee_id", empId).eq("saison_jahr", saison);
      return fehlerOderNeu(error);
    }
    const { error } = await sb.from("vt_verfuegbarkeit").upsert(
      SPALTEN.map((s) => ({ employee_id: empId, saison_jahr: saison, wochentag: s.tag, halbtag: s.halbtag, kann: wert })),
      { onConflict: "employee_id,saison_jahr,wochentag,halbtag" }
    );
    return fehlerOderNeu(error);
  }

  async function aktiveUebernehmen() {
    const drin = new Set(planung.map((p) => p.employee_id));
    const neu = personen.filter((p) => p.aktiv && !drin.has(p.id));
    if (!neu.length) return setFehler("Alle aktiven Verkäufer sind schon in der Planung.");
    const { error } = await getSupabaseClient()
      .from("vt_verkaeufer_saison")
      .insert(neu.map((p) => ({ employee_id: p.id, saison_jahr: saison })));
    return fehlerOderNeu(error);
  }

  async function personHinzu() {
    if (!hinzu) return;
    const { error } = await getSupabaseClient().from("vt_verkaeufer_saison").insert({ employee_id: hinzu, saison_jahr: saison });
    setHinzu("");
    return fehlerOderNeu(error);
  }

  async function personEntfernen(pl: VtVerkaeuferSaison, p: Person) {
    if (!confirm(`${p.vorname} ${p.name} aus der Planung ${saison} nehmen? Die Verfügbarkeiten dieser Saison werden gelöscht.`)) return;
    const sb = getSupabaseClient();
    const a = await sb.from("vt_verfuegbarkeit").delete().eq("employee_id", p.id).eq("saison_jahr", saison);
    if (a.error) return fehlerOderNeu(a.error);
    const { error } = await sb.from("vt_verkaeufer_saison").delete().eq("id", pl.id);
    return fehlerOderNeu(error);
  }

  async function planungFeld(pl: VtVerkaeuferSaison, feld: "max_halbtage_woche" | "notiz", wert: string) {
    const v = feld === "max_halbtage_woche" ? (wert === "" ? null : Number(wert)) : wert.trim() || null;
    if (v === pl[feld]) return;
    const { error } = await getSupabaseClient().from("vt_verkaeufer_saison").update({ [feld]: v }).eq("id", pl.id);
    return fehlerOderNeu(error);
  }

  async function fuehrerscheinSetzen(p: Person, wert: boolean) {
    const { error } = await getSupabaseClient().from("employees").update({ fuehrerschein_b: wert }).eq("id", p.id);
    return fehlerOderNeu(error);
  }

  async function abwesenheitAnlegen(e: React.FormEvent) {
    e.preventDefault();
    if (!abw.employee_id || !abw.von) return;
    const { error } = await getSupabaseClient()
      .from("vt_abwesenheit")
      .insert({
        employee_id: abw.employee_id,
        von: abw.von,
        bis: abw.bis || abw.von,
        halbtag: abw.halbtag || null,
        grund: abw.grund.trim() || null,
      });
    if (!error) setAbw({ employee_id: abw.employee_id, von: "", bis: "", halbtag: "", grund: "" });
    return fehlerOderNeu(error);
  }

  async function abwesenheitLoeschen(id: number) {
    const { error } = await getSupabaseClient().from("vt_abwesenheit").delete().eq("id", id);
    return fehlerOderNeu(error);
  }

  const nichtGeplant = personen.filter((p) => !planung.some((pl) => pl.employee_id === p.id));
  const saisonen = [planungsSaison() - 1, planungsSaison(), planungsSaison() + 1];

  return (
    <div className="flex flex-col gap-6">
      <VertriebTabs />
      <PageHeader
        icon={CalendarCheck}
        titel="Verfügbarkeit"
        beschreibung={`Wann die Verkäufer können - je Wochentag Vormittag/Nachmittag.${
          darfPflegen ? " Klick auf ein Feld: ✓ kann → ✗ kann nicht → offen." : ""
        }`}
        aktionen={
          <select value={saison} onChange={(e) => setSaison(Number(e.target.value))}>
            {saisonen.map((s) => (
              <option key={s} value={s}>
                Saison {s}
              </option>
            ))}
          </select>
        }
      />
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}

      {darfPflegen && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button className="btn-secondary" onClick={aktiveUebernehmen}>
            Aktive Verkäufer übernehmen
          </button>
          <select value={hinzu} onChange={(e) => setHinzu(e.target.value)} className="max-w-72">
            <option value="">Person hinzufügen …</option>
            {nichtGeplant.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}, {p.vorname} ({p.personal_nr}){p.aktiv ? "" : " – inaktiv"}
              </option>
            ))}
          </select>
          <button className="btn-secondary" disabled={!hinzu} onClick={personHinzu}>
            Hinzufügen
          </button>
        </div>
      )}

      {!loading && zeilen.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          text={`Für die Saison ${saison} ist noch niemand in der Planung.`}
          hinweis={darfPflegen ? 'Mit "Aktive Verkäufer übernehmen" oder einzeln hinzufügen.' : undefined}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th rowSpan={2}>Verkäufer</th>
                <th rowSpan={2} title="Führerschein (Pflicht für den Fahrer der Tour)">
                  FS
                </th>
                {WOCHENTAGE.map((t) => (
                  <th key={t.nr} colSpan={2} className="text-center">
                    {t.kurz}
                  </th>
                ))}
                <th rowSpan={2} title="Halbtage mit ✓ / gewünschtes Maximum je Woche">
                  ✓ / max
                </th>
                <th rowSpan={2}>Notiz</th>
                {darfPflegen && <th rowSpan={2}></th>}
              </tr>
              <tr>
                {SPALTEN.map((s) => (
                  <th key={k(s.tag, s.halbtag)} className="px-1 text-center text-xs font-normal text-neutral-500">
                    {s.halbtag}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {zeilen.map(({ pl, p }) => {
                const anzahl = SPALTEN.filter((s) => rasterMap.get(`${p.id}|${k(s.tag, s.halbtag)}`)?.kann).length;
                const abwAnz = abwesenheiten.filter((a) => a.employee_id === p.id).length;
                const fs = hatFuehrerschein(p);
                return (
                  <tr key={pl.id}>
                    <td className="whitespace-nowrap">
                      {p.name}, {p.vorname}
                      <span className="ml-1 text-xs text-neutral-500">{p.personal_nr}</span>
                      {abwAnz > 0 && (
                        <span className="badge-neutral ml-1" title="Abwesenheiten in dieser Saison (unten)">
                          {abwAnz} abw.
                        </span>
                      )}
                    </td>
                    <td className="text-center">
                      {darfPflegen && !fsDoku.some((f) => f.employee_id === p.id) ? (
                        <input
                          type="checkbox"
                          title="Führerschein Klasse B"
                          checked={!!p.fuehrerschein_b}
                          onChange={(e) => fuehrerscheinSetzen(p, e.target.checked)}
                        />
                      ) : fs ? (
                        <span title="Führerschein vorhanden">✓</span>
                      ) : (
                        <span className="text-neutral-300">–</span>
                      )}
                    </td>
                    {SPALTEN.map((s) => {
                      const r = rasterMap.get(`${p.id}|${k(s.tag, s.halbtag)}`);
                      const cls = !r
                        ? "bg-white text-neutral-300"
                        : r.kann
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-beere-50 text-beere-600";
                      return (
                        <td
                          key={k(s.tag, s.halbtag)}
                          onClick={() => zelleKlick(p.id, s.tag, s.halbtag)}
                          className={`select-none px-1 text-center ${cls} ${darfPflegen ? "cursor-pointer hover:ring-1 hover:ring-emerald-400" : ""} ${
                            s.halbtag === "VM" ? "border-l border-linie" : ""
                          }`}
                          title={`${s.kurz} ${s.halbtag === "VM" ? "Vormittag" : "Nachmittag"}`}
                        >
                          {!r ? "·" : r.kann ? "✓" : "✗"}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap text-center">
                      <span className={pl.max_halbtage_woche != null && anzahl < pl.max_halbtage_woche ? "text-amber-700" : ""}>{anzahl}</span>
                      {" / "}
                      {darfPflegen ? (
                        <input
                          type="number"
                          min={0}
                          max={14}
                          className="w-14"
                          defaultValue={pl.max_halbtage_woche ?? ""}
                          onBlur={(e) => planungFeld(pl, "max_halbtage_woche", e.target.value)}
                        />
                      ) : (
                        (pl.max_halbtage_woche ?? "–")
                      )}
                    </td>
                    <td>
                      {darfPflegen ? (
                        <input className="w-40" defaultValue={pl.notiz ?? ""} onBlur={(e) => planungFeld(pl, "notiz", e.target.value)} />
                      ) : (
                        pl.notiz
                      )}
                    </td>
                    {darfPflegen && (
                      <td className="whitespace-nowrap">
                        <button className="btn-secondary px-2 text-xs" title="alle Halbtage: kann" onClick={() => zeileSetzen(p.id, true)}>
                          alle ✓
                        </button>{" "}
                        <button className="btn-secondary px-2 text-xs" title="Zeile leeren" onClick={() => zeileSetzen(p.id, null)}>
                          leeren
                        </button>{" "}
                        <button className="btn-secondary px-2 text-xs" title="aus der Planung nehmen" onClick={() => personEntfernen(pl, p)}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <td colSpan={2}>Können</td>
                {SPALTEN.map((s) => {
                  const a = angebot.get(k(s.tag, s.halbtag)) ?? 0;
                  const b = bedarf.get(k(s.tag, s.halbtag)) ?? 0;
                  return (
                    <td
                      key={k(s.tag, s.halbtag)}
                      className={`px-1 text-center ${b > 0 && a < b ? "bg-amber-100 text-amber-800" : ""}`}
                      title={`${a} können, ${b} Stände offen`}
                    >
                      {a}
                    </td>
                  );
                })}
                <td colSpan={darfPflegen ? 3 : 2}></td>
              </tr>
              <tr className="text-neutral-500">
                <td colSpan={2}>Stände offen</td>
                {SPALTEN.map((s) => (
                  <td key={k(s.tag, s.halbtag)} className="px-1 text-center">
                    {bedarf.get(k(s.tag, s.halbtag)) ?? 0}
                  </td>
                ))}
                <td colSpan={darfPflegen ? 3 : 2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-emerald-900">Abwesenheiten {saison}</h2>
        {darfPflegen && zeilen.length > 0 && (
          <form onSubmit={abwesenheitAnlegen} className="flex flex-wrap items-end gap-2 text-sm">
            <select required value={abw.employee_id} onChange={(e) => setAbw({ ...abw, employee_id: e.target.value })}>
              <option value="">Person …</option>
              {zeilen.map(({ p }) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.vorname}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-1">
              von
              <input type="date" required value={abw.von} onChange={(e) => setAbw({ ...abw, von: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              bis
              <input type="date" min={abw.von} value={abw.bis} onChange={(e) => setAbw({ ...abw, bis: e.target.value })} />
            </label>
            <select value={abw.halbtag} onChange={(e) => setAbw({ ...abw, halbtag: e.target.value })}>
              <option value="">ganzer Tag</option>
              <option value="VM">nur Vormittag</option>
              <option value="NM">nur Nachmittag</option>
            </select>
            <input placeholder="Grund (optional)" value={abw.grund} onChange={(e) => setAbw({ ...abw, grund: e.target.value })} />
            <button className="btn" type="submit">
              Eintragen
            </button>
          </form>
        )}
        {abwesenheiten.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine Abwesenheiten eingetragen.</p>
        ) : (
          <table className="text-sm">
            <thead>
              <tr>
                <th>Person</th>
                <th>Zeitraum</th>
                <th>Halbtag</th>
                <th>Grund</th>
                {darfPflegen && <th></th>}
              </tr>
            </thead>
            <tbody>
              {abwesenheiten.map((a) => {
                const p = personById.get(a.employee_id);
                return (
                  <tr key={a.id}>
                    <td>{p ? `${p.name}, ${p.vorname}` : "—"}</td>
                    <td className="whitespace-nowrap">
                      {formatDatumDE(a.von)}
                      {a.bis !== a.von && ` – ${formatDatumDE(a.bis)}`}
                    </td>
                    <td>{a.halbtag === "VM" ? "Vormittag" : a.halbtag === "NM" ? "Nachmittag" : "ganzer Tag"}</td>
                    <td>{a.grund}</td>
                    {darfPflegen && (
                      <td>
                        <button className="btn-secondary px-2 text-xs" onClick={() => abwesenheitLoeschen(a.id)}>
                          Löschen
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
