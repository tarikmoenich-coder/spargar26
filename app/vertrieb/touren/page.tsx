"use client";

// Vertrieb → Touren (Vertriebsplanung V1, docs/vertriebsplanung-plan.md).
// Welche Stände sitzen zusammen im Auto: Touren für Montag-Samstag und
// eigene Touren für Sonntag (Nutzer-Vorgabe 2026-11-25). Je Stand
// "fährt mit" oder "nur Ware" (Verkäufer kommt selbst). Fahrer ist der
// Verkäufer des LETZTEN mitfahrenden Stands - er setzt die anderen ab und
// sammelt sie (mit Leergut und Restware) wieder ein.
// Drag & Drop (Nutzer 2026-11-26): Stände in den Tour-Karten an eine
// bestimmte Stelle derselben oder einer anderen Tour ziehen, aus "Ohne Tour"
// einplanen oder dorthin zurückziehen. Gespeichert wird sofort über
// rpc vt_touren_umbauen (Quelle + Ziel in einer Transaktion), mit
// "Rückgängig" für den letzten Schritt.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Car, GripVertical, Map as KartenIcon, Route, Undo2, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleMitFehler } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import { darf } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import VertriebTabs from "@/components/VertriebTabs";
import type { VtStand, VtStandZeit, VtTagesart, VtTour, VtTourStand } from "@/lib/types";
import { TAGESARTEN, WOCHENTAGE, fahrerStandId, offenAnTagesart, zeitInput, zeitKurz } from "@/lib/vertrieb";

type FahrzeugOpt = { id: number; bezeichnung: string; kennzeichen: string | null; aktiv: boolean };
type Eintrag = { stand_id: number; nur_ware: boolean };

// Drag & Drop: was gezogen wird und wohin es fallen würde
type Zug = { standId: number; vonTour: number | null; tagesart: VtTagesart };
type Ziel = { tourId: number | null; index: number }; // tourId null = "Ohne Tour"
type Umbau = {
  quelle: { tourId: number; liste: Eintrag[] } | null;
  ziel: { tourId: number; liste: Eintrag[] } | null;
};

interface TourForm {
  tagesart: VtTagesart;
  nummer: string;
  name: string;
  fahrzeug_id: string;
  abfahrt: string;
  aktiv: boolean;
  notiz: string;
  staende: Eintrag[];
}

// Hinweise zu einer Tour (rein informativ, gespeichert wird trotzdem).
function tourHinweise(
  eintraege: Eintrag[],
  tagesart: VtTagesart,
  zeiten: VtStandZeit[],
  standName: (id: number) => string
): string[] {
  const h: string[] = [];
  if (eintraege.length === 0) return ["Noch keine Stände in der Tour."];
  const fahrer = fahrerStandId(eintraege.map((e, i) => ({ ...e, reihenfolge: i + 1 })));
  if (fahrer == null) h.push('Kein Fahrer-Stand: alle Stände sind "nur Ware" - wer fährt das Auto?');
  const tage = TAGESARTEN.find((t) => t.wert === tagesart)!.tage;
  const offen = (id: number, tag: number) => zeiten.some((z) => z.stand_id === id && z.wochentag === tag);
  for (const e of eintraege)
    if (!tage.some((tag) => offen(e.stand_id, tag)))
      h.push(`${standName(e.stand_id)} ist an keinem Tag dieser Tour geöffnet.`);
  if (fahrer != null) {
    const tageOhneFahrer = tage.filter(
      (tag) => !offen(fahrer, tag) && eintraege.some((e) => e.stand_id !== fahrer && offen(e.stand_id, tag))
    );
    if (tageOhneFahrer.length)
      h.push(
        `Fahrer-Stand ${standName(fahrer)} ist am ${tageOhneFahrer
          .map((t) => WOCHENTAGE.find((w) => w.nr === t)!.kurz)
          .join(", ")} geschlossen, andere Stände der Tour sind offen.`
      );
  }
  return h;
}

