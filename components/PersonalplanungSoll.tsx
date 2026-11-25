"use client";

// Personalplanung → Soll & Übersicht (Nutzer-Vorgabe 2026-11-21).
// Soll je Herkunft = was von den Vermittlern kommen soll. Gespeichert in
// unterkunft_herkunft_plan.soll_anzahl - dieselbe Zahl nutzt die
// Herkunfts-Bettenplanung (es gibt bewusst nur EIN Soll). Daneben das Ist:
// zugesagte Personen (Namen + Platzhalter, ohne Reserve), die
// Führerschein-Quote (pro 5 Personen einer mit B) und Platzhalter zum
// Planen, solange die Vermittler nur Zahlen schicken. Die Verteilung auf die
// Einsatzbereiche ist reine Übersicht, ohne eigenes Soll.
import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import {
  bereichFarbe,
  fuehrerscheinZiel,
  hatFuehrerscheinB,
  istZugesagt,
} from "@/lib/personalplanung";
import type {
  Einsatzbereich,
  EinsatzbereichZeitraum,
  Herkunft,
  PersonalKandidat,
  UnterkunftHerkunftPlan,
} from "@/lib/types";

interface Props {
  saisonJahr: number;
  herkuenfte: Herkunft[];
  einsatzbereiche: Einsatzbereich[];
  // Alle nicht stornierten Kandidaten DIESES Saisonjahres.
  kandidaten: PersonalKandidat[];
  sollPlan: UnterkunftHerkunftPlan[];
  zeitraeume: EinsatzbereichZeitraum[];
  canEdit: boolean;
  // Geschäftsbereich neuer Platzhalter (Stufe 2)
  bereich: string;
  onGeaendert: () => void;
}

interface Zeile {
  herkunft: string;
  soll: number;
  zugesagt: number;
  namen: number;
  platzhalter: number;
  reserve: number;
  fsB: number;
  fsBPlatzhalter: number;
  ohneDatum: number;
}

