"use client";

// "Änderungsprotokoll" (Nutzer-Vorgabe 2026-08-11, nur admin): macht das
// seit Beginn mitlaufende Audit-Log sichtbar - wer hat wann was geändert.
// Die Daten selbst gab es schon (Trigger write_audit_log auf employees,
// work_entries, advances, Prämien, Kassenbuch, Dokumenten, Monatsabschluss
// und Kandidaten), es fehlte nur die Anzeige.
//
// Bewusst admin-only: die Einträge enthalten ganze Datensätze und damit
// auch sensible Felder (IBAN, SV-Nr.). Die Datenbank-Policy erlaubt
// zusätzlich der Rolle pruefer den Lesezugriff (bestehende Regelung für
// die Kassenprüfung) - diese Detailansicht hier bleibt trotzdem admin.

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { AuditLogEintrag, Employee } from "@/lib/types";
import { formatDatumDE } from "@/lib/format";
import {
  BEREICH_LABELS,
  aktionLabel,
  bereichLabel,
  feldAenderungen,
} from "@/lib/auditLog";

const SEITENGROESSE = 100;

function formatZeitpunktDE(iso: string): string {
  const d = new Date(iso);
  return `${formatDatumDE(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function AenderungsprotokollPage() {
  const { profile } = useProfile();
  const istAdmin = profile?.role === "admin";

  const [eintraege, setEintraege] = useState<AuditLogEintrag[]>([]);
  const [loading, setLoading] = useState(true);
  const [offenId, setOffenId] = useState<number | null>(null);

  const [bereich, setBereich] = useState("");
  const [personSuche, setPersonSuche] = useState("");
  const [vonDatum, setVonDatum] = useState("");
  const [bisDatum, setBisDatum] = useState("");

  // Für den Personenfilter und die Anzeige "wen betrifft der Eintrag".
  const [personen, setPersonen] = useState<
    Record<string, { personal_nr: string; name: string; vorname: string }>
  >({});

  useEffect(() => {
    async function ladePersonen() {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("employees")
        .select("id, personal_nr, name, vorname");
      const map: Record<
        string,
        { personal_nr: string; name: string; vorname: string }
      > = {};
      ((data as Employee[]) ?? []).forEach((e) => {
        map[e.id] = {
          personal_nr: e.personal_nr,
          name: e.name,
          vorname: e.vorname,
        };
      });
      setPersonen(map);
    }
    if (istAdmin) ladePersonen();
  }, [istAdmin]);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase
      .from("audit_log_ansicht")
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(SEITENGROESSE);
    if (bereich) query = query.eq("entity", bereich);
    if (vonDatum) query = query.gte("occurred_at", vonDatum);
    // bis einschließlich: auf den Folgetag begrenzen, sonst fehlt der
    // gewählte Tag selbst (occurred_at hat eine Uhrzeit).
    if (bisDatum) query = query.lt("occurred_at", `${bisDatum}T23:59:59`);
    const { data } = await query;
    setEintraege((data as AuditLogEintrag[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (istAdmin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [istAdmin, bereich, vonDatum, bisDatum]);

  if (!istAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-emerald-800">
          Änderungsprotokoll
        </h1>
        <p className="text-neutral-500">
          Das Änderungsprotokoll enthält vollständige Datensätze inklusive
          sensibler Felder und ist deshalb nur für die Rolle admin sichtbar.
        </p>
      </div>
    );
  }

  // Personenfilter clientseitig: die Suche geht über Name/Personalnummer,
  // im Protokoll steht aber nur die ID - der Abgleich braucht also die
  // ohnehin geladene Personenliste.
  const gefiltert = eintraege.filter((e) => {
    if (!personSuche) return true;
    const q = personSuche.toLowerCase();
    const p = e.betroffene_employee_id
      ? personen[e.betroffene_employee_id]
      : undefined;
    if (!p) return false;
    return (
      p.name.toLowerCase().includes(q) ||
      p.vorname.toLowerCase().includes(q) ||
      p.personal_nr.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Änderungsprotokoll
        </h1>
        <p className="text-sm text-neutral-500">
          Wer hat wann was geändert - lückenlos mitgeschrieben seit Beginn
          (Personalstamm, Stunden, Vorschüsse, Prämien, Kassenbuch,
          Dokumente, Monatsabschluss, Personalplanung). Aufklappen zeigt die
          einzelnen Feldänderungen. Die Liste zeigt die neuesten{" "}
          {SEITENGROESSE} Einträge des gewählten Filters.
        </p>
      </div>

      <div className="sticky top-14 z-30 flex flex-wrap items-center gap-3 bg-sand py-2 text-sm">
        <input
          placeholder="Person (Name oder Personalnummer)…"
          value={personSuche}
          onChange={(e) => setPersonSuche(e.target.value)}
          className="w-64"
        />
        <label>
          Bereich{" "}
          <select value={bereich} onChange={(e) => setBereich(e.target.value)}>
            <option value="">alle</option>
            {Object.keys(BEREICH_LABELS).map((k) => (
              <option key={k} value={k}>
                {BEREICH_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          von{" "}
          <input
            type="date"
            value={vonDatum}
            onChange={(e) => setVonDatum(e.target.value)}
          />
        </label>
        <label>
          bis{" "}
          <input
            type="date"
            value={bisDatum}
            onChange={(e) => setBisDatum(e.target.value)}
          />
        </label>
        {(personSuche || bereich || vonDatum || bisDatum) && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              setPersonSuche("");
              setBereich("");
              setVonDatum("");
              setBisDatum("");
            }}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : gefiltert.length === 0 ? (
        <p className="text-neutral-500">
          Keine Einträge für diesen Filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Zeitpunkt</th>
                <th>Nutzer</th>
                <th>Bereich</th>
                <th>Aktion</th>
                <th>Betrifft</th>
                <th>Geänderte Felder</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((e) => {
                const aenderungen = feldAenderungen(e);
                const person = e.betroffene_employee_id
                  ? personen[e.betroffene_employee_id]
                  : undefined;
                const offen = offenId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="whitespace-nowrap">
                        {formatZeitpunktDE(e.occurred_at)}
                      </td>
                      <td>
                        {e.actor_name ?? (
                          <span
                            className="text-neutral-400"
                            title="Änderung ohne angemeldeten Nutzer - z.B. durch ein Datenbank-Skript"
                          >
                            System
                          </span>
                        )}
                      </td>
                      <td>{bereichLabel(e.entity)}</td>
                      <td>{aktionLabel(e.action)}</td>
                      <td>
                        {person ? (
                          `${person.name}, ${person.vorname} (${person.personal_nr})`
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="text-sm">
                        {aenderungen.length === 0 ? (
                          <span className="text-neutral-400">
                            keine inhaltliche Änderung
                          </span>
                        ) : (
                          aenderungen.map((a) => a.feld).join(", ")
                        )}
                      </td>
                      <td>
                        {aenderungen.length > 0 && (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => setOffenId(offen ? null : e.id)}
                          >
                            {offen ? "Schließen" : "Details"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {offen && (
                      <tr>
                        <td colSpan={7} className="bg-sand">
                          <table>
                            <thead>
                              <tr>
                                <th>Feld</th>
                                <th>Vorher</th>
                                <th>Nachher</th>
                              </tr>
                            </thead>
                            <tbody>
                              {aenderungen.map((a) => (
                                <tr key={a.feld}>
                                  <td>{a.feld}</td>
                                  <td className="text-neutral-500">
                                    {a.vorher}
                                  </td>
                                  <td className="font-medium">{a.nachher}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