export default function VertriebTourenPage() {
  const { profile } = useProfile();
  const darfPflegen = darf(profile, "vertrieb.planung:S");

  const [staende, setStaende] = useState<VtStand[]>([]);
  const [zeiten, setZeiten] = useState<VtStandZeit[]>([]);
  const [touren, setTouren] = useState<VtTour[]>([]);
  const [tourStaende, setTourStaende] = useState<VtTourStand[]>([]);
  const [fahrzeuge, setFahrzeuge] = useState<FahrzeugOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [bearbeite, setBearbeite] = useState<number | "neu" | null>(null);
  const [form, setForm] = useState<TourForm | null>(null);
  const [neuerStand, setNeuerStand] = useState("");
  const [speichert, setSpeichert] = useState(false);
  const [formFehler, setFormFehler] = useState<string | null>(null);

  const [zug, setZug] = useState<Zug | null>(null);
  const [ziel, setZiel] = useState<Ziel | null>(null);
  const [rueckgaengig, setRueckgaengig] = useState<{ umbau: Umbau; text: string } | null>(null);
  const [dndFehler, setDndFehler] = useState<string | null>(null);
  const [dndLaeuft, setDndLaeuft] = useState(false);

  const load = useCallback(async () => {
    const sb = getSupabaseClient();
    const [s, z, t, ts, f] = await Promise.all([
      sb.from("vt_stand").select("*").order("nummer"),
      ladeAlleMitFehler<VtStandZeit>((von, bis) => sb.from("vt_stand_zeit").select("*").order("id").range(von, bis)),
      sb.from("vt_tour").select("*").order("nummer"),
      sb.from("vt_tour_stand").select("*").order("reihenfolge"),
      // Fahrzeuge sieht nicht jede Rolle (fahrzeug_select) - dann leer.
      // Auch abgemeldete laden, damit ein bereits gesetztes Tour-Fahrzeug
      // mit Namen erscheint (zur Auswahl stehen nur angemeldete).
      sb.from("fahrzeug").select("id, bezeichnung, kennzeichen, aktiv").order("bezeichnung"),
    ]);
    const err = s.error ?? z.error ?? t.error ?? ts.error;
    setFehler(err ? err.message : null);
    setStaende((s.data as VtStand[]) ?? []);
    setZeiten((z.data as VtStandZeit[]) ?? []);
    setTouren((t.data as VtTour[]) ?? []);
    setTourStaende((ts.data as VtTourStand[]) ?? []);
    setFahrzeuge((f.data as FahrzeugOpt[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const standById = useMemo(() => new Map(staende.map((s) => [s.id, s])), [staende]);
  const standName = useCallback(
    (id: number) => {
      const s = standById.get(id);
      return s ? `${s.nummer} ${s.name}` : `#${id}`;
    },
    [standById]
  );
  const fahrzeugName = (id: number | null) => {
    if (id == null) return null;
    const f = fahrzeuge.find((x) => x.id === id);
    return f
      ? `${f.bezeichnung}${f.kennzeichen ? ` (${f.kennzeichen})` : ""}${f.aktiv ? "" : " – abgemeldet"}`
      : `Fahrzeug #${id}`;
  };

  const listeVon = useCallback(
    (tourId: number): Eintrag[] =>
      tourStaende
        .filter((x) => x.tour_id === tourId)
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((x) => ({ stand_id: x.stand_id, nur_ware: x.nur_ware })),
    [tourStaende]
  );

  // Umbau speichern und lokal sofort übernehmen (Fahrer/Hinweise rechnen neu)
  async function umbauen(u: Umbau): Promise<boolean> {
    setDndLaeuft(true);
    setDndFehler(null);
    const { error } = await getSupabaseClient().rpc("vt_touren_umbauen", {
      p_quelle_tour: u.quelle?.tourId ?? null,
      p_quelle_staende: u.quelle?.liste.map((e) => e.stand_id) ?? null,
      p_quelle_nur_ware: u.quelle?.liste.map((e) => e.nur_ware) ?? null,
      p_ziel_tour: u.ziel?.tourId ?? null,
      p_ziel_staende: u.ziel?.liste.map((e) => e.stand_id) ?? null,
      p_ziel_nur_ware: u.ziel?.liste.map((e) => e.nur_ware) ?? null,
    });
    setDndLaeuft(false);
    if (error) {
      setDndFehler(error.message);
      load();
      return false;
    }
    setTourStaende((alt) => {
      const betroffen = new Set([u.quelle?.tourId, u.ziel?.tourId].filter((x): x is number => x != null));
      const rest = alt.filter((x) => !betroffen.has(x.tour_id));
      const neu: VtTourStand[] = [];
      for (const teil of [u.quelle, u.ziel]) {
        if (!teil) continue;
        const tour = touren.find((t) => t.id === teil.tourId);
        if (!tour) continue;
        teil.liste.forEach((e, i) =>
          neu.push({
            id: -(teil.tourId * 1000 + i + 1),
            tour_id: teil.tourId,
            tagesart: tour.tagesart,
            stand_id: e.stand_id,
            reihenfolge: i + 1,
            nur_ware: e.nur_ware,
          } as VtTourStand)
        );
      }
      return [...rest, ...neu];
    });
    return true;
  }

  async function ablegen() {
    const z = zug;
    const d = ziel;
    setZug(null);
    setZiel(null);
    if (!z || !d || dndLaeuft) return;
    if (z.vonTour === null && d.tourId === null) return;
    const tourNr = (id: number | null) => (id == null ? "Ohne Tour" : `Tour ${touren.find((t) => t.id === id)?.nummer}`);

    const quelleAlt = z.vonTour != null ? listeVon(z.vonTour) : null;
    const eintrag = quelleAlt?.find((e) => e.stand_id === z.standId) ?? { stand_id: z.standId, nur_ware: false };

    let u: Umbau;
    if (z.vonTour != null && z.vonTour === d.tourId) {
      // innerhalb derselben Tour umsortieren
      const alt = quelleAlt!;
      const von = alt.findIndex((e) => e.stand_id === z.standId);
      const ohne = alt.filter((e) => e.stand_id !== z.standId);
      const pos = d.index > von ? d.index - 1 : d.index;
      if (pos === von) return;
      ohne.splice(pos, 0, eintrag);
      u = { quelle: { tourId: z.vonTour, liste: ohne }, ziel: null };
      if (await umbauen(u)) {
        setRueckgaengig({
          umbau: { quelle: { tourId: z.vonTour, liste: alt }, ziel: null },
          text: `${standName(z.standId)} in ${tourNr(z.vonTour)} umsortiert`,
        });
      }
      return;
    }
    const zielAlt = d.tourId != null ? listeVon(d.tourId) : null;
    const quelleNeu = quelleAlt?.filter((e) => e.stand_id !== z.standId) ?? null;
    const zielNeu = zielAlt ? [...zielAlt.slice(0, d.index), eintrag, ...zielAlt.slice(d.index)] : null;
    u = {
      quelle: z.vonTour != null ? { tourId: z.vonTour, liste: quelleNeu! } : null,
      ziel: d.tourId != null ? { tourId: d.tourId, liste: zielNeu! } : null,
    };
    if (await umbauen(u)) {
      // Rückweg: erst die Tour, die den Stand jetzt hat, wieder abgeben lassen
      setRueckgaengig({
        umbau: {
          quelle: d.tourId != null ? { tourId: d.tourId, liste: zielAlt! } : null,
          ziel: z.vonTour != null ? { tourId: z.vonTour, liste: quelleAlt! } : null,
        },
        text: `${standName(z.standId)}: ${tourNr(z.vonTour)} → ${tourNr(d.tourId)}`,
      });
    }
  }

  // Zielposition aus der Mausposition über einer Zeile (obere/untere Hälfte)
  function ueberZeile(ev: React.DragEvent, tourId: number, index: number) {
    if (!zug) return;
    const tour = touren.find((t) => t.id === tourId);
    if (!tour || tour.tagesart !== zug.tagesart) return;
    ev.preventDefault();
    ev.stopPropagation();
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const i = ev.clientY > r.top + r.height / 2 ? index + 1 : index;
    if (ziel?.tourId !== tourId || ziel.index !== i) setZiel({ tourId, index: i });
  }

  function ueberTourEnde(ev: React.DragEvent, tourId: number, anzahl: number) {
    if (!zug) return;
    const tour = touren.find((t) => t.id === tourId);
    if (!tour || tour.tagesart !== zug.tagesart) return;
    ev.preventDefault();
    if (ziel?.tourId !== tourId || ziel.index !== anzahl) setZiel({ tourId, index: anzahl });
  }

  const dndAktiv = darfPflegen && bearbeite === null;

  function neu(tagesart: VtTagesart) {
    const max = touren.filter((t) => t.tagesart === tagesart).reduce((m, t) => Math.max(m, t.nummer), 0);
    setForm({ tagesart, nummer: String(max + 1), name: "", fahrzeug_id: "", abfahrt: "", aktiv: true, notiz: "", staende: [] });
    setFormFehler(null);
    setNeuerStand("");
    setBearbeite("neu");
  }

  function bearbeiten(t: VtTour) {
    setForm({
      tagesart: t.tagesart,
      nummer: String(t.nummer),
      name: t.name ?? "",
      fahrzeug_id: t.fahrzeug_id != null ? String(t.fahrzeug_id) : "",
      abfahrt: zeitInput(t.abfahrt),
      aktiv: t.aktiv,
      notiz: t.notiz ?? "",
      staende: tourStaende
        .filter((x) => x.tour_id === t.id)
        .sort((a, b) => a.reihenfolge - b.reihenfolge)
        .map((x) => ({ stand_id: x.stand_id, nur_ware: x.nur_ware })),
    });
    setFormFehler(null);
    setNeuerStand("");
    setBearbeite(t.id);
  }

  // Stände, die für die Tour gewählt werden können: aktiv und nicht schon in
  // einer ANDEREN Tour derselben Tagesart.
  const waehlbar = useMemo(() => {
    if (!form) return [];
    const belegt = new Set(
      tourStaende.filter((x) => x.tagesart === form.tagesart && x.tour_id !== bearbeite).map((x) => x.stand_id)
    );
    const drin = new Set(form.staende.map((e) => e.stand_id));
    return staende.filter((s) => s.aktiv && !belegt.has(s.id) && !drin.has(s.id));
  }, [form, staende, tourStaende, bearbeite]);

  function verschieben(i: number, richtung: -1 | 1) {
    if (!form) return;
    const j = i + richtung;
    if (j < 0 || j >= form.staende.length) return;
    const neu = [...form.staende];
    [neu[i], neu[j]] = [neu[j], neu[i]];
    setForm({ ...form, staende: neu });
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setFormFehler(null);
    const nummer = Number(form.nummer);
    if (!Number.isInteger(nummer) || nummer <= 0) return setFormFehler("Tournummer muss eine positive ganze Zahl sein.");
    setSpeichert(true);
    const sb = getSupabaseClient();
    const daten = {
      tagesart: form.tagesart,
      nummer,
      name: form.name.trim() || null,
      fahrzeug_id: form.fahrzeug_id ? Number(form.fahrzeug_id) : null,
      abfahrt: form.abfahrt || null,
      aktiv: form.aktiv,
      notiz: form.notiz.trim() || null,
    };
    const res =
      bearbeite === "neu"
        ? await sb.from("vt_tour").insert(daten).select("id").single()
        : await sb.from("vt_tour").update(daten).eq("id", bearbeite as number).select("id").single();
    if (res.error) {
      setSpeichert(false);
      return setFormFehler(
        res.error.code === "23505" ? `Tour ${nummer} gibt es für diese Tagesart schon.` : res.error.message
      );
    }
    const tourId = (res.data as { id: number }).id;
    const rpc = await sb.rpc("vt_tour_staende_setzen", {
      p_tour_id: tourId,
      p_stand_ids: form.staende.map((x) => x.stand_id),
      p_nur_ware: form.staende.map((x) => x.nur_ware),
    });
    setSpeichert(false);
    if (rpc.error) {
      setBearbeite(tourId);
      load();
      return setFormFehler(`Tour gespeichert, Stände nicht: ${rpc.error.message}`);
    }
    setBearbeite(null);
    setForm(null);
    load();
  }

  async function loeschen() {
    if (typeof bearbeite !== "number") return;
    const t = touren.find((x) => x.id === bearbeite);
    if (!t || !confirm(`Tour ${t.nummer} löschen? Die Stände bleiben erhalten.`)) return;
    const { error } = await getSupabaseClient().from("vt_tour").delete().eq("id", t.id);
    if (error) return setFormFehler(error.message);
    setBearbeite(null);
    setForm(null);
    load();
  }

  const editor = form && darfPflegen && (
    <form onSubmit={speichern} className="card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-emerald-900">
          {bearbeite === "neu" ? "Neue Tour" : `Tour ${form.nummer} bearbeiten`} ·{" "}
          {TAGESARTEN.find((t) => t.wert === form.tagesart)!.label}
        </h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setBearbeite(null);
            setForm(null);
          }}
        >
          Schließen
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          Nr.
          <input type="number" min={1} required value={form.nummer} onChange={(e) => setForm({ ...form, nummer: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Name (optional)
          <input placeholder="z.B. Bergstraße" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Fahrzeug
          <select value={form.fahrzeug_id} onChange={(e) => setForm({ ...form, fahrzeug_id: e.target.value })}>
            <option value="">— offen —</option>
            {fahrzeuge
              .filter((f) => f.aktiv || String(f.id) === form.fahrzeug_id)
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.bezeichnung}
                  {f.kennzeichen ? ` (${f.kennzeichen})` : ""}
                  {f.aktiv ? "" : " – abgemeldet"}
                </option>
              ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Abfahrt Hof
          <input type="time" value={form.abfahrt} onChange={(e) => setForm({ ...form, abfahrt: e.target.value })} />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-4">
          Notiz
          <input value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={form.aktiv} onChange={(e) => setForm({ ...form, aktiv: e.target.checked })} />
          aktiv
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Stände in Fahrtreihenfolge</h3>
        {form.staende.length === 0 && <p className="text-sm text-neutral-500">Noch keine Stände.</p>}
        <ol className="flex flex-col gap-1.5">
          {form.staende.map((e, i) => {
            const fahrer = fahrerStandId(form.staende.map((x, k) => ({ ...x, reihenfolge: k + 1 })));
            return (
              <li key={e.stand_id} className="flex flex-wrap items-center gap-2 rounded border border-linie bg-white px-2 py-1.5 text-sm">
                <span className="w-6 text-right font-medium">{i + 1}.</span>
                <span className="min-w-40 flex-1">{standName(e.stand_id)}</span>
                {fahrer === e.stand_id && (
                  <span className="badge-info" title="Verkäufer dieses Stands fährt (Führerschein nötig)">
                    <Car className="mr-1 inline h-3.5 w-3.5" />
                    Fahrer
                  </span>
                )}
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={e.nur_ware}
                    onChange={(ev) =>
                      setForm({
                        ...form,
                        staende: form.staende.map((x, k) => (k === i ? { ...x, nur_ware: ev.target.checked } : x)),
                      })
                    }
                  />
                  nur Ware
                </label>
                <button type="button" className="btn-secondary px-2" disabled={i === 0} onClick={() => verschieben(i, -1)} title="nach oben">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  disabled={i === form.staende.length - 1}
                  onClick={() => verschieben(i, 1)}
                  title="nach unten"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-secondary px-2"
                  onClick={() => setForm({ ...form, staende: form.staende.filter((_, k) => k !== i) })}
                  title="aus der Tour nehmen"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <select value={neuerStand} onChange={(e) => setNeuerStand(e.target.value)}>
            <option value="">Stand hinzufügen …</option>
            {waehlbar.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nummer} {s.name}
                {offenAnTagesart(zeiten, s.id, form.tagesart) ? "" : " (an diesen Tagen zu)"}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn-secondary"
            disabled={!neuerStand}
            onClick={() => {
              setForm({ ...form, staende: [...form.staende, { stand_id: Number(neuerStand), nur_ware: false }] });
              setNeuerStand("");
            }}
          >
            Hinzufügen
          </button>
        </div>
        {tourHinweise(form.staende, form.tagesart, zeiten, standName).map((h) => (
          <p key={h} className="text-sm text-amber-700">
            ⚠ {h}
          </p>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn" disabled={speichert}>
          {speichert ? "Speichert…" : "Speichern"}
        </button>
        {bearbeite !== "neu" && (
          <button type="button" className="btn-danger" onClick={loeschen}>
            Löschen
          </button>
        )}
        {formFehler && <span className="text-sm text-beere-600">{formFehler}</span>}
      </div>
    </form>
  );

  return (
    <div className="flex flex-col gap-6">
      <VertriebTabs />
      <PageHeader
        icon={Route}
        titel="Touren"
        beschreibung="Welche Stände zusammen im Auto sitzen. Der Verkäufer des letzten mitfahrenden Stands fährt hin und zurück."
      />
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}
      {dndAktiv && (
        <p className="text-xs text-neutral-500 print:hidden">
          Stände mit der Maus an eine andere Stelle oder in eine andere Tour ziehen - auch aus „Ohne Tour“ und
          wieder zurück. Wird sofort gespeichert.
        </p>
      )}
      {dndFehler && <p className="text-sm text-beere-600">Verschieben nicht gespeichert: {dndFehler}</p>}
      {rueckgaengig && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-linie bg-white px-3 py-2 text-sm print:hidden">
          <span>{rueckgaengig.text}</span>
          <button
            className="btn-secondary flex items-center gap-1"
            disabled={dndLaeuft}
            onClick={async () => {
              if (await umbauen(rueckgaengig.umbau)) setRueckgaengig(null);
            }}
          >
            <Undo2 className="h-4 w-4" /> Rückgängig
          </button>
          <button className="text-neutral-500" onClick={() => setRueckgaengig(null)} title="Ausblenden">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!loading &&
        TAGESARTEN.map((ta) => {
          const liste = touren.filter((t) => t.tagesart === ta.wert);
          const inTour = new Set(tourStaende.filter((x) => x.tagesart === ta.wert).map((x) => x.stand_id));
          const ohneTour = staende.filter((s) => s.aktiv && !inTour.has(s.id) && offenAnTagesart(zeiten, s.id, ta.wert));
          return (
            <section key={ta.wert} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-emerald-900">
                  {ta.label} <span className="font-normal text-neutral-500">· {liste.length} Touren</span>
                </h2>
                {darfPflegen && (
                  <button className="btn-secondary" onClick={() => neu(ta.wert)}>
                    Neue Tour {ta.wert === "SO" ? "(Sonntag)" : "(Mo–Sa)"}
                  </button>
                )}
              </div>
              {bearbeite === "neu" && form?.tagesart === ta.wert && editor}
              {liste.length === 0 && bearbeite !== "neu" && <EmptyState icon={Route} text="Noch keine Touren." />}
              <div className="grid gap-3 lg:grid-cols-2">
                {liste.map((t) => {
                  if (bearbeite === t.id) return <div key={t.id} className="lg:col-span-2">{editor}</div>;
                  const eintraege = tourStaende
                    .filter((x) => x.tour_id === t.id)
                    .sort((a, b) => a.reihenfolge - b.reihenfolge);
                  const fahrer = fahrerStandId(eintraege);
                  const hinweise = tourHinweise(eintraege, t.tagesart, zeiten, standName);
                  return (
                    <div key={t.id} className={`card flex flex-col gap-2 ${t.aktiv ? "" : "opacity-50"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold">
                            Tour {t.nummer}
                            {t.name && <span className="font-normal text-neutral-600"> · {t.name}</span>}
                            {!t.aktiv && <span className="badge-neutral ml-2">inaktiv</span>}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {fahrzeugName(t.fahrzeug_id) ?? "kein Fahrzeug"}
                            {t.abfahrt && ` · Abfahrt ${zeitKurz(t.abfahrt)}`}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Link
                            href={`/vertrieb/karte?tour=${t.id}`}
                            className="btn-secondary flex items-center gap-1"
                            title="Tour auf der Karte anzeigen"
                          >
                            <KartenIcon className="h-4 w-4" /> Karte
                          </Link>
                          {darfPflegen && (
                            <button className="btn-secondary" onClick={() => bearbeiten(t)}>
                              Bearbeiten
                            </button>
                          )}
                        </div>
                      </div>
                      <ol
                        className={`text-sm ${zug && zug.tagesart === t.tagesart ? "min-h-8 rounded outline-dashed outline-1 outline-linie" : ""}`}
                        onDragOver={(ev) => dndAktiv && ueberTourEnde(ev, t.id, eintraege.length)}
                        onDrop={(ev) => {
                          ev.preventDefault();
                          ablegen();
                        }}
                      >
                        {eintraege.map((e, i) => (
                          <li
                            key={e.id}
                            draggable={dndAktiv && !dndLaeuft}
                            onDragStart={(ev) => {
                              ev.dataTransfer.effectAllowed = "move";
                              ev.dataTransfer.setData("text/plain", String(e.stand_id));
                              setZug({ standId: e.stand_id, vonTour: t.id, tagesart: t.tagesart });
                            }}
                            onDragEnd={() => {
                              setZug(null);
                              setZiel(null);
                            }}
                            onDragOver={(ev) => dndAktiv && ueberZeile(ev, t.id, i)}
                            className={`flex items-center gap-2 border-y-2 border-transparent ${
                              dndAktiv ? "cursor-grab" : ""
                            } ${zug?.standId === e.stand_id ? "opacity-40" : ""} ${
                              ziel?.tourId === t.id && ziel.index === i ? "!border-t-beere-500" : ""
                            } ${ziel?.tourId === t.id && ziel.index === i + 1 && i === eintraege.length - 1 ? "!border-b-beere-500" : ""}`}
                          >
                            {dndAktiv && <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
                            <span className="w-5 text-right text-neutral-500">{e.reihenfolge}.</span>
                            <span>{standName(e.stand_id)}</span>
                            {e.nur_ware && <span className="badge-neutral">nur Ware</span>}
                            {fahrer === e.stand_id && (
                              <span className="badge-info">
                                <Car className="mr-1 inline h-3.5 w-3.5" />
                                Fahrer
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                      {eintraege.length === 0 && zug && zug.tagesart === t.tagesart && (
                        <p className="text-xs text-neutral-500">Hierher ziehen</p>
                      )}
                      {t.notiz && <p className="text-xs text-neutral-500">{t.notiz}</p>}
                      {hinweise.map((h) => (
                        <p key={h} className="text-xs text-amber-700">
                          ⚠ {h}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </div>
              {(ohneTour.length > 0 || (zug && zug.tagesart === ta.wert && zug.vonTour !== null)) && (
                <div
                  className={`flex flex-wrap items-center gap-1.5 rounded p-2 text-sm text-neutral-600 ${
                    zug && zug.tagesart === ta.wert && zug.vonTour !== null
                      ? `outline-dashed outline-1 ${ziel?.tourId === null ? "bg-beere-50 outline-beere-500" : "outline-linie"}`
                      : ""
                  }`}
                  onDragOver={(ev) => {
                    if (!dndAktiv || !zug || zug.tagesart !== ta.wert || zug.vonTour === null) return;
                    ev.preventDefault();
                    if (ziel?.tourId !== null) setZiel({ tourId: null, index: 0 });
                  }}
                  onDrop={(ev) => {
                    ev.preventDefault();
                    ablegen();
                  }}
                >
                  <span className="font-medium">Ohne Tour ({ohneTour.length}):</span>
                  {ohneTour.map((s) =>
                    dndAktiv ? (
                      <span
                        key={s.id}
                        draggable={!dndLaeuft}
                        onDragStart={(ev) => {
                          ev.dataTransfer.effectAllowed = "move";
                          ev.dataTransfer.setData("text/plain", String(s.id));
                          setZug({ standId: s.id, vonTour: null, tagesart: ta.wert });
                        }}
                        onDragEnd={() => {
                          setZug(null);
                          setZiel(null);
                        }}
                        className="cursor-grab rounded border border-linie bg-white px-1.5 py-0.5"
                      >
                        {s.nummer} {s.name}
                      </span>
                    ) : (
                      <span key={s.id}>{s.nummer} {s.name} ·</span>
                    )
                  )}
                  {zug && zug.tagesart === ta.wert && zug.vonTour !== null && (
                    <span className="text-xs">← hierher ziehen = aus der Tour nehmen</span>
                  )}
                </div>
              )}
            </section>
          );
        })}
    </div>
  );
}
