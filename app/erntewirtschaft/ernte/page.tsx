"use client";

// Erntewirtschaft -> Ernte: die Kisten-Zyklen-Tabelle (docs/erntewirtschaft-plan.md
// Teil F). Zeigt, was der Processor (ernte_scan_verarbeiten(), migration_2026-10-20)
// aus den rohen Scans gemacht hat - eine Zeile je Befuell-/Wiege-Runde, mit
// Maschine/Fahrer/Feld/Gewicht/Status. Nachträgliches Zuordnen einer Person
// (admin/hr) direkt in der Liste, wie bei FahrerZelle in
// app/fahrzeuge/stammdaten/page.tsx.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatMenge } from "@/lib/format";

type EmpOpt = {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
};

type ZyklusStatus = "offen" | "gewogen" | "verworfen" | "ungeklaert";

interface KisteZyklusZeile {
  id: number;
  tag_uid: string;
  befuellt_am: string;
  voll_am: string | null;
  gewogen_am: string | null;
  gewicht_netto_kg: number | null;
  status: ZyklusStatus;
  employee_id: string | null;
  ernte_maschine: { nummer: string; bezeichnung: string | null } | null;
  employees: { name: string; vorname: string; personal_nr: string } | null;
  feld: { bezeichnung: string } | null;
}

const STATUS_LABEL: Record<ZyklusStatus, string> = {
  offen: "offen",
  gewogen: "gewogen",
  verworfen: "verworfen",
  ungeklaert: "ungeklärt",
};

const STATUS_BADGE: Record<ZyklusStatus, string> = {
  offen: "badge badge-info",
  gewogen: "badge badge-ok",
  verworfen: "badge badge-danger",
  ungeklaert: "badge badge-warn",
};

function formatZeitpunktDE(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function heuteIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function vorTagenIso(tage: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - tage);
  return d.toISOString().slice(0, 10);
}

