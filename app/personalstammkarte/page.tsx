"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import { saisonsKompakt } from "@/lib/saisonHistorie";
import {
  ABRECHNUNGSART_LABELS,
  type Employee,
  type EmployeeSaisonJahr,
} from "@/lib/types";

interface Arbeitsgruppe {
  gruppe_nr: string;
  bezeichnung: string | null;
}

function Feld({ label, wert }: { label: string; wert: React.ReactNode }) {
  return (
    <div className="flex flex-col border-b border-linie py-1">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="text-sm">{wert || "—"}</span>
    </div>
  );
}

function StammkarteInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const { profile, loading: profilLaedt } = useProfile();
  const canView = profile?.role === "admin" || profile?.role === "hr";

  const [emp, setEmp] = useState<Employee | null>(null);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [jahre, setJahre] = useState<EmployeeSaisonJahr[]>([]);
  const [fsKategorien, setFsKategorien] = useState<string[] | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !canView) {
      setLaedt(false);
      return;
    }
    (async () => {
      const supabase = getSupabaseClient();
      const [empRes, grpRes, jahreRes, fsRes] = await Promise.all([
        supabase.from("employees").select("*").eq("id", id).maybeSingle(),
        supabase.from("arbeitsgruppen").select("gruppe_nr, bezeichnung"),
        supabase
          .from("employee_saison_jahre")
          .select("*")
          .eq("employee_id", id),
        supabase
          .from("employee_fuehrerschein_kategorien")
          .select("fuehrerschein_kategorien")
          .eq("employee_id", id)
          .maybeSingle(),
      ]);
      if (empRes.error || !empRes.data) {
        setFehler("Mitarbeiter nicht gefunden.");
        setLaedt(false);
        return;
      }
      setEmp(empRes.data as Employee);
      setGruppen((grpRes.data as Arbeitsgruppe[]) ?? []);
      setJahre((jahreRes.data as EmployeeSaisonJahr[]) ?? []);
      setFsKategorien(
        (fsRes.data as { fuehrerschein_kategorien: string[] | null } | null)
          ?.fuehrerschein_kategorien ?? null
      );
      setLaedt(false);
    })();
  }, [id, canView]);

  const gruppenLabel = useMemo(() => {
    const m: Record<string, string> = {};
    gruppen.forEach((g) => {
      m[g.gruppe_nr] = g.bezeichnung ?? g.gruppe_nr;
    });
    return m;
  }, [gruppen]);

  const historie = useMemo(() => {
    const sortiert = [...jahre].sort((a, b) => b.saison_jahr - a.saison_jahr);
    const alleJahre = sortiert.map((j) => j.saison_jahr);
    return {
      zeilen: sortiert,
      anzahl: sortiert.length,
      erste: alleJahre.length ? Math.min(...alleJahre) : null,
      letzte: alleJahre.length ? Math.max(...alleJahre) : null,
      kompakt: saisonsKompakt(alleJahre),
    };
  }, [jahre]);

  if (profilLaedt || laedt) {
    return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;
  }
  if (!canView) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        Die Personalstammkarte ist nur für Admin/HR.
      </p>
    );
  }
  if (!id || fehler || !emp) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        {fehler ?? "Kein Mitarbeiter angegeben (?id=…)."}
      </p>
    );
  }

  const fsKlassen = [
    emp.fuehrerschein_b ? "B" : null,
    emp.fuehrerschein_c ? "C" : null,
    ...(fsKategorien ?? []),
  ].filter((v, i, a) => v && a.indexOf(v) === i) as string[];

  return (
    <div className="stammkarte mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between print:hidden">
        <a href="/mitarbeiter" className="btn-secondary text-xs">
          ← Personalstamm
        </a>
        <button
          type="button"
          className="btn text-xs"
          onClick={() => window.print()}
        >
          Drucken
        </button>
      </div>

      <div className="flex items-end justify-between border-b-2 border-emerald-800 pb-2">
        <div>
          <h1 className="text-xl font-bold text-emerald-800">
            Personalstammkarte
          </h1>
          <p className="text-sm text-neutral-600">
            {emp.name}, {emp.vorname}
            {!emp.aktiv && " · inaktiv"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">
            {emp.personal_nr}
          </div>
          <div className="text-[10px] text-neutral-500">
            Stand {formatDatumDE(new Date().toISOString())}
          </div>
        </div>
      </div>

      {emp.schwarze_liste && (
        <div className="border border-red-400 bg-red-50 px-3 py-2 text-sm font-medium text-red-800 print:bg-white">
          ⚠ Schwarze Liste
          {emp.schwarze_liste_grund ? `: ${emp.schwarze_liste_grund}` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
        <Feld label="Name" wert={emp.name} />
        <Feld label="Vorname" wert={emp.vorname} />
        <Feld
          label="Geboren"
          wert={
            [
              emp.geburtsdatum ? formatDatumDE(emp.geburtsdatum) : "",
              emp.geburtsort,
            ]
              .filter(Boolean)
              .join(" in ") || "—"
          }
        />
        <Feld label="Geburtsname" wert={emp.geburtsname} />
        <Feld
          label="Staatsangeh. / Nat."
          wert={emp.staatsangehoerigkeit ?? emp.nationalitaet}
        />
        <Feld label="Herkunft" wert={emp.herkunft} />
        <Feld
          label="Gruppe"
          wert={
            emp.gruppe_nr
              ? `${emp.gruppe_nr} – ${gruppenLabel[emp.gruppe_nr] ?? "?"}`
              : "—"
          }
        />
        <Feld label="Geschlecht" wert={emp.geschlecht} />
        <Feld label="Familienstand" wert={emp.familienstand} />
        <Feld
          label="Anschrift"
          wert={
            [
              [emp.strasse, emp.hausnummer].filter(Boolean).join(" "),
              [emp.plz, emp.ort].filter(Boolean).join(" "),
              emp.land,
            ]
              .filter(Boolean)
              .join(", ") || "—"
          }
        />
        <Feld
          label="Abrechnungsart"
          wert={ABRECHNUNGSART_LABELS[emp.abrechnungsart]}
        />
        <Feld
          label="Stundenlohn (aktuell)"
          wert={emp.stundenlohn != null ? `${emp.stundenlohn.toFixed(2)} €` : "—"}
        />
        <Feld
          label="Führerschein"
          wert={fsKlassen.length ? fsKlassen.join(", ") : "—"}
        />
        <Feld label="SV-Nummer" wert={emp.sozialversicherungsnummer} />
        <Feld label="Steuer-ID" wert={emp.steuer_id} />
        <Feld label="IBAN" wert={emp.iban} />
        <Feld label="BIC" wert={emp.bic} />
        <Feld label="Zahlungsempfänger" wert={emp.zahlungsempfaenger} />
        <Feld
          label="Saison (aktuell)"
          wert={
            [formatDatumDE(emp.saison_beginn), formatDatumDE(emp.saison_ende)]
              .filter((v) => v && v !== "—")
              .join(" – ") || "—"
          }
        />
        <Feld label="Status" wert={emp.aktiv ? "aktiv" : "inaktiv"} />
        <Feld
          label="Statuswechsel aus Nr."
          wert={emp.vorgaenger_employee_id ? "ja (siehe Personalstamm)" : "—"}
        />
      </div>

      {emp.notiz && (
        <div className="border-b border-linie py-1">
          <span className="text-[10px] uppercase tracking-wide text-neutral-500">
            Notiz
          </span>
          <p className="whitespace-pre-wrap text-sm">{emp.notiz}</p>
        </div>
      )}

      <div>
        <h2 className="mb-1 mt-2 text-sm font-semibold text-emerald-800">
          Saison-Historie
        </h2>
        {historie.anzahl === 0 ? (
          <p className="text-sm text-neutral-500">
            Keine Saison-Historie hinterlegt.
          </p>
        ) : (
          <>
            <p className="mb-1 text-sm">
              <strong>{historie.anzahl}</strong> Saisons · erstmals{" "}
              <strong>{historie.erste}</strong> · zuletzt{" "}
              <strong>{historie.letzte}</strong>
              <span className="text-neutral-500"> · {historie.kompakt}</span>
            </p>
            <table>
              <thead>
                <tr>
                  <th>Jahr</th>
                  <th>Anwesend</th>
                  <th>Erfasste Stunden</th>
                  <th>Erfasste Tage</th>
                  <th>Quelle</th>
                </tr>
              </thead>
              <tbody>
                {historie.zeilen.map((j) => (
                  <tr key={j.saison_jahr}>
                    <td className="tabular-nums">{j.saison_jahr}</td>
                    <td>✓</td>
                    <td className="tabular-nums">
                      {j.stunden_gesamt != null
                        ? j.stunden_gesamt.toLocaleString("de-DE")
                        : "—"}
                    </td>
                    <td className="tabular-nums">{j.tage_erfasst ?? "—"}</td>
                    <td>
                      {j.aus_kartei && j.aus_erfassung
                        ? "Kartei + App"
                        : j.aus_erfassung
                        ? "App"
                        : "Kartei"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-neutral-500">
              „Kartei" = aus der importierten Papier-Personalkartei (nur
              Anwesenheit). „App" = in Spargar erfasste Saison.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function PersonalstammkartePage() {
  return (
    <Suspense
      fallback={<p className="p-4 text-sm text-neutral-500">Lädt …</p>}
    >
      <StammkarteInner />
    </Suspense>
  );
}
