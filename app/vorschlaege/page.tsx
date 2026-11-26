"use client";

// Vorschläge (nur Admin): alles, was über die Glühbirne "Änderung
// vorschlagen" eingereicht wurde (components/VorschlagKnopf.tsx, Nutzer
// 2026-11-26). Seite, Text, Bildschirmfoto mit Markierungen, wer und wann;
// Status zum Abarbeiten und eine eigene Notiz.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lightbulb, Trash2, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";

type Status = "offen" | "in_arbeit" | "erledigt" | "abgelehnt";
type Vorschlag = {
  id: number;
  erstellt_am: string;
  erstellt_von: string | null;
  seite: string;
  seite_titel: string | null;
  text: string;
  screenshot: string | null;
  status: Status;
  admin_notiz: string | null;
  erledigt_am: string | null;
};
const STATUS: { wert: Status; label: string; klasse: string }[] = [
  { wert: "offen", label: "offen", klasse: "badge-warn" },
  { wert: "in_arbeit", label: "in Arbeit", klasse: "badge-info" },
  { wert: "erledigt", label: "erledigt", klasse: "badge-ok" },
  { wert: "abgelehnt", label: "abgelehnt", klasse: "badge-neutral" },
];

export default function VorschlaegePage() {
  const { profile, loading: profilLaedt } = useProfile();
  const istAdmin = hatRolle(profile, "admin");
  const [liste, setListe] = useState<Vorschlag[]>([]);
  const [namen, setNamen] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<Status | "alle">("offen");
  const [bild, setBild] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    const [v, p] = await Promise.all([
      sb.from("verbesserungsvorschlag").select("*").order("erstellt_am", { ascending: false }),
      sb.from("profiles").select("id, full_name"),
    ]);
    setFehler(v.error?.message ?? null);
    setListe((v.data as Vorschlag[]) ?? []);
    setNamen(new Map(((p.data as { id: string; full_name: string }[]) ?? []).map((x) => [x.id, x.full_name])));
    setLaedt(false);
  }, []);
  useEffect(() => {
    if (istAdmin) load();
  }, [istAdmin, load]);

  const zaehler = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of liste) m.set(v.status, (m.get(v.status) ?? 0) + 1);
    return m;
  }, [liste]);
  const sichtbar = liste.filter((v) => filter === "alle" || v.status === filter);

  async function aendern(id: number, teil: Partial<Vorschlag>) {
    const daten: Partial<Vorschlag> = { ...teil };
    if (teil.status) daten.erledigt_am = teil.status === "erledigt" || teil.status === "abgelehnt" ? new Date().toISOString() : null;
    const { error } = await getSupabaseClient().from("verbesserungsvorschlag").update(daten).eq("id", id);
    if (error) return setFehler(error.message);
    setListe((l) => l.map((v) => (v.id === id ? { ...v, ...daten } : v)));
  }
  async function loeschen(id: number) {
    if (!confirm("Vorschlag endgültig löschen?")) return;
    const { error } = await getSupabaseClient().from("verbesserungsvorschlag").delete().eq("id", id);
    if (error) return setFehler(error.message);
    setListe((l) => l.filter((v) => v.id !== id));
  }

  if (!profilLaedt && !istAdmin) return <p className="text-sm text-neutral-600">Nur für Admin.</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Lightbulb}
        titel="Vorschläge"
        beschreibung="Was über die Glühbirne „Änderung vorschlagen“ eingereicht wurde - mit Seite, Bildschirmfoto, wer und wann."
      />
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}
      <div className="flex flex-wrap gap-1 text-sm">
        {[...STATUS.map((s) => s.wert), "alle" as const].map((s) => (
          <button
            key={s}
            className={filter === s ? "btn px-3 py-1" : "btn-secondary px-3 py-1"}
            onClick={() => setFilter(s)}
          >
            {s === "alle" ? "alle" : STATUS.find((x) => x.wert === s)!.label} ({s === "alle" ? liste.length : zaehler.get(s) ?? 0})
          </button>
        ))}
      </div>

      {!laedt && sichtbar.length === 0 && <EmptyState icon={Lightbulb} text="Keine Vorschläge in dieser Ansicht." />}
      <div className="flex flex-col gap-3">
        {sichtbar.map((v) => {
          const st = STATUS.find((s) => s.wert === v.status)!;
          return (
            <div key={v.id} className="card flex flex-col gap-3 md:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={st.klasse}>{st.label}</span>
                  <span className="font-medium">{v.erstellt_von ? namen.get(v.erstellt_von) ?? "?" : "?"}</span>
                  <span className="text-neutral-500">
                    {new Date(v.erstellt_am).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  <Link href={v.seite} className="truncate font-mono text-xs text-emerald-700 underline" title="Seite öffnen">
                    {v.seite}
                  </Link>
                  {v.seite_titel && <span className="text-xs text-neutral-500">· {v.seite_titel}</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{v.text}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <select value={v.status} onChange={(e) => aendern(v.id, { status: e.target.value as Status })}>
                    {STATUS.map((s) => (
                      <option key={s.wert} value={s.wert}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="min-w-60 flex-1"
                    placeholder="eigene Notiz (z.B. erledigt in …)"
                    defaultValue={v.admin_notiz ?? ""}
                    onBlur={(e) => e.target.value !== (v.admin_notiz ?? "") && aendern(v.id, { admin_notiz: e.target.value || null })}
                  />
                  <button className="btn-secondary px-2" onClick={() => loeschen(v.id)} title="löschen">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {v.screenshot && (
                <button className="shrink-0 self-start" onClick={() => setBild(v.screenshot)} title="Bildschirmfoto groß ansehen">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.screenshot} alt="Bildschirmfoto" className="w-full rounded border border-linie md:w-72" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {bild && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onClick={() => setBild(null)}>
          <button className="absolute right-4 top-4 rounded-full bg-white p-1" onClick={() => setBild(null)}>
            <X className="h-6 w-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bild} alt="Bildschirmfoto" className="max-h-full max-w-full rounded" />
        </div>
      )}
    </div>
  );
}