// Nachträgliches Zuordnen einer Person - exakt dasselbe Muster wie
// FahrerZelle in app/fahrzeuge/stammdaten/page.tsx, nur auf
// ernte_kiste_zyklus.employee_id statt fahrzeug.fahrer_employee_id.
function FahrerZelle({
  zyklus,
  mitarbeiter,
  canEdit,
  onGesetzt,
}: {
  zyklus: KisteZyklusZeile;
  mitarbeiter: EmpOpt[];
  canEdit: boolean;
  onGesetzt: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [speichert, setSpeichert] = useState(false);

  const aktuell = zyklus.employees;

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = q
      ? mitarbeiter.filter(
          (m) =>
            `${m.name} ${m.vorname}`.toLowerCase().includes(q) ||
            `${m.vorname} ${m.name}`.toLowerCase().includes(q) ||
            (m.personal_nr ?? "").toLowerCase().includes(q)
        )
      : mitarbeiter;
    return liste.slice(0, 8);
  }, [suche, mitarbeiter]);

  async function setze(id: string | null) {
    setSpeichert(true);
    const { error } = await getSupabaseClient()
      .from("ernte_kiste_zyklus")
      .update({ employee_id: id })
      .eq("id", zyklus.id);
    setSpeichert(false);
    if (!error) {
      setOffen(false);
      setSuche("");
      onGesetzt();
    }
  }

  if (!canEdit) {
    return <>{aktuell ? `${aktuell.name}, ${aktuell.vorname}` : "ohne Zuordnung"}</>;
  }

  if (!offen) {
    return (
      <button
        type="button"
        className="text-left hover:underline"
        onClick={() => setOffen(true)}
      >
        {aktuell ? (
          `${aktuell.name}, ${aktuell.vorname}`
        ) : (
          <span className="text-emerald-700">+ Person zuordnen</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex min-w-[13rem] flex-col gap-1">
      <input
        autoFocus
        className="w-full text-sm"
        placeholder="Name oder Personalnr."
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
      />
      <div className="max-h-44 overflow-auto rounded border border-linie bg-white">
        {treffer.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={speichert}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-sand disabled:opacity-50"
            onClick={() => setze(m.id)}
          >
            {m.name}, {m.vorname}{" "}
            <span className="text-neutral-400">({m.personal_nr})</span>
          </button>
        ))}
        {treffer.length === 0 && (
          <p className="px-2 py-1 text-sm text-neutral-400">nichts gefunden</p>
        )}
      </div>
      <div className="flex gap-3 text-xs">
        {zyklus.employee_id && (
          <button
            type="button"
            className="text-beere-600"
            disabled={speichert}
            onClick={() => setze(null)}
          >
            Zuordnung entfernen
          </button>
        )}
        <button
          type="button"
          className="text-neutral-500"
          onClick={() => {
            setOffen(false);
            setSuche("");
          }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function csvExport(zeilen: KisteZyklusZeile[]) {
  const kopf = [
    "Befüllt",
    "Maschine",
    "Fahrer",
    "Feld",
    "Netto kg",
    "Gewogen",
    "Status",
  ];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const zeile = (z: KisteZyklusZeile) =>
    [
      formatZeitpunktDE(z.befuellt_am),
      z.ernte_maschine?.bezeichnung ?? z.ernte_maschine?.nummer ?? "",
      z.employees ? `${z.employees.name}, ${z.employees.vorname}` : "ohne Zuordnung",
      z.feld?.bezeichnung ?? "",
      z.gewicht_netto_kg != null ? formatMenge(z.gewicht_netto_kg) : "",
      formatZeitpunktDE(z.gewogen_am),
      STATUS_LABEL[z.status],
    ]
      .map((x) => esc(String(x)))
      .join(";");
  const csv = [kopf.join(";"), ...zeilen.map(zeile)].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kisten-zyklen_${heuteIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ErntewirtschaftErntePage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [datumAb, setDatumAb] = useState(vorTagenIso(7));
  const [nurLuecken, setNurLuecken] = useState(false);
  const [nurOhneZuordnung, setNurOhneZuordnung] = useState(false);
  const [zyklen, setZyklen] = useState<KisteZyklusZeile[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<EmpOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();

    let query = supabase
      .from("ernte_kiste_zyklus")
      .select(
        `id, tag_uid, befuellt_am, voll_am, gewogen_am, gewicht_netto_kg, status, employee_id,
         ernte_maschine(nummer, bezeichnung),
         employees(name, vorname, personal_nr),
         feld(bezeichnung)`
      )
      .gte("befuellt_am", `${datumAb}T00:00:00Z`)
      .order("befuellt_am", { ascending: false });

    if (nurLuecken) query = query.in("status", ["offen", "ungeklaert"]);
    if (nurOhneZuordnung) query = query.is("employee_id", null);

    const [{ data, error }, { data: mitarbeiterData }] = await Promise.all([
      query,
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname")
        .eq("aktiv", true)
        .order("name"),
    ]);

    setFehler(error?.message ?? null);
    setZyklen((data as unknown as KisteZyklusZeile[]) ?? []);
    setMitarbeiter((mitarbeiterData as EmpOpt[]) ?? []);
    setLoading(false);
  }, [datumAb, nurLuecken, nurOhneZuordnung]);

  useEffect(() => {
    laden();
  }, [laden]);

  const summeNettoKg = zyklen.reduce((s, z) => s + (z.gewicht_netto_kg ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Boxes}
        titel="Ernte"
        beschreibung="Kisten-Zyklen - vom Scan an der Maschine bis zur Wiegung an der Hofwaage."
        aktionen={
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={zyklen.length === 0}
            onClick={() => csvExport(zyklen)}
          >
            CSV-Export
          </button>
        }
      />

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-4 bg-sand py-2 print:hidden">
        <label className="text-sm">
          Zeitraum ab{" "}
          <input
            type="date"
            value={datumAb}
            onChange={(e) => setDatumAb(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={nurLuecken}
            onChange={(e) => setNurLuecken(e.target.checked)}
          />
          nur Lücken (offen/ungeklärt)
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={nurOhneZuordnung}
            onChange={(e) => setNurOhneZuordnung(e.target.checked)}
          />
          nur ohne Zuordnung
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="card">
          <p className="text-xs text-neutral-500">Kisten (gefiltert)</p>
          <p className="text-2xl font-semibold text-emerald-900">{zyklen.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-neutral-500">Summe netto kg</p>
          <p className="text-2xl font-semibold text-emerald-900">
            {formatMenge(summeNettoKg)} kg
          </p>
        </div>
      </div>

      {fehler && <p className="text-sm text-beere-700">Konnte nicht laden: {fehler}</p>}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : zyklen.length === 0 ? (
        <EmptyState
          icon={Boxes}
          text="Keine Kisten-Zyklen für diesen Filter."
          hinweis="Läuft der pg_cron-Processor? Rohdaten liegen sonst nur in ernte_scan."
        />
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Befüllt</th>
                <th>Maschine</th>
                <th>Fahrer</th>
                <th>Feld</th>
                <th>Netto kg</th>
                <th>Gewogen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {zyklen.map((z) => (
                <tr key={z.id}>
                  <td className="whitespace-nowrap">{formatZeitpunktDE(z.befuellt_am)}</td>
                  <td>{z.ernte_maschine?.bezeichnung ?? z.ernte_maschine?.nummer ?? "—"}</td>
                  <td>
                    <FahrerZelle
                      zyklus={z}
                      mitarbeiter={mitarbeiter}
                      canEdit={canEdit}
                      onGesetzt={laden}
                    />
                  </td>
                  <td>{z.feld?.bezeichnung ?? "—"}</td>
                  <td>{z.gewicht_netto_kg != null ? `${formatMenge(z.gewicht_netto_kg)} kg` : "—"}</td>
                  <td className="whitespace-nowrap">{formatZeitpunktDE(z.gewogen_am)}</td>
                  <td>
                    <span className={STATUS_BADGE[z.status]}>{STATUS_LABEL[z.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
