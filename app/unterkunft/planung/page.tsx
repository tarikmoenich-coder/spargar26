"use client";

// Unterkunft → Herkunfts-Planung (Migration 2026-09-18). Der Planer legt je
// Herkunft eine Planzahl fest und stapelt Wohneinheiten als Stammplätze, bis
// die Planzahl an Betten reserviert ist. Die HR füllt diese Plätze später
// indirekt mit echten Namen (beim Aktivieren eines Kandidaten wandert die
// Person in das nächste freie reservierte Haus dieser Herkunft).
//
// Hausmeister sieht nur die Zuordnung Herkunft → Häuser (read-only), keine
// Planzahlen (RLS).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import UnterkunftTabs from "@/components/UnterkunftTabs";
import type {
  Herkunft,
  UnterkunftGebaeude,
  UnterkunftHerkunftAbgleich,
  UnterkunftHerkunftKontingent,
  UnterkunftHerkunftPlan,
  UnterkunftWohneinheit,
  UnterkunftWohneinheitUebersicht,
} from "@/lib/types";

export default function UnterkunftPlanungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";
  const nurLesen = profile?.role === "hausmeister";

  const [saison, setSaison] = useState(new Date().getFullYear());
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [gebaeude, setGebaeude] = useState<UnterkunftGebaeude[]>([]);
  const [wohneinheiten, setWohneinheiten] = useState<UnterkunftWohneinheit[]>([]);
  const [ueber, setUeber] = useState<UnterkunftWohneinheitUebersicht[]>([]);
  const [plaene, setPlaene] = useState<UnterkunftHerkunftPlan[]>([]);
  const [kontingente, setKontingente] = useState<UnterkunftHerkunftKontingent[]>(
    []
  );
  const [abgleich, setAbgleich] = useState<UnterkunftHerkunftAbgleich[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    setLoading(true);
    const sb = getSupabaseClient();
    const [h, g, w, u, p, k, a] = await Promise.all([
      sb.from("herkuenfte").select("*").order("reihenfolge"),
      sb.from("unterkunft_gebaeude").select("*").eq("aktiv", true).order("name"),
      sb
        .from("unterkunft_wohneinheit")
        .select("*")
        .eq("aktiv", true)
        .order("gebaeude_id")
        .order("reihenfolge"),
      sb.from("unterkunft_wohneinheit_uebersicht").select("*"),
      sb.from("unterkunft_herkunft_plan").select("*").eq("saison_jahr", saison),
      sb
        .from("unterkunft_herkunft_kontingent")
        .select("*")
        .eq("saison_jahr", saison)
        .order("reihenfolge"),
      sb
        .from("unterkunft_herkunft_abgleich")
        .select("*")
        .eq("saison_jahr", saison),
    ]);
    setHerkuenfte((h.data as Herkunft[]) ?? []);
    setGebaeude((g.data as UnterkunftGebaeude[]) ?? []);
    setWohneinheiten((w.data as UnterkunftWohneinheit[]) ?? []);
    setUeber((u.data as UnterkunftWohneinheitUebersicht[]) ?? []);
    setPlaene((p.data as UnterkunftHerkunftPlan[]) ?? []);
    setKontingente((k.data as UnterkunftHerkunftKontingent[]) ?? []);
    setAbgleich((a.data as UnterkunftHerkunftAbgleich[]) ?? []);
    setLoading(false);
  }, [saison]);

  useEffect(() => {
    laden();
  }, [laden]);

  const weName = (id: number) => {
    const w = wohneinheiten.find((x) => x.id === id);
    const geb = w ? gebaeude.find((x) => x.id === w.gebaeude_id)?.name : "";
    return w ? `${geb ?? "?"} · ${w.name}` : `Wohneinheit ${id}`;
  };
  const weBetten = (id: number) =>
    ueber.find((x) => x.wohneinheit_id === id)?.betten ?? 0;
  const weBelegt = (id: number) => {
    const u = ueber.find((x) => x.wohneinheit_id === id);
    return u ? u.fest + u.geplant : 0;
  };

  // Herkünfte, die geplant werden: mit Plan ODER Kontingent ODER Kandidaten.
  const geplanteHerkuenfte = useMemo(() => {
    const set = new Set<string>();
    plaene.forEach((p) => set.add(p.herkunft));
    kontingente.forEach((k) => set.add(k.herkunft));
    abgleich.forEach((a) => a.erfasst > 0 && set.add(a.herkunft));
    return herkuenfte
      .map((h) => h.wert)
      .filter((w) => set.has(w));
  }, [plaene, kontingente, abgleich, herkuenfte]);

  const doppeltBelegteWe = useMemo(() => {
    const proWe = new Map<number, Set<string>>();
    kontingente.forEach((k) => {
      if (!proWe.has(k.wohneinheit_id)) proWe.set(k.wohneinheit_id, new Set());
      proWe.get(k.wohneinheit_id)!.add(k.herkunft);
    });
    return new Set(
      [...proWe.entries()].filter(([, hs]) => hs.size > 1).map(([id]) => id)
    );
  }, [kontingente]);

  const reservierteWeIds = useMemo(
    () => new Set(kontingente.map((k) => k.wohneinheit_id)),
    [kontingente]
  );

  async function fuehreAus(
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    setFehler(null);
    const { error } = await fn();
    if (error) {
      setFehler(error.message);
      return;
    }
    await laden();
  }

  const sollSetzen = (herkunft: string, wert: string) => {
    const n = Math.max(0, Math.floor(Number(wert)) || 0);
    const alt =
      plaene.find((p) => p.herkunft === herkunft)?.soll_anzahl ?? 0;
    if (n === alt) return;
    fuehreAus(() =>
      getSupabaseClient()
        .from("unterkunft_herkunft_plan")
        .upsert(
          {
            saison_jahr: saison,
            herkunft,
            soll_anzahl: n,
            updated_by: profile?.id ?? null,
          },
          { onConflict: "saison_jahr,herkunft" }
        )
    );
  };

  const hinweisSetzen = (herkunft: string, wert: string) => {
    const alt =
      plaene.find((p) => p.herkunft === herkunft)?.anreise_hinweis ?? "";
    if (wert.trim() === alt) return;
    fuehreAus(() =>
      getSupabaseClient()
        .from("unterkunft_herkunft_plan")
        .upsert(
          {
            saison_jahr: saison,
            herkunft,
            anreise_hinweis: wert.trim() || null,
            updated_by: profile?.id ?? null,
          },
          { onConflict: "saison_jahr,herkunft" }
        )
    );
  };

  const herkunftHinzufuegen = (herkunft: string) => {
    if (!herkunft) return;
    fuehreAus(() =>
      getSupabaseClient()
        .from("unterkunft_herkunft_plan")
        .upsert(
          { saison_jahr: saison, herkunft, soll_anzahl: 0 },
          { onConflict: "saison_jahr,herkunft" }
        )
    );
  };

  const weHinzufuegen = (herkunft: string, wohneinheit_id: string) => {
    if (!wohneinheit_id) return;
    const maxR = kontingente
      .filter((k) => k.herkunft === herkunft)
      .reduce((m, k) => Math.max(m, k.reihenfolge), 0);
    fuehreAus(() =>
      getSupabaseClient()
        .from("unterkunft_herkunft_kontingent")
        .insert({
          saison_jahr: saison,
          herkunft,
          wohneinheit_id: Number(wohneinheit_id),
          reihenfolge: maxR + 10,
        })
    );
  };

  const weEntfernen = (id: number) =>
    fuehreAus(() =>
      getSupabaseClient().from("unterkunft_herkunft_kontingent").delete().eq("id", id)
    );

  const tauschen = async (herkunft: string, id: number, richtung: -1 | 1) => {
    const liste = kontingente
      .filter((k) => k.herkunft === herkunft)
      .sort((a, b) => a.reihenfolge - b.reihenfolge);
    const i = liste.findIndex((k) => k.id === id);
    const j = i + richtung;
    if (i < 0 || j < 0 || j >= liste.length) return;
    const a = liste[i];
    const b = liste[j];
    const sb = getSupabaseClient();
    setFehler(null);
    const r1 = await sb
      .from("unterkunft_herkunft_kontingent")
      .update({ reihenfolge: b.reihenfolge })
      .eq("id", a.id);
    const r2 = await sb
      .from("unterkunft_herkunft_kontingent")
      .update({ reihenfolge: a.reihenfolge })
      .eq("id", b.id);
    if (r1.error || r2.error) {
      setFehler(r1.error?.message ?? r2.error?.message ?? "Fehler");
    }
    await laden();
  };

  if (loading) return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;

  // --- Read-only-Ansicht für den Hausmeister --------------------------------
  if (nurLesen) {
    const proHerkunft = new Map<string, UnterkunftHerkunftKontingent[]>();
    kontingente.forEach((k) => {
      if (!proHerkunft.has(k.herkunft)) proHerkunft.set(k.herkunft, []);
      proHerkunft.get(k.herkunft)!.push(k);
    });
    return (
      <div className="space-y-4">
        <UnterkunftTabs />
        <h1 className="text-lg font-semibold text-emerald-900">
          Herkunft → Häuser ({saison})
        </h1>
        {proHerkunft.size === 0 ? (
          <p className="text-sm text-neutral-500">Noch nichts geplant.</p>
        ) : (
          [...proHerkunft.entries()].map(([h, ks]) => (
            <div key={h} className="rounded border border-neutral-200 p-3">
              <div className="font-semibold text-emerald-900">{h}</div>
              <ol className="mt-1 list-decimal pl-5 text-sm">
                {ks
                  .sort((a, b) => a.reihenfolge - b.reihenfolge)
                  .map((k) => (
                    <li key={k.id}>
                      {weName(k.wohneinheit_id)} — {weBetten(k.wohneinheit_id)}{" "}
                      Betten
                    </li>
                  ))}
              </ol>
            </div>
          ))
        )}
      </div>
    );
  }

  const freieWeGesamt = wohneinheiten.filter(
    (w) => !reservierteWeIds.has(w.id) && weBetten(w.id) > 0
  );
  const ohneReservierung = abgleich.filter(
    (a) =>
      a.erfasst > 0 &&
      !kontingente.some((k) => k.herkunft === a.herkunft)
  );

  return (
    <div className="space-y-6">
      <UnterkunftTabs />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">
            Herkunfts-Planung
          </h1>
          <p className="max-w-2xl text-sm text-neutral-500">
            Je Herkunft die Planzahl setzen und Häuser stapeln, bis genug
            Betten reserviert sind. Die HR füllt die Plätze beim „Anreise
            vorbereiten" der Kandidaten mit echten Namen.
          </p>
        </div>
        <label className="text-sm">
          Saison
          <input
            type="number"
            className="ml-2 w-24"
            value={saison}
            onChange={(e) => setSaison(Number(e.target.value) || saison)}
          />
        </label>
      </div>

      {fehler && (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {fehler}
        </p>
      )}

      {/* --- Herkunft-Karten --- */}
      <div className="space-y-3">
        {geplanteHerkuenfte.map((h) => {
          const plan = plaene.find((p) => p.herkunft === h);
          const a =
            abgleich.find((x) => x.herkunft === h) ??
            ({ erfasst: 0, verplant: 0, eingezogen: 0 } as UnterkunftHerkunftAbgleich);
          const ks = kontingente
            .filter((k) => k.herkunft === h)
            .sort((x, y) => x.reihenfolge - y.reihenfolge);
          const reserviert = ks.reduce(
            (s, k) => s + weBetten(k.wohneinheit_id),
            0
          );
          const soll = plan?.soll_anzahl ?? 0;
          const diff = soll - a.erfasst;
          const puffer = reserviert - (a.verplant + a.eingezogen);
          const freieWe = wohneinheiten.filter(
            (w) =>
              weBetten(w.id) > 0 &&
              !ks.some((k) => k.wohneinheit_id === w.id)
          );
          return (
            <div key={h} className="rounded border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-base font-semibold text-emerald-900">
                  {h}
                </span>
                <label className="text-sm">
                  Soll
                  <input
                    type="number"
                    min={0}
                    className="ml-2 w-20"
                    defaultValue={soll}
                    onBlur={(e) => sollSetzen(h, e.target.value)}
                  />
                </label>
              </div>

              <div className="mt-1 text-sm">
                reserviert <span className="font-medium">{reserviert}</span> /{" "}
                Soll {soll}{" "}
                {reserviert < soll ? (
                  <span className="text-amber-700">
                    – {soll - reserviert} Betten fehlen
                  </span>
                ) : reserviert > soll ? (
                  <span className="text-neutral-400">
                    (+{reserviert - soll} Reserve)
                  </span>
                ) : (
                  <span className="text-emerald-700">✓</span>
                )}
              </div>

              <ol className="mt-2 space-y-1 text-sm">
                {ks.map((k, i) => (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="text-neutral-400">{i + 1}.</span>
                    <span className="min-w-[14rem]">
                      {weName(k.wohneinheit_id)}
                    </span>
                    <span className="text-neutral-500">
                      {weBelegt(k.wohneinheit_id)}/{weBetten(k.wohneinheit_id)}{" "}
                      belegt+geplant
                    </span>
                    {doppeltBelegteWe.has(k.wohneinheit_id) && (
                      <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">
                        auch andere Herkunft
                      </span>
                    )}
                    <span className="ml-auto flex gap-1">
                      <button
                        className="btn-secondary"
                        disabled={i === 0}
                        onClick={() => tauschen(h, k.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-secondary"
                        disabled={i === ks.length - 1}
                        onClick={() => tauschen(h, k.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => weEntfernen(k.id)}
                      >
                        ×
                      </button>
                    </span>
                  </li>
                ))}
                {ks.length === 0 && (
                  <li className="text-neutral-400">
                    noch keine Wohneinheit reserviert
                  </li>
                )}
              </ol>

              {canEdit && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <label>
                    + Wohneinheit
                    <select
                      className="ml-2"
                      value=""
                      onChange={(e) => weHinzufuegen(h, e.target.value)}
                    >
                      <option value="">– wählen –</option>
                      {gebaeude.map((g) => (
                        <optgroup key={g.id} label={g.name}>
                          {freieWe
                            .filter((w) => w.gebaeude_id === g.id)
                            .map((w) => (
                              <option key={w.id} value={w.id}>
                                {w.name} ({weBetten(w.id)} Betten)
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label className="flex-1">
                    Anreise-Hinweis
                    <input
                      className="ml-2 w-full max-w-md"
                      defaultValue={plan?.anreise_hinweis ?? ""}
                      placeholder="z. B. 15.03. + Nachzügler"
                      onBlur={(e) => hinweisSetzen(h, e.target.value)}
                    />
                  </label>
                </div>
              )}

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-600">
                <span>
                  erfasst <span className="font-medium">{a.erfasst}</span>
                </span>
                <span>· davon verplant {a.verplant}</span>
                <span>· eingezogen {a.eingezogen}</span>
                <span
                  className={
                    diff > 0
                      ? "font-medium text-red-600"
                      : diff < 0
                        ? "font-medium text-amber-700"
                        : "text-emerald-700"
                  }
                >
                  {diff > 0
                    ? `→ noch ${diff} erwartet`
                    : diff < 0
                      ? `→ ${-diff} über Plan`
                      : "→ vollständig"}
                </span>
                <span
                  className={puffer < 0 ? "font-medium text-red-600" : ""}
                >
                  · Puffer {puffer}
                </span>
              </div>
            </div>
          );
        })}

        {canEdit && (
          <label className="text-sm">
            + Herkunft planen
            <select
              className="ml-2"
              value=""
              onChange={(e) => herkunftHinzufuegen(e.target.value)}
            >
              <option value="">– wählen –</option>
              {herkuenfte
                .filter((h) => !geplanteHerkuenfte.includes(h.wert))
                .map((h) => (
                  <option key={h.wert} value={h.wert}>
                    {h.wert}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {/* --- Block B: Häuser mit Reservierung --- */}
      <section className="space-y-2">
        <h2 className="font-semibold text-neutral-800">
          Häuser mit Reservierung
        </h2>
        {kontingente.length === 0 ? (
          <p className="text-sm text-neutral-400">keine.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Wohneinheit</th>
                <th>für Herkunft</th>
                <th>Betten</th>
                <th>belegt+geplant</th>
                <th>frei</th>
              </tr>
            </thead>
            <tbody>
              {[...kontingente]
                .sort(
                  (a, b) =>
                    weName(a.wohneinheit_id).localeCompare(
                      weName(b.wohneinheit_id)
                    )
                )
                .map((k) => {
                  const betten = weBetten(k.wohneinheit_id);
                  const belegt = weBelegt(k.wohneinheit_id);
                  return (
                    <tr key={k.id}>
                      <td>{weName(k.wohneinheit_id)}</td>
                      <td>
                        {k.herkunft}
                        {doppeltBelegteWe.has(k.wohneinheit_id) && (
                          <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">
                            mehrfach
                          </span>
                        )}
                      </td>
                      <td>{betten}</td>
                      <td className={belegt > betten ? "text-red-600" : ""}>
                        {belegt}
                      </td>
                      <td
                        className={
                          betten - belegt < 0 ? "font-medium text-red-600" : ""
                        }
                      >
                        {betten - belegt}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Block C: Hinweise --- */}
      <section className="space-y-1 text-sm">
        {ohneReservierung.length > 0 && (
          <p className="text-amber-800">
            Herkunft ohne Reservierung:{" "}
            {ohneReservierung
              .map((a) => `${a.herkunft} (${a.erfasst} erfasst)`)
              .join(" · ")}
          </p>
        )}
        {freieWeGesamt.length > 0 && (
          <p className="text-neutral-500">
            Puffer (nicht reserviert):{" "}
            {freieWeGesamt
              .map((w) => `${weName(w.id)} (${weBetten(w.id)})`)
              .join(" · ")}
          </p>
        )}
        <p className="text-neutral-400">
          Das Zimmer innerhalb des Hauses vergibt der Hausmeister bei der
          Ankunft – siehe{" "}
          <Link href="/unterkunft" className="underline">
            Immobilien
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
