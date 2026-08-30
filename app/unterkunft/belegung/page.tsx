"use client";

// Unterkunft → Belegung planen (Migration 2026-08-29, Wohneinheiten/Zuordnung
// 2026-08-31). Zwei Ebenen:
//   1. SCHWEBEND: Person einer Wohneinheit (optional schon einem Zimmer)
//      zuordnen, bevor die Zimmerübergabe läuft. Quelle: aktive Mitarbeiter
//      ohne Bleibe (unterkunft_person_offen), Anreiseliste zuerst.
//   2. FEST: entsteht mit der Zimmerübergabe (dort wird die bettgenaue
//      unterkunft_belegung angelegt und die Zuordnung geschlossen).
// Direkt-Belegung ohne Übergabe bleibt als Notnagel unter „Direkt belegen".
// Planen dürfen nur admin/hr (RLS); hausmeister arbeitet die Übergaben ab.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import { formatDatumDE } from "@/lib/format";
import { belegungLaeuft, heuteIso } from "@/lib/unterkunft";
import type {
  UnterkunftBelegung,
  UnterkunftBett,
  UnterkunftGebaeude,
  UnterkunftPersonOffen,
  UnterkunftWohneinheitUebersicht,
  UnterkunftZimmer,
  UnterkunftZuordnungOffen,
} from "@/lib/types";

interface EmployeeMini {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  aktiv: boolean;
}

