"use client";

// Personalstammkarte (Druck-/PDF-Ausgabe) - Redesign nach Nutzer-Vorgabe
// 2026-11-04 ("professionelles, modernes A4-Personaldatenblatt"). Reine
// Layout-Überarbeitung - Datenanbindung/Ladefunktionen unverändert, nur um
// die Vorgänger-Namensauflösung (Statuswechsel-Zeile) ergänzt. 4 Abschnitte
// (01 Persönliche Daten, 02 Beschäftigungsdaten, 03 Abrechnung +
// Bankverbindung, 04 Saisonhistorie) statt der bisherigen durchgehenden
// 3-Spalten-Liste. Druck-Feinschliff (Seitenränder, Schriftgrößen,
// Seitenumbruch-Regeln) in app/globals.css unter ".stammkarte".
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE, formatMenge } from "@/lib/format";
import { saisonsKompakt } from "@/lib/saisonHistorie";
import { type Employee, type EmployeeSaisonJahr } from "@/lib/types";

interface Arbeitsgruppe {
  gruppe_nr: string;
  bezeichnung: string | null;
}

interface VorgaengerKurz {
  personal_nr: string;
  name: string;
  vorname: string;
}

const FOTO_BUCKET = "mitarbeiter-fotos";

// Volle, eindeutige Beschriftung nur für diese Druckansicht (Nutzer-Vorgabe
// 2026-11-04: prüfen, ob "Abrechnungsart" evtl. "Steuerklasse" heißen
// sollte). Bewusst NICHT umbenannt, da der Wert nur bei EINER der drei
// Ausprägungen überhaupt eine Steuerklasse ist ("pauschal" = Minijob,
// "sozialversicherungspflichtig" = SV-Pflicht, keine Steuerklasse) - eine
// Umbenennung des Feldnamens wäre für die anderen beiden irreführend.
// Stattdessen bleibt der Feldname, nur der Wert wird ausgeschrieben statt
// der App-weiten Kurzform (ABRECHNUNGSART_LABELS aus lib/types.ts, die
// bewusst kurz bleiben soll - siehe Kommentar dort - für Listen/Tabellen).
const ABRECHNUNGSART_VOLLTEXT: Record<Employee["abrechnungsart"], string> = {
  pauschal: "Pauschal (geringfügige Beschäftigung)",
  lohnsteuerklasse_1: "Lohnsteuerklasse 1",
  sozialversicherungspflichtig: "Sozialversicherungspflichtig",
};

// Gleiches Signier-Muster wie app/erntewirtschaft/ausweise/page.tsx -
// privater Bucket, Zugriff nur admin/hr (migration_2026-10-22_mitarbeiter_
// foto.sql), Anzeige über eine zeitlich begrenzte signierte URL. Rechteckig
// statt rund (Nutzer-Vorgabe: "einheitlich zugeschnitten" wie ein
// Ausweis-/Passfoto, nicht wie der runde Kiosk-Avatar).
function MitarbeiterFoto({ pfad }: { pfad: string | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pfad) {
      setUrl(null);
      return;
    }
    let abgebrochen = false;
    getSupabaseClient()
      .storage.from(FOTO_BUCKET)
      .createSignedUrl(pfad, 60)
      .then((r) => {
        if (!abgebrochen) setUrl(r.data?.signedUrl ?? null);
      });
    return () => {
      abgebrochen = true;
    };
  }, [pfad]);

  if (!url) {
    return (
      <div className="flex h-28 w-24 shrink-0 items-center justify-center rounded-sm border border-linie bg-sand text-center text-[8pt] text-neutral-400">
        kein Foto
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className="h-28 w-24 shrink-0 rounded-sm border border-linie object-cover"
    />
  );
}

// Einfache, lesbare Maskierung für den Datenschutz-Druck (Nutzer-Vorgabe):
// Anfang + Ende bleiben sichtbar, der Rest wird durch Punkte ersetzt -
// erkennbar, aber nicht mehr vollständig lesbar. Keine Formatierung in
// IBAN-4er-Blöcken nötig, reicht als einfache Druckvariante.
function maskiereWert(wert: string): string {
  const kompakt = wert.replace(/\s+/g, "");
  if (kompakt.length <= 6) return "•".repeat(kompakt.length);
  return `${kompakt.slice(0, 2)} •••• •••• ${kompakt.slice(-4)}`;
}

function Feld({
  label,
  wert,
  volleBreite,
  mono,
}: {
  label: string;
  wert: React.ReactNode;
  volleBreite?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={`flex flex-col border-b border-linie py-1 ${
        volleBreite ? "col-span-2 sm:col-span-3" : ""
      }`}
    >
      <span className="text-[8.5pt] uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span
        className={`text-[10.5pt] text-neutral-800 ${
          mono ? "break-all font-mono" : ""
        }`}
      >
        {wert || "—"}
      </span>
    </div>
  );
}