export default function PersonalplanungSoll({
  saisonJahr,
  herkuenfte,
  einsatzbereiche,
  kandidaten,
  sollPlan,
  zeitraeume,
  canEdit,
  bereich,
  onGeaendert,
}: Props) {
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  // herkunft -> eingegebene Anzahl neuer Platzhalter (leer = Vorschlag)
  const [anzahlNeu, setAnzahlNeu] = useState<Record<string, string>>({});

  const sollVon = (h: string) =>
    sollPlan.find((p) => p.saison_jahr === saisonJahr && p.herkunft === h)
      ?.soll_anzahl ?? 0;

  const zeilen: Zeile[] = herkuenfte.map((h) => {
    const liste = kandidaten.filter((k) => k.herkunft === h.wert);
    const zu = liste.filter(istZugesagt);
    return {
      herkunft: h.wert,
      soll: sollVon(h.wert),
      zugesagt: zu.length,
      namen: zu.filter((k) => !k.platzhalter).length,
      platzhalter: zu.filter((k) => k.platzhalter).length,
      reserve: liste.filter((k) => k.reserve).length,
      fsB: zu.filter(hatFuehrerscheinB).length,
      fsBPlatzhalter: zu.filter((k) => k.platzhalter && hatFuehrerscheinB(k))
        .length,
      ohneDatum: zu.filter((k) => !k.geplante_ankunft).length,
    };
  });
  const ohneHerkunft = kandidaten.filter((k) => !k.herkunft && istZugesagt(k));

  const summe = zeilen.reduce(
    (s, z) => ({
      soll: s.soll + z.soll,
      zugesagt: s.zugesagt + z.zugesagt,
      namen: s.namen + z.namen,
      platzhalter: s.platzhalter + z.platzhalter,
      reserve: s.reserve + z.reserve,
      fsB: s.fsB + z.fsB,
      fsZiel: s.fsZiel + fuehrerscheinZiel(z.soll > 0 ? z.soll : z.zugesagt),
      ohneDatum: s.ohneDatum + z.ohneDatum,
    }),
    {
      soll: 0,
      zugesagt: 0,
      namen: 0,
      platzhalter: 0,
      reserve: 0,
      fsB: 0,
      fsZiel: 0,
      ohneDatum: 0,
    }
  );

  async function sollSpeichern(herkunft: string, wert: string) {
    const neu = Math.max(0, Math.round(Number(wert) || 0));
    if (neu === sollVon(herkunft)) return;
    setFehler(null);
    // Upsert setzt nur die übergebenen Spalten - ein vorhandener
    // Anreise-Hinweis der Bettenplanung bleibt erhalten.
    const { error } = await getSupabaseClient()
      .from("unterkunft_herkunft_plan")
      .upsert(
        { saison_jahr: saisonJahr, herkunft, soll_anzahl: neu },
        { onConflict: "saison_jahr,herkunft" }
      );
    if (error) {
      setFehler(error.message);
      return;
    }
    onGeaendert();
  }

  async function platzhalterAnlegen(herkunft: string, anzahl: number) {
    if (anzahl <= 0) return;
    if (anzahl > 200) {
      setFehler("Bitte höchstens 200 Platzhalter auf einmal anlegen.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const zeilenNeu = Array.from({ length: anzahl }, () => ({
      platzhalter: true,
      bereich,
      herkunft,
      saison_jahr: saisonJahr,
      status: "geplant",
    }));
    const { error } = await getSupabaseClient()
      .from("personal_kandidaten")
      .insert(zeilenNeu);
    setLaeuft(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setAnzahlNeu((prev) => {
      const rest = { ...prev };
      delete rest[herkunft];
      return rest;
    });
    onGeaendert();
  }

  // Saisonzeitraum eines Bereichs speichern: beide Daten gesetzt -> anlegen/
  // ändern, beide leer -> entfernen.
  const zeitraumVon = (bereich: string) =>
    zeitraeume.find(
      (z) => z.einsatzbereich === bereich && z.saison_jahr === saisonJahr
    ) ?? null;
  const [zeitraumEntwurf, setZeitraumEntwurf] = useState<
    Record<string, { von: string; bis: string }>
  >({});
  const entwurfVon = (bereich: string) =>
    zeitraumEntwurf[`${saisonJahr}|${bereich}`] ?? {
      von: zeitraumVon(bereich)?.von ?? "",
      bis: zeitraumVon(bereich)?.bis ?? "",
    };

  async function zeitraumSpeichern(bereich: string, von: string, bis: string) {
    setFehler(null);
    const alt = zeitraumVon(bereich);
    if ((alt?.von ?? "") === von && (alt?.bis ?? "") === bis) return;
    const supabase = getSupabaseClient();
    if (!von && !bis) {
      if (!alt) return;
      const { error } = await supabase
        .from("einsatzbereich_zeitraum")
        .delete()
        .eq("einsatzbereich", bereich)
        .eq("saison_jahr", saisonJahr);
      if (error) setFehler(error.message);
      else onGeaendert();
      return;
    }
    if (!von || !bis) return; // erst speichern, wenn beide Daten da sind
    if (bis < von) {
      setFehler(`${bereich}: das Ende liegt vor dem Beginn.`);
      return;
    }
    const { error } = await supabase
      .from("einsatzbereich_zeitraum")
      .upsert(
        { einsatzbereich: bereich, saison_jahr: saisonJahr, von, bis },
        { onConflict: "einsatzbereich,saison_jahr" }
      );
    if (error) setFehler(error.message);
    else onGeaendert();
  }

  // Übersicht Herkunft × Einsatzbereich (nur zugesagte Personen).
  const bereichSpalten = [
    ...einsatzbereiche.map((b) => b.wert),
    "__ohne__",
  ];
  const zugesagteAlle = kandidaten.filter(istZugesagt);
  const matrixZeilen = herkuenfte
    .map((h) => h.wert)
    .filter((h) => zugesagteAlle.some((k) => k.herkunft === h));
  if (zugesagteAlle.some((k) => !k.herkunft)) matrixZeilen.push("__ohne__");
  const zelle = (herkunft: string, bereich: string) =>
    zugesagteAlle.filter(
      (k) =>
        (herkunft === "__ohne__" ? !k.herkunft : k.herkunft === herkunft) &&
        (bereich === "__ohne__"
          ? !k.einsatzbereich
          : k.einsatzbereich === bereich)
    ).length;
  const sichtbareBereiche = bereichSpalten.filter((b) =>
    zugesagteAlle.some((k) =>
      b === "__ohne__" ? !k.einsatzbereich : k.einsatzbereich === b
    )
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-emerald-800">
          Verteilung auf Einsatzbereiche
        </h2>
        <p className="text-sm text-neutral-500">
          Nur zur Übersicht (zugesagte Personen inkl. Platzhalter). Den
          Einsatzbereich setzt du in der Namensliste je Person oder für mehrere
          markierte auf einmal.
        </p>
        {matrixZeilen.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Noch keine zugesagten Personen für {saisonJahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Herkunft</th>
                  {sichtbareBereiche.map((b) => (
                    <th key={b}>
                      <span className="flex items-center gap-1">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{
                            background: bereichFarbe(
                              einsatzbereiche,
                              b === "__ohne__" ? null : b
                            ),
                          }}
                        />
                        {b === "__ohne__" ? "ohne Einsatzbereich" : b}
                      </span>
                    </th>
                  ))}
                  <th>Summe</th>
                </tr>
              </thead>
              <tbody>
                {matrixZeilen.map((h) => (
                  <tr key={h}>
                    <td className="font-medium">
                      {h === "__ohne__" ? "ohne Herkunft" : h}
                    </td>
                    {sichtbareBereiche.map((b) => {
                      const n = zelle(h, b);
                      return (
                        <td
                          key={b}
                          className={
                            b === "__ohne__" && n > 0 ? "text-amber-700" : ""
                          }
                        >
                          {n || "—"}
                        </td>
                      );
                    })}
                    <td className="font-medium">
                      {sichtbareBereiche.reduce((s, b) => s + zelle(h, b), 0)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-linie font-semibold">
                  <td>Summe</td>
                  {sichtbareBereiche.map((b) => (
                    <td key={b}>
                      {matrixZeilen.reduce((s, h) => s + zelle(h, b), 0)}
                    </td>
                  ))}
                  <td>{zugesagteAlle.length}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-emerald-800">
          Soll je Herkunft – Saison {saisonJahr}
        </h2>
        <p className="text-sm text-neutral-500">
          Soll = wie viele Personen du von der Herkunft bzw. dem Vermittler
          haben möchtest. Dieselbe Zahl gilt in der Herkunfts-Bettenplanung
          der Unterkünfte. Zugesagt = Namen + Platzhalter, ohne Reserve.
          Führerschein-Ziel: pro 5 Personen eine mit Klasse B (aufgerundet,
          bezogen auf das Soll; BE/C/CE zählen mit).
        </p>
        {fehler && (
          <p className="text-sm font-medium text-beere-600">⚠ {fehler}</p>
        )}
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Herkunft</th>
                <th>Soll</th>
                <th>Zugesagt</th>
                <th>davon Namen</th>
                <th>davon Platzhalter</th>
                <th>Differenz</th>
                <th>Reserve</th>
                <th>Führerschein B</th>
                <th>ohne Anreisedatum</th>
                {canEdit && <th>Platzhalter anlegen</th>}
              </tr>
            </thead>
            <tbody>
              {zeilen.map((z) => {
                const diff = z.zugesagt - z.soll;
                const ziel = fuehrerscheinZiel(z.soll > 0 ? z.soll : z.zugesagt);
                const vorschlag = Math.max(0, z.soll - z.zugesagt);
                const eingabe = anzahlNeu[z.herkunft];
                const anzahl =
                  eingabe === undefined
                    ? vorschlag
                    : Math.max(0, Math.round(Number(eingabe) || 0));
                const leer = z.soll === 0 && z.zugesagt === 0 && z.reserve === 0;
                return (
                  <tr key={z.herkunft} className={leer ? "text-neutral-400" : ""}>
                    <td className="font-medium">{z.herkunft}</td>
                    <td>
                      {canEdit ? (
                        <input
                          key={`${saisonJahr}-${z.herkunft}-${z.soll}`}
                          type="number"
                          min={0}
                          className="w-20"
                          defaultValue={z.soll || ""}
                          placeholder="0"
                          onBlur={(e) => sollSpeichern(z.herkunft, e.target.value)}
                        />
                      ) : (
                        z.soll
                      )}
                    </td>
                    <td className="font-medium">{z.zugesagt}</td>
                    <td>{z.namen}</td>
                    <td>{z.platzhalter}</td>
                    <td
                      className={
                        z.soll === 0 && z.zugesagt === 0
                          ? ""
                          : diff === 0
                            ? "text-emerald-700"
                            : diff < 0
                              ? "font-medium text-amber-700"
                              : "font-medium text-beere-600"
                      }
                      title={
                        diff < 0
                          ? "Es fehlen noch Personen zum Soll"
                          : diff > 0
                            ? "Mehr zugesagt als Soll - ggf. Personen als Reserve markieren"
                            : undefined
                      }
                    >
                      {z.soll === 0 && z.zugesagt === 0
                        ? "—"
                        : diff === 0
                          ? "✓ 0"
                          : diff > 0
                            ? `+${diff}`
                            : diff}
                    </td>
                    <td>{z.reserve || "—"}</td>
                    <td
                      className={
                        ziel === 0
                          ? ""
                          : z.fsB >= ziel
                            ? "text-emerald-700"
                            : "font-medium text-amber-700"
                      }
                      title={
                        z.fsBPlatzhalter > 0
                          ? `davon ${z.fsBPlatzhalter} als Platzhalter mit Führerschein geplant`
                          : undefined
                      }
                    >
                      {ziel === 0
                        ? "—"
                        : `${z.fsB >= ziel ? "✓" : "⚠"} ${z.fsB} / ${ziel}`}
                      {z.fsBPlatzhalter > 0 && (
                        <span className="text-xs text-neutral-500">
                          {" "}
                          ({z.fsBPlatzhalter} geplant)
                        </span>
                      )}
                    </td>
                    <td className={z.ohneDatum > 0 ? "text-amber-700" : ""}>
                      {z.ohneDatum || "—"}
                    </td>
                    {canEdit && (
                      <td>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            className="w-16"
                            value={eingabe ?? (vorschlag || "")}
                            placeholder="0"
                            onChange={(e) =>
                              setAnzahlNeu((prev) => ({
                                ...prev,
                                [z.herkunft]: e.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            disabled={laeuft || anzahl <= 0}
                            onClick={() => platzhalterAnlegen(z.herkunft, anzahl)}
                            title={
                              vorschlag > 0
                                ? `Vorschlag: ${vorschlag} = bis zum Soll auffüllen`
                                : undefined
                            }
                          >
                            anlegen
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-linie font-semibold">
                <td>Summe</td>
                <td>{summe.soll}</td>
                <td>{summe.zugesagt}</td>
                <td>{summe.namen}</td>
                <td>{summe.platzhalter}</td>
                <td>
                  {summe.zugesagt - summe.soll > 0 ? "+" : ""}
                  {summe.zugesagt - summe.soll}
                </td>
                <td>{summe.reserve || "—"}</td>
                <td>
                  {summe.fsB} / {summe.fsZiel}
                </td>
                <td>{summe.ohneDatum || "—"}</td>
                {canEdit && <td></td>}
              </tr>
            </tbody>
          </table>
        </div>
        {ohneHerkunft.length > 0 && (
          <p className="text-sm text-amber-700">
            ⚠ {ohneHerkunft.length} zugesagte Person(en) ohne Herkunft – zählen
            in keinem Soll.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-emerald-800">
          Saisonzeiträume der Einsatzbereiche – {saisonJahr}
        </h2>
        <p className="text-sm text-neutral-500">
          Von–Bis je Einsatzbereich (z.B. Spargel, Erdbeeren, Zuckermais). Erscheint im
          Anreise-Zeitstrahl als Balken über den Säulen. Leer lassen, wenn ein
          Einsatzbereich keinen festen Zeitraum hat; beide Felder leeren entfernt ihn.
        </p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Einsatzbereich</th>
                <th>von</th>
                <th>bis</th>
                <th>Wochen</th>
              </tr>
            </thead>
            <tbody>
              {einsatzbereiche.map((b) => {
                const e = entwurfVon(b.wert);
                const gespeichert = zeitraumVon(b.wert);
                const wochen = gespeichert
                  ? Math.round(
                      (new Date(gespeichert.bis).getTime() -
                        new Date(gespeichert.von).getTime()) /
                        (7 * 86400000)
                    )
                  : null;
                const setze = (feld: "von" | "bis", wert: string) =>
                  setZeitraumEntwurf((prev) => ({
                    ...prev,
                    [`${saisonJahr}|${b.wert}`]: { ...e, [feld]: wert },
                  }));
                return (
                  <tr key={b.wert}>
                    <td>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-sm"
                          style={{ background: bereichFarbe(einsatzbereiche, b.wert) }}
                        />
                        {b.wert}
                      </span>
                    </td>
                    {(["von", "bis"] as const).map((feld) => (
                      <td key={feld}>
                        {canEdit ? (
                          <input
                            type="date"
                            min={`${saisonJahr}-01-01`}
                            max={`${saisonJahr}-12-31`}
                            value={e[feld]}
                            onChange={(ev) => setze(feld, ev.target.value)}
                            onBlur={(ev) =>
                              zeitraumSpeichern(
                                b.wert,
                                feld === "von" ? ev.target.value : e.von,
                                feld === "bis" ? ev.target.value : e.bis
                              )
                            }
                          />
                        ) : (
                          formatDatumDE(gespeichert?.[feld] ?? null)
                        )}
                      </td>
                    ))}
                    <td className="text-neutral-500">
                      {wochen !== null ? `${wochen} Wo.` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