export default function UnterkunftBelegungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [einheiten, setEinheiten] = useState<UnterkunftWohneinheitUebersicht[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [betten, setBetten] = useState<UnterkunftBett[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegung[]>([]);
  const [employees, setEmployees] = useState<EmployeeMini[]>([]);
  const [personenOffen, setPersonenOffen] = useState<UnterkunftPersonOffen[]>([]);
  const [zuordnungen, setZuordnungen] = useState<UnterkunftZuordnungOffen[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [nurLaufend, setNurLaufend] = useState(true);

  // Planung (schwebend)
  const [suchtext, setSuchtext] = useState("");
  const [markiert, setMarkiert] = useState<Set<string>>(new Set());
  const [ziel, setZiel] = useState({
    gebaeude_id: "",
    wohneinheit_id: "",
    zimmer_id: "",
    geplant_ab: heuteIso(),
    notiz: "",
  });

  // Direkt-Belegung (Notnagel)
  const [neu, setNeu] = useState({
    gebaeude_id: "",
    zimmer_id: "",
    bett_id: "",
    employee_id: "",
    von: heuteIso(),
    bis: "",
    notiz: "",
  });

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [g, w, z, b, bl, e, po, zu] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      supabase
        .from("unterkunft_wohneinheit_uebersicht")
        .select("*")
        .order("reihenfolge"),
      supabase.from("unterkunft_zimmer").select("*").eq("aktiv", true).order("nummer"),
      supabase.from("unterkunft_bett").select("*").eq("aktiv", true).order("bezeichnung"),
      supabase.from("unterkunft_belegung").select("*").order("von", { ascending: false }),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv")
        .order("name"),
      supabase.from("unterkunft_person_offen").select("*").order("name"),
      supabase.from("unterkunft_zuordnung_offen").select("*").order("geplant_ab"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setEinheiten((w.data as UnterkunftWohneinheitUebersicht[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setBetten((b.data as UnterkunftBett[]) ?? []);
    setBelegungen((bl.data as UnterkunftBelegung[]) ?? []);
    setEmployees((e.data as EmployeeMini[]) ?? []);
    setPersonenOffen((po.data as UnterkunftPersonOffen[]) ?? []);
    setZuordnungen((zu.data as UnterkunftZuordnungOffen[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  // --- Planung -------------------------------------------------------------
  const personenGefiltert = useMemo(() => {
    const q = suchtext.trim().toLowerCase();
    return personenOffen
      .filter(
        (p) =>
          !q ||
          `${p.vorname} ${p.name} ${p.personal_nr}`.toLowerCase().includes(q)
      )
      .sort(
        (a, b) =>
          Number(b.auf_anreiseliste) - Number(a.auf_anreiseliste) ||
          a.name.localeCompare(b.name)
      );
  }, [personenOffen, suchtext]);

  const einheitenDesGebaeudes = einheiten.filter(
    (e) => String(e.gebaeude_id) === ziel.gebaeude_id && e.aktiv
  );
  const zimmerDerEinheit = zimmer.filter(
    (z) => String(z.wohneinheit_id) === ziel.wohneinheit_id
  );

  function toggleMarkiert(id: string) {
    setMarkiert((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function zuordnungAnlegen() {
    setFehler(null);
    if (markiert.size === 0 || !ziel.wohneinheit_id) {
      setFehler("Mindestens eine Person markieren und eine Wohneinheit wählen.");
      return;
    }
    const rows = [...markiert].map((employee_id) => ({
      employee_id,
      wohneinheit_id: Number(ziel.wohneinheit_id),
      zimmer_id: ziel.zimmer_id ? Number(ziel.zimmer_id) : null,
      geplant_ab: ziel.geplant_ab,
      notiz: ziel.notiz.trim() || null,
    }));
    const { error } = await getSupabaseClient()
      .from("unterkunft_zuordnung")
      .insert(rows);
    if (error) {
      setFehler(error.message);
      return;
    }
    setMarkiert(new Set());
    setZiel((s) => ({ ...s, zimmer_id: "", notiz: "" }));
    await laden();
  }

  async function zuordnungStornieren(z: UnterkunftZuordnungOffen) {
    if (!window.confirm(`Zuordnung von ${z.vorname} ${z.name} aufheben?`)) return;
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_zuordnung")
      .update({ status: "storniert", updated_by: profile?.id ?? null })
      .eq("id", z.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  async function zuordnungZimmerSetzen(z: UnterkunftZuordnungOffen, zimmerId: string) {
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_zuordnung")
      .update({
        zimmer_id: zimmerId ? Number(zimmerId) : null,
        updated_by: profile?.id ?? null,
      })
      .eq("id", z.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  // --- Direkt-Belegung + laufende Belegungen -----------------------------
  const zimmerDesGebaeudes = zimmer.filter(
    (z) => String(z.gebaeude_id) === neu.gebaeude_id
  );
  const bettenDesZimmers = betten.filter(
    (b) => String(b.zimmer_id) === neu.zimmer_id
  );

  function bettInfo(bettId: number): string {
    const laufend = belegungen.find(
      (bl) => bl.bett_id === bettId && belegungLaeuft(bl.von, bl.bis)
    );
    if (!laufend) return "frei";
    const emp = employees.find((e) => e.id === laufend.employee_id);
    return `belegt: ${emp ? `${emp.vorname} ${emp.name}` : "?"}`;
  }

  async function direktAnlegen() {
    setFehler(null);
    if (!neu.bett_id || !neu.employee_id || !neu.von) {
      setFehler("Bett, Mitarbeiter und Von-Datum sind Pflicht.");
      return;
    }
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .insert({
        bett_id: Number(neu.bett_id),
        employee_id: neu.employee_id,
        von: neu.von,
        bis: neu.bis || null,
        notiz: neu.notiz.trim() || null,
      });
    if (error) {
      setFehler(
        error.message.includes("unterkunft_belegung_kein_doppel")
          ? "Dieses Bett ist im gewählten Zeitraum bereits belegt."
          : error.message
      );
      return;
    }
    setNeu((s) => ({
      ...s,
      bett_id: "",
      employee_id: "",
      von: heuteIso(),
      bis: "",
      notiz: "",
    }));
    await laden();
  }

  const zeilen = useMemo(() => {
    return belegungen
      .map((bl) => {
        const bett = betten.find((x) => x.id === bl.bett_id);
        const zim = bett ? zimmer.find((x) => x.id === bett.zimmer_id) : undefined;
        const geb = zim ? gebaeude.find((x) => x.id === zim.gebaeude_id) : undefined;
        return {
          ...bl,
          bett_bezeichnung: bett?.bezeichnung ?? "?",
          zimmer_nummer: zim?.nummer ?? "?",
          gebaeude_name: geb?.name ?? "?",
          employee: employees.find((x) => x.id === bl.employee_id),
        };
      })
      .filter((z) => !nurLaufend || z.bis === null || z.bis >= heuteIso());
  }, [belegungen, betten, zimmer, gebaeude, employees, nurLaufend]);

  async function auszugEintragen(id: number, wer: string) {
    const bis = window.prompt(`Auszugsdatum für ${wer}`, heuteIso());
    if (!bis) return;
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .update({ bis })
      .eq("id", id);
    if (error) setFehler(error.message);
    else await laden();
  }

  async function belegungLoeschen(id: number) {
    if (!window.confirm("Diese Belegung löschen? (nur bei Fehleingabe)")) return;
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .delete()
      .eq("id", id);
    if (error) setFehler(error.message);
    else await laden();
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  if (!canEdit) {
    return (
      <div className="space-y-6">
        <UnterkunftTabs />
        <p className="text-sm text-neutral-500">
          Die Belegungsplanung dürfen nur admin/hr bearbeiten. Übergaben laufen
          über den Tab „Übergabe / Abnahme“.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-900">Belegung planen</h1>
        <p className="text-sm text-neutral-500">
          Personen schwebend einer Wohneinheit zuordnen – „fest“ wird daraus mit
          der Zimmerübergabe.
        </p>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {/* --- Schwebend zuordnen --- */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded border border-neutral-200 p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Ohne Bleibe ({personenGefiltert.length})
            </h2>
            <input
              className="w-40 text-sm"
              placeholder="Name / Nr."
              value={suchtext}
              onChange={(e) => setSuchtext(e.target.value)}
            />
          </div>
          <div className="mt-2 max-h-80 space-y-1 overflow-y-auto">
            {personenGefiltert.length === 0 && (
              <p className="text-sm text-neutral-400">
                alle aktiven Mitarbeiter sind zugeordnet oder belegt.
              </p>
            )}
            {personenGefiltert.map((p) => (
              <label
                key={p.employee_id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutral-50"
              >
                <input
                  type="checkbox"
                  checked={markiert.has(p.employee_id)}
                  onChange={() => toggleMarkiert(p.employee_id)}
                />
                <span className="flex-1">
                  {p.vorname} {p.name}{" "}
                  <span className="text-neutral-400">({p.personal_nr})</span>
                  {p.herkunft ? (
                    <span className="text-neutral-400"> · {p.herkunft}</span>
                  ) : null}
                </span>
                {p.auf_anreiseliste && (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">
                    Anreise
                  </span>
                )}
                {p.geplante_ankunft && (
                  <span className="text-xs text-neutral-400">
                    {formatDatumDE(p.geplante_ankunft)}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="rounded border border-neutral-200 p-3">
          <h2 className="text-sm font-semibold">
            Ziel ({markiert.size} markiert)
          </h2>
          <div className="mt-2 space-y-2 text-sm">
            <label className="block">
              Gebäude
              <select
                className="ml-2"
                value={ziel.gebaeude_id}
                onChange={(e) =>
                  setZiel((s) => ({
                    ...s,
                    gebaeude_id: e.target.value,
                    wohneinheit_id: "",
                    zimmer_id: "",
                  }))
                }
              >
                <option value="">–</option>
                {gebaeude.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Wohneinheit
              <select
                className="ml-2"
                value={ziel.wohneinheit_id}
                disabled={!ziel.gebaeude_id}
                onChange={(e) =>
                  setZiel((s) => ({
                    ...s,
                    wohneinheit_id: e.target.value,
                    zimmer_id: "",
                  }))
                }
              >
                <option value="">–</option>
                {einheitenDesGebaeudes.map((e) => (
                  <option key={e.wohneinheit_id} value={e.wohneinheit_id}>
                    {e.name}
                    {e.etage_label ? ` · ${e.etage_label}` : ""} — {e.frei} frei
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Zimmer (optional)
              <select
                className="ml-2"
                value={ziel.zimmer_id}
                disabled={!ziel.wohneinheit_id}
                onChange={(e) =>
                  setZiel((s) => ({ ...s, zimmer_id: e.target.value }))
                }
              >
                <option value="">– noch offen –</option>
                {zimmerDerEinheit.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nummer}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              Geplant ab
              <input
                type="date"
                className="ml-2"
                value={ziel.geplant_ab}
                onChange={(e) =>
                  setZiel((s) => ({ ...s, geplant_ab: e.target.value }))
                }
              />
            </label>
            <button className="btn" onClick={zuordnungAnlegen}>
              Schwebend zuordnen
            </button>
          </div>
        </div>
      </section>

      {/* --- Schwebende Zuordnungen --- */}
      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-800">
          Schwebend ({zuordnungen.length})
        </h2>
        {zuordnungen.length === 0 ? (
          <p className="text-sm text-neutral-400">keine offenen Zuordnungen.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Herkunft</th>
                <th>Gebäude</th>
                <th>Wohneinheit</th>
                <th>Zimmer</th>
                <th>ab</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {zuordnungen.map((z) => {
                const zimmerWahl = zimmer.filter(
                  (x) => x.wohneinheit_id === z.wohneinheit_id
                );
                return (
                  <tr key={z.id}>
                    <td>
                      {z.vorname} {z.name}{" "}
                      <span className="text-neutral-400">({z.personal_nr})</span>
                    </td>
                    <td>{z.herkunft ?? "—"}</td>
                    <td>{z.gebaeude_name}</td>
                    <td>
                      {z.wohneinheit_name}
                      {z.etage_label ? ` · ${z.etage_label}` : ""}
                    </td>
                    <td>
                      <select
                        value={z.zimmer_id ?? ""}
                        onChange={(e) => zuordnungZimmerSetzen(z, e.target.value)}
                      >
                        <option value="">– offen –</option>
                        {zimmerWahl.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nummer}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDatumDE(z.geplant_ab)}</td>
                    <td>
                      <button
                        className="btn-danger"
                        onClick={() => zuordnungStornieren(z)}
                      >
                        Aufheben
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Laufende Belegungen (fest) --- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-neutral-800">Fest belegt</h2>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={nurLaufend}
              onChange={(e) => setNurLaufend(e.target.checked)}
            />
            nur laufende &amp; künftige
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>Gebäude</th>
              <th>Zimmer</th>
              <th>Bett</th>
              <th>Mitarbeiter</th>
              <th>Von</th>
              <th>Bis</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => {
              const wer = z.employee
                ? `${z.employee.vorname} ${z.employee.name}`
                : "?";
              return (
                <tr key={z.id}>
                  <td>{z.gebaeude_name}</td>
                  <td>{z.zimmer_nummer}</td>
                  <td>{z.bett_bezeichnung}</td>
                  <td>
                    {wer}
                    {z.employee ? ` (${z.employee.personal_nr})` : ""}
                  </td>
                  <td>{formatDatumDE(z.von)}</td>
                  <td>{z.bis ? formatDatumDE(z.bis) : "offen"}</td>
                  <td className="whitespace-nowrap">
                    {z.bis === null && (
                      <button
                        className="btn-secondary mr-1"
                        onClick={() => auszugEintragen(z.id, wer)}
                      >
                        Auszug
                      </button>
                    )}
                    <button
                      className="btn-danger"
                      onClick={() => belegungLoeschen(z.id)}
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              );
            })}
            {zeilen.length === 0 && (
              <tr>
                <td colSpan={7} className="text-sm text-neutral-400">
                  keine Belegungen
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* --- Direkt belegen (Notnagel, ohne Übergabe) --- */}
      <details className="rounded border border-neutral-200 p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Direkt belegen (ohne Übergabe)
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label>
            Gebäude
            <select
              className="ml-2"
              value={neu.gebaeude_id}
              onChange={(e) =>
                setNeu((s) => ({
                  ...s,
                  gebaeude_id: e.target.value,
                  zimmer_id: "",
                  bett_id: "",
                }))
              }
            >
              <option value="">–</option>
              {gebaeude.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zimmer
            <select
              className="ml-2"
              value={neu.zimmer_id}
              disabled={!neu.gebaeude_id}
              onChange={(e) =>
                setNeu((s) => ({ ...s, zimmer_id: e.target.value, bett_id: "" }))
              }
            >
              <option value="">–</option>
              {zimmerDesGebaeudes.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nummer}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bett
            <select
              className="ml-2"
              value={neu.bett_id}
              disabled={!neu.zimmer_id}
              onChange={(e) => setNeu((s) => ({ ...s, bett_id: e.target.value }))}
            >
              <option value="">–</option>
              {bettenDesZimmers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bezeichnung} — {bettInfo(b.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mitarbeiter
            <select
              className="ml-2"
              value={neu.employee_id}
              onChange={(e) =>
                setNeu((s) => ({ ...s, employee_id: e.target.value }))
              }
            >
              <option value="">–</option>
              {employees
                .filter((e) => e.aktiv || e.id === neu.employee_id)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.vorname} {e.name} ({e.personal_nr})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Von
            <input
              type="date"
              className="ml-2"
              value={neu.von}
              onChange={(e) => setNeu((s) => ({ ...s, von: e.target.value }))}
            />
          </label>
          <label>
            Bis
            <input
              type="date"
              className="ml-2"
              value={neu.bis}
              onChange={(e) => setNeu((s) => ({ ...s, bis: e.target.value }))}
            />
          </label>
          <button className="btn" onClick={direktAnlegen}>
            Belegung anlegen
          </button>
        </div>
      </details>
    </div>
  );
}
