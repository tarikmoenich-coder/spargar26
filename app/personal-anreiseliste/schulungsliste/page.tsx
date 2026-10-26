"use client";

// Teilnehmer-Unterschriftenliste für Pflichtschulungen (Nutzer-Vorgabe
// 2026-10-26): druckbare Liste aller Personen, die aktuell auf der
// Anreiseliste stehen (personal_kandidaten.status = 'anreiseliste'), mit
// freiem Unterschriftsfeld je Person. Titel/Datum sind bewusst frei
// änderbar (Default "Arbeitssicherheits- und Hygieneschulung") statt fest
// verdrahtet, damit dieselbe Seite auch für künftige Pflichtschulungen
// reicht. Druckmuster (print-form-table, Unterschrift als leere Zelle)
// kopiert von app/vorschuesse/page.tsx.
//
// Prüfpunkt (Nutzer-Vorgabe 2026-10-26): "Jede Person muss auf mindestens
// einer Schulungsliste stehen." Beim Drucken wird deshalb für jede gerade
// angezeigte Person eine Zeile in schulung_teilnahme angelegt - das ist das
// "Gedächtnis", gegen das personal_kandidaten_checkliste.schulungsliste_
// erfuellt prüft (migration_2026-10-26_schulungsliste_pruefpunkt.sql).
// Gleiche Semantik wie das bestehende "Gedruckt"-Häkchen beim
// Arbeitsvertrag: markiert, dass das Dokument erzeugt/ausgegeben wurde,
// nicht dass jede Unterschrift tatsächlich geleistet wurde.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import PersonalTabs from "@/components/PersonalTabs";
import PageHeader from "@/components/PageHeader";
import { ClipboardCheck } from "lucide-react";

interface Teilnehmer {
  employeeId: string;
  personalNr: string;
  name: string;
  vorname: string;
}

function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function SchulungslistePage() {
  const { profile, loading: profilLaedt } = useProfile();
  const canView = profile?.role === "admin" || profile?.role === "hr";

  const [titel, setTitel] = useState("Arbeitssicherheits- und Hygieneschulung");
  const [datum, setDatum] = useState(heuteIso());
  const [teilnehmer, setTeilnehmer] = useState<Teilnehmer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [traegtEin, setTraegtEin] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    (async () => {
      const supabase = getSupabaseClient();
      const { data: kData, error: kErr } = await supabase
        .from("personal_kandidaten")
        .select("name, vorname, aktivierter_employee_id")
        .eq("status", "anreiseliste")
        .order("name");
      if (kErr) {
        setFehler(kErr.message);
        setLoading(false);
        return;
      }
      const employeeIds = (kData ?? [])
        .map((k) => k.aktivierter_employee_id as string | null)
        .filter((id): id is string => !!id);
      const { data: empData, error: empErr } = employeeIds.length
        ? await supabase.from("employees").select("id, personal_nr").in("id", employeeIds)
        : { data: [] as { id: string; personal_nr: string }[], error: null };
      if (empErr) {
        setFehler(empErr.message);
        setLoading(false);
        return;
      }
      const personalNrVonId = new Map((empData ?? []).map((e) => [e.id, e.personal_nr]));
      setTeilnehmer(
        (kData ?? [])
          .filter((k) => k.aktivierter_employee_id)
          .map((k) => {
            const employeeId = k.aktivierter_employee_id as string;
            return {
              employeeId,
              personalNr: personalNrVonId.get(employeeId) ?? "",
              name: k.name as string,
              vorname: k.vorname as string,
            };
          })
      );
      setLoading(false);
    })();
  }, [canView]);

  async function teilnahmeEintragenUndDrucken() {
    if (teilnehmer.length === 0) {
      window.print();
      return;
    }
    if (
      !window.confirm(
        `${teilnehmer.length} Person(en) als Teilnehmer von "${titel}" (${formatDatumDE(datum)}) eintragen und drucken?`
      )
    ) {
      return;
    }
    setTraegtEin(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("schulung_teilnahme").insert(
      teilnehmer.map((t) => ({
        employee_id: t.employeeId,
        titel,
        schulung_datum: datum,
      }))
    );
    setTraegtEin(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setHinweis(`Teilnahme für ${teilnehmer.length} Person(en) eingetragen.`);
    window.print();
  }

  if (profilLaedt) {
    return <p className="p-4 text-sm text-neutral-500">Lädt…</p>;
  }
  if (!canView) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        Die Unterschriftenliste ist nur für Admin/HR.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <PersonalTabs />
      </div>
      <div className="print:hidden">
        <PageHeader
          icon={ClipboardCheck}
          titel="Unterschriftenliste"
          beschreibung="Teilnehmerbestätigung für Pflichtschulungen - alle Personen aktuell auf der Anreiseliste. Drucken trägt sie als Schulungsteilnehmer ein (erfüllt den Checkliste-Punkt in der Anreiseliste)."
          aktionen={
            <button
              type="button"
              className="btn text-xs"
              disabled={traegtEin || loading}
              onClick={teilnahmeEintragenUndDrucken}
            >
              {traegtEin ? "Trage ein …" : "Teilnahme eintragen & drucken"}
            </button>
          }
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-0.5 text-sm">
          Titel
          <input
            className="w-96"
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          Datum
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </label>
      </div>

      {hinweis && <p className="text-sm text-emerald-700 print:hidden">{hinweis}</p>}
      {fehler && <p className="text-sm text-beere-700 print:hidden">Konnte nicht laden: {fehler}</p>}

      <div>
        <h2 className="text-xl font-semibold">{titel}</h2>
        <p className="mt-1 text-base">Datum: {formatDatumDE(datum)}</p>
        <p className="mt-1 text-sm text-neutral-600">
          Mit meiner Unterschrift bestätige ich die Teilnahme an der oben
          genannten Schulung.
        </p>

        {loading ? (
          <p className="mt-4 text-neutral-500">Lädt…</p>
        ) : teilnehmer.length === 0 ? (
          <p className="mt-4 text-neutral-500">Niemand aktuell auf der Anreiseliste.</p>
        ) : (
          <table className="mt-4 print-form-table">
            <thead>
              <tr>
                <th>Pers.-Nr.</th>
                <th>Name</th>
                <th className="min-w-[12rem]">Unterschrift</th>
              </tr>
            </thead>
            <tbody>
              {teilnehmer.map((t) => (
                <tr key={t.employeeId}>
                  <td>{t.personalNr}</td>
                  <td>
                    {t.name}, {t.vorname}
                  </td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