function Abschnitt({
  nr,
  titel,
  children,
}: {
  nr: string;
  titel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 flex items-baseline gap-2 border-b border-emerald-700/40 pb-1 text-[10.5pt] font-semibold uppercase tracking-wide text-emerald-800">
        <span className="text-neutral-400">{nr}</span> {titel}
      </h2>
      <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">{children}</div>
    </section>
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
  const [vorgaenger, setVorgaenger] = useState<VorgaengerKurz | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [maskiert, setMaskiert] = useState(false);

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
      const geladen = empRes.data as Employee;
      setEmp(geladen);
      setGruppen((grpRes.data as Arbeitsgruppe[]) ?? []);
      setJahre((jahreRes.data as EmployeeSaisonJahr[]) ?? []);
      setFsKategorien(
        (fsRes.data as { fuehrerschein_kategorien: string[] | null } | null)
          ?.fuehrerschein_kategorien ?? null
      );

      // Statuswechsel-Zeile: konkreten Vorgänger (Personalnummer + Name)
      // nachladen statt nur "ja (siehe Personalstamm)" anzuzeigen - die
      // Daten sind schon vorhanden, wurden bisher nur nicht abgefragt.
      if (geladen.vorgaenger_employee_id) {
        const { data: vData } = await supabase
          .from("employees")
          .select("personal_nr, name, vorname")
          .eq("id", geladen.vorgaenger_employee_id)
          .maybeSingle();
        setVorgaenger((vData as VorgaengerKurz | null) ?? null);
      }

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

  const anschrift =
    [
      [emp.strasse, emp.hausnummer].filter(Boolean).join(" "),
      [emp.plz, emp.ort].filter(Boolean).join(" "),
      emp.land,
    ]
      .filter(Boolean)
      .join(", ") || "";

  const geburtsortHerkunft =
    [emp.geburtsort, emp.herkunft && emp.herkunft !== emp.geburtsort ? `Herkunft: ${emp.herkunft}` : null]
      .filter(Boolean)
      .join(" · ") || "";

  const beschaeftigungszeitraum =
    [formatDatumDE(emp.saison_beginn), formatDatumDE(emp.saison_ende)]
      .filter((v) => v && v !== "—")
      .join(" – ") || "";

  const aktuelleSaison = emp.saison_beginn
    ? new Date(emp.saison_beginn).getFullYear()
    : historie.letzte ?? null;

  const svNr = emp.sozialversicherungsnummer
    ? maskiert
      ? maskiereWert(emp.sozialversicherungsnummer)
      : emp.sozialversicherungsnummer
    : "";
  const steuerId = emp.steuer_id
    ? maskiert
      ? maskiereWert(emp.steuer_id)
      : emp.steuer_id
    : "";
  const iban = emp.iban ? (maskiert ? maskiereWert(emp.iban) : emp.iban) : "";

  return (
    <div className="stammkarte mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <a href="/mitarbeiter" className="btn-secondary text-xs">
          ← Personalstamm
        </a>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input
              type="checkbox"
              checked={maskiert}
              onChange={(e) => setMaskiert(e.target.checked)}
            />
            Datenschutz-Druck (SV-Nr./Steuer-ID/IBAN maskieren)
          </label>
          <button
            type="button"
            className="btn text-xs"
            onClick={() => window.print()}
          >
            Drucken
          </button>
        </div>
      </div>

      {/* Kopfbereich */}
      <div className="flex items-start justify-between gap-4 border-b border-emerald-700 pb-3">
        <div className="flex items-start gap-4">
          <MitarbeiterFoto pfad={emp.foto_pfad ?? null} />
          <div>
            <h1 className="text-[17pt] font-semibold leading-tight text-emerald-800">
              Personalstammkarte
            </h1>
            <p className="mt-0.5 text-[13pt] font-medium text-neutral-800">
              {emp.name}, {emp.vorname}
            </p>
            <p className="mt-1 text-[9pt] text-neutral-500">
              Personalnummer{" "}
              <span className="font-semibold tabular-nums text-neutral-700">
                {emp.personal_nr}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className={`badge ${emp.aktiv ? "badge-ok" : "badge-neutral"}`}>
            {emp.aktiv ? "Aktiv" : "Inaktiv"}
          </span>
          <span className="whitespace-nowrap text-[8.5pt] text-neutral-400">
            Stand {formatDatumDE(new Date().toISOString())}
          </span>
        </div>
      </div>

      {/* Namentlicher Bezug auf jeder gedruckten Seite (Chrome wiederholt
         position:fixed-Elemente bei mehrseitigem Druck automatisch) -
         echte "Seite X von Y"-Zählung ist in HTML-Browserdruck nicht
         zuverlässig umsetzbar, siehe Hinweis an den Nutzer. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 hidden items-center justify-between px-[16mm] py-2 text-[7.5pt] text-neutral-400 print:flex">
        <span>
          {emp.name}, {emp.vorname} · Personalnummer {emp.personal_nr}
        </span>
        <span>Personalstammkarte · Stand {formatDatumDE(new Date().toISOString())}</span>
      </div>

      {emp.schwarze_liste && (
        <div className="border border-beere-400 bg-beere-50 px-3 py-2 text-sm font-medium text-beere-800 print:bg-white">
          ⚠ Schwarze Liste
          {emp.schwarze_liste_grund ? `: ${emp.schwarze_liste_grund}` : ""}
        </div>
      )}

      <Abschnitt nr="01" titel="Persönliche Daten">
        <Feld label="Nachname" wert={emp.name} />
        <Feld label="Vorname" wert={emp.vorname} />
        {emp.geburtsname && <Feld label="Geburtsname" wert={emp.geburtsname} />}
        <Feld
          label="Geburtsdatum"
          wert={emp.geburtsdatum ? formatDatumDE(emp.geburtsdatum) : ""}
        />
        {geburtsortHerkunft && (
          <Feld label="Geburtsort / Herkunft" wert={geburtsortHerkunft} />
        )}
        <Feld
          label="Staatsangeh. / Nat."
          wert={emp.staatsangehoerigkeit ?? emp.nationalitaet}
        />
        <Feld label="Geschlecht" wert={emp.geschlecht} />
        <Feld label="Familienstand" wert={emp.familienstand} />
        <Feld label="Anschrift" wert={anschrift} volleBreite />
      </Abschnitt>

      <Abschnitt nr="02" titel="Beschäftigungsdaten">
        <Feld
          label="Personalgruppe"
          wert={
            emp.gruppe_nr
              ? `${emp.gruppe_nr} – ${gruppenLabel[emp.gruppe_nr] ?? "?"}`
              : ""
          }
        />
        <Feld label="Beschäftigungsstatus" wert={emp.aktiv ? "Aktiv" : "Inaktiv"} />
        {historie.erste && (
          <Feld label="Erstmals beschäftigt" wert={`Saison ${historie.erste}`} />
        )}
        {beschaeftigungszeitraum && (
          <Feld
            label="Aktueller Beschäftigungszeitraum"
            wert={beschaeftigungszeitraum}
          />
        )}
        <Feld label="Aktuelle Saison" wert={aktuelleSaison ?? ""} />
        <Feld
          label="Aktueller Stundenlohn"
          wert={emp.stundenlohn != null ? `${formatMenge(emp.stundenlohn, 2)} €` : ""}
        />
        <Feld
          label="Führerschein"
          wert={fsKlassen.length ? fsKlassen.join(", ") : ""}
        />
        {emp.vorgaenger_employee_id && (
          <Feld
            label="Statuswechsel aus Personalnummer"
            wert={
              vorgaenger
                ? `${vorgaenger.personal_nr} (${vorgaenger.vorname} ${vorgaenger.name})`
                : "siehe Personalstamm"
            }
            volleBreite
          />
        )}
      </Abschnitt>

      <Abschnitt nr="03" titel="Abrechnung und Bankverbindung">
        <Feld
          label="Abrechnungsart"
          wert={ABRECHNUNGSART_VOLLTEXT[emp.abrechnungsart]}
        />
        <Feld label="SV-Nummer" wert={svNr} mono />
        <Feld label="Steuer-ID" wert={steuerId} mono />
        <Feld label="IBAN" wert={iban} volleBreite mono />
        <Feld label="BIC" wert={emp.bic} mono />
        <Feld label="Zahlungsempfänger" wert={emp.zahlungsempfaenger} />
      </Abschnitt>

      {emp.notiz && (
        <section className="break-inside-avoid border-b border-linie py-1">
          <span className="text-[8.5pt] uppercase tracking-wide text-neutral-500">
            Notiz
          </span>
          <p className="whitespace-pre-wrap text-[10.5pt] text-neutral-800">
            {emp.notiz}
          </p>
        </section>
      )}

      <section>
        <h2 className="mb-2 flex items-baseline gap-2 border-b border-emerald-700/40 pb-1 text-[10.5pt] font-semibold uppercase tracking-wide text-emerald-800">
          <span className="text-neutral-400">04</span> Saisonhistorie
        </h2>
        {historie.anzahl === 0 ? (
          <p className="text-[10.5pt] text-neutral-400">
            Keine Saisonhistorie hinterlegt.
          </p>
        ) : (
          <>
            <p className="mb-1 text-[9.5pt] text-neutral-600">
              <strong className="text-neutral-800">{historie.anzahl}</strong>{" "}
              Saisons · erstmals{" "}
              <strong className="text-neutral-800">{historie.erste}</strong> ·
              zuletzt{" "}
              <strong className="text-neutral-800">{historie.letzte}</strong>
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
            <p className="mt-1 text-[8.5pt] text-neutral-500">
              „Kartei" = aus der importierten Papier-Personalkartei (nur
              Anwesenheit). „App" = in Spargar erfasste Saison.
            </p>
          </>
        )}
      </section>
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
