"use client";

// Unterkunft → Belegung (Migration 2026-08-29): Mitarbeiter einem Bett
// zuweisen (von–bis). Doppelbelegung eines Bettes verhindert die Datenbank
// (EXCLUDE-Constraint) – die Fehlermeldung wird hier angezeigt.

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
  UnterkunftZimmer,
} from "@/lib/types";

interface EmployeeMini {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
  aktiv: boolean;
}

interface BelegungZeile extends UnterkunftBelegung {
  bett_bezeichnung: string;
  zimmer_id: number;
  zimmer_nummer: string;
  gebaeude_id: number;
  gebaeude_name: string;
  employee: EmployeeMini | undefined;
}

export default function UnterkunftBelegungPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "hausmeister";

  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [zimmer, setZimmer] = useState<UnterkunftZimmer[]>([]);
  const [betten, setBetten] = useState<UnterkunftBett[]>([]);
  const [belegungen, setBelegungen] = useState<UnterkunftBelegung[]>([]);
  const [employees, setEmployees] = useState<EmployeeMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [nurLaufend, setNurLaufend] = useState(true);

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
    const [g, z, b, bl, e] = await Promise.all([
      supabase.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      supabase.from("unterkunft_zimmer").select("*").eq("aktiv", true).order("nummer"),
      supabase.from("unterkunft_bett").select("*").eq("aktiv", true).order("bezeichnung"),
      supabase.from("unterkunft_belegung").select("*").order("von", { ascending: false }),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname, aktiv")
        .order("name"),
    ]);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setZimmer((z.data as UnterkunftZimmer[]) ?? []);
    setBetten((b.data as UnterkunftBett[]) ?? []);
    setBelegungen((bl.data as UnterkunftBelegung[]) ?? []);
    setEmployees((e.data as EmployeeMini[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  const zeilen: BelegungZeile[] = useMemo(() => {
    return belegungen
      .map((bl) => {
        const bett = betten.find((x) => x.id === bl.bett_id);
        const zim = bett ? zimmer.find((x) => x.id === bett.zimmer_id) : undefined;
        const geb = zim ? gebaeude.find((x) => x.id === zim.gebaeude_id) : undefined;
        return {
          ...bl,
          bett_bezeichnung: bett?.bezeichnung ?? "?",
          zimmer_id: zim?.id ?? 0,
          zimmer_nummer: zim?.nummer ?? "?",
          gebaeude_id: geb?.id ?? 0,
          gebaeude_name: geb?.name ?? "?",
          employee: employees.find((x) => x.id === bl.employee_id),
        };
      })
      .filter((z) => !nurLaufend || bl_laeuft_oder_kuenftig(z));
  }, [belegungen, betten, zimmer, gebaeude, employees, nurLaufend]);

  function bl_laeuft_oder_kuenftig(z: UnterkunftBelegung) {
    const heute = heuteIso();
    return z.bis === null || z.bis >= heute;
  }

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
    return `belegt: ${emp ? `${emp.vorname} ${emp.name}` : "?"}${
      laufend.bis ? ` bis ${formatDatumDE(laufend.bis)}` : ""
    }`;
  }

  async function anlegen() {
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

  async function auszugEintragen(zeile: BelegungZeile) {
    const vorschlag = heuteIso();
    const bis = window.prompt(
      `Auszugsdatum für ${zeile.employee?.vorname ?? ""} ${
        zeile.employee?.name ?? ""
      } (Bett ${zeile.zimmer_nummer}/${zeile.bett_bezeichnung})`,
      vorschlag
    );
    if (!bis) return;
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .update({ bis })
      .eq("id", zeile.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  async function loeschen(zeile: BelegungZeile) {
    if (!window.confirm("Diese Belegung löschen? (nur bei Fehleingabe)")) return;
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("unterkunft_belegung")
      .delete()
      .eq("id", zeile.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      <div>
        <h1 className="text-lg font-semibold text-emerald-900">Belegung</h1>
        <p className="text-sm text-neutral-500">
          Wer schläft in welchem Bett – Grundlage für Übergabe/Abnahme.
        </p>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {canEdit && (
        <section className="space-y-2 rounded border border-neutral-200 p-3">
          <h2 className="text-sm font-semibold">Neue Belegung</h2>
          <div className="flex flex-wrap items-end gap-2 text-sm">
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
                      {e.vorname} {e.name} ({e.personal_nr}){e.aktiv ? "" : " – inaktiv"}
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
              Bis (optional)
              <input
                type="date"
                className="ml-2"
                value={neu.bis}
                onChange={(e) => setNeu((s) => ({ ...s, bis: e.target.value }))}
              />
            </label>
            <button className="btn" onClick={anlegen}>
              Belegung anlegen
            </button>
          </div>
        </section>
      )}

      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={nurLaufend}
          onChange={(e) => setNurLaufend(e.target.checked)}
        />
        nur laufende und künftige Belegungen
      </label>

      <table>
        <thead>
          <tr>
            <th>Gebäude</th>
            <th>Zimmer</th>
            <th>Bett</th>
            <th>Mitarbeiter</th>
            <th>Von</th>
            <th>Bis</th>
            <th>Status</th>
            <th>Notiz</th>
            {canEdit && <th></th>}
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => {
            const laufend = belegungLaeuft(z.von, z.bis);
            const kuenftig = z.von > heuteIso();
            return (
              <tr key={z.id}>
                <td>{z.gebaeude_name}</td>
                <td>{z.zimmer_nummer}</td>
                <td>{z.bett_bezeichnung}</td>
                <td>
                  {z.employee
                    ? `${z.employee.vorname} ${z.employee.name} (${z.employee.personal_nr})`
                    : "?"}
                </td>
                <td>{formatDatumDE(z.von)}</td>
                <td>{z.bis ? formatDatumDE(z.bis) : "offen"}</td>
                <td>
                  {laufend ? (
                    <span className="font-medium text-emerald-700">läuft</span>
                  ) : kuenftig ? (
                    "künftig"
                  ) : (
                    <span className="text-neutral-400">beendet</span>
                  )}
                </td>
                <td>{z.notiz ?? "—"}</td>
                {canEdit && (
                  <td className="whitespace-nowrap">
                    {z.bis === null && (
                      <button
                        className="btn-secondary mr-1"
                        onClick={() => auszugEintragen(z)}
                      >
                        Auszug
                      </button>
                    )}
                    <button className="btn-danger" onClick={() => loeschen(z)}>
                      Löschen
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
          {zeilen.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 9 : 8} className="text-sm text-neutral-400">
                keine Belegungen
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
