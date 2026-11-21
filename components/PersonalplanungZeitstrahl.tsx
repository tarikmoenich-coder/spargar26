"use client";

// Personalplanung → Zeitstrahl (Nutzer-Vorgabe 2026-11-21): wann wie viele
// Leute von welcher Herkunft da sind. Gestapelte Säulen je Kalenderwoche,
// eine Farbe je Herkunft; Platzhalter hell + schraffiert, damit sichtbar
// bleibt, wie viel davon noch unsicher ist. Zwei Ansichten:
//   * Anwesend: Personen, deren Zeitraum (Ankunft bis Arbeitsende, sonst
//     Ankunft + 104 Tage) die Woche berührt.
//   * Anreisen: Personen, die in der Woche ankommen.
// Gezählt werden nur zugesagte Personen (keine Reserve, keine Stornos).
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDatumDE } from "@/lib/format";
import { plusTage } from "@/lib/planungTermine";
import {
  anwesenheit,
  bereichFarbe,
  herkunftFarbe,
  istZugesagt,
  kandidatAnzeige,
} from "@/lib/personalplanung";
import type {
  Einsatzbereich,
  EinsatzbereichZeitraum,
  Herkunft,
  PersonalKandidat,
} from "@/lib/types";

interface Props {
  saisonJahr: number;
  herkuenfte: Herkunft[];
  // Alle nicht stornierten Kandidaten DIESES Saisonjahres.
  kandidaten: PersonalKandidat[];
  sollGesamt: number;
  einsatzbereiche: Einsatzbereich[];
  // Saisonzeiträume (alle Jahre; gefiltert wird hier).
  zeitraeume: EinsatzbereichZeitraum[];
}

type FarbModus = "herkunft" | "bereich";

type Modus = "anwesend" | "anreisen";

const OHNE = "__ohne__";

function montagVon(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const tag = (d.getUTCDay() + 6) % 7; // Mo = 0
  d.setUTCDate(d.getUTCDate() - tag);
  return d.toISOString().slice(0, 10);
}

function kalenderwoche(iso: string): number {
  // ISO-Kalenderwoche: Woche mit dem Donnerstag entscheidet über das Jahr.
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jahresAnfang = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jahresAnfang) / 86400000 + 1) / 7);
}

// "schöne" Skalenschritte für die y-Achse
function schritt(max: number): number {
  const roh = max / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(Math.max(roh, 1))));
  for (const f of [1, 2, 5, 10]) if (f * pot >= roh) return f * pot;
  return 10 * pot;
}

export default function PersonalplanungZeitstrahl({
  saisonJahr,
  herkuenfte,
  kandidaten,
  sollGesamt,
  einsatzbereiche,
  zeitraeume,
}: Props) {
  const [modus, setModus] = useState<Modus>("anwesend");
  // Säulen nach Herkunft oder nach Einsatzbereich einfärben (Nutzer-Vorgabe
  // 2026-11-21: sehen, ob zur Spargelzeit genug Spargel-Leute da sind).
  const [farbModus, setFarbModus] = useState<FarbModus>("herkunft");
  const [gewaehlteWoche, setGewaehlteWoche] = useState<string | null>(null);
  const [hoverWoche, setHoverWoche] = useState<string | null>(null);
  const [alsTabelle, setAlsTabelle] = useState(false);
  // Verfügbare Breite messen, damit die Grafik den Platz ausfüllt statt fest
  // 30 px je Woche zu nehmen (Nutzer-Meldung 2026-11-21: "sehr klein").
  const rahmenRef = useRef<HTMLDivElement>(null);
  const [rahmenBreite, setRahmenBreite] = useState(0);
  useEffect(() => {
    const el = rahmenRef.current;
    if (!el) return;
    const messen = () => setRahmenBreite(el.clientWidth);
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [alsTabelle, kandidaten.length]);

  const herkunftListe = useMemo(() => herkuenfte.map((h) => h.wert), [herkuenfte]);
  const bereichListe = useMemo(
    () => einsatzbereiche.map((b) => b.wert),
    [einsatzbereiche]
  );
  const gruppeVon = (k: PersonalKandidat) =>
    (farbModus === "herkunft" ? k.herkunft : k.einsatzbereich) ?? OHNE;

  // Saisonzeiträume dieser Saison in Bereichs-Reihenfolge (Balken oben).
  const baender = useMemo(
    () =>
      zeitraeume
        .filter((z) => z.saison_jahr === saisonJahr)
        .sort(
          (a, b) =>
            bereichListe.indexOf(a.einsatzbereich) -
            bereichListe.indexOf(b.einsatzbereich)
        ),
    [zeitraeume, saisonJahr, bereichListe]
  );

  const personen = useMemo(
    () =>
      kandidaten
        .filter(istZugesagt)
        .map((k) => ({ k, zeit: anwesenheit(k) })),
    [kandidaten]
  );
  const terminiert = personen.filter(
    (p): p is { k: PersonalKandidat; zeit: { von: string; bis: string } } =>
      p.zeit !== null
  );
  const ohneDatum = personen.length - terminiert.length;

  // Herkünfte in fester Reihenfolge (nur die vorkommenden) - bestimmt die
  // Stapel-Reihenfolge und die Legende.
  const stapelGruppen = useMemo(() => {
    const vorhanden = new Set(terminiert.map((p) => gruppeVon(p.k)));
    const reihenfolge = farbModus === "herkunft" ? herkunftListe : bereichListe;
    const liste = reihenfolge.filter((h) => vorhanden.has(h));
    if (vorhanden.has(OHNE)) liste.push(OHNE);
    return liste;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminiert, herkunftListe, bereichListe, farbModus]);

  const wochen = useMemo(() => {
    // Zeitachse: alle Anwesenheiten bzw. Anreisen PLUS die Saisonzeiträume,
    // damit z.B. die Spargelzeit auch schon vor den ersten Anreisen sichtbar
    // ist.
    const anfaenge = [
      ...terminiert.map((p) => p.zeit.von),
      ...baender.map((b) => b.von),
    ];
    const enden = [
      ...terminiert.map((p) => (modus === "anwesend" ? p.zeit.bis : p.zeit.von)),
      ...baender.map((b) => b.bis),
    ];
    if (anfaenge.length === 0) return [] as string[];
    let start = montagVon(anfaenge.reduce((m, d) => (d < m ? d : m)));
    const ende = enden.reduce((m, d) => (d > m ? d : m));
    const liste: string[] = [];
    while (start <= ende && liste.length < 80) {
      liste.push(start);
      start = plusTage(start, 7);
    }
    return liste;
  }, [terminiert, modus, baender]);

  // woche -> herkunft -> { namen, platzhalter, personen }
  const daten = useMemo(() => {
    const map = new Map<
      string,
      Map<string, { namen: number; platzhalter: number; liste: PersonalKandidat[] }>
    >();
    for (const w of wochen) {
      const sonntag = plusTage(w, 6);
      const proHerkunft = new Map<
        string,
        { namen: number; platzhalter: number; liste: PersonalKandidat[] }
      >();
      for (const p of terminiert) {
        const trifft =
          modus === "anwesend"
            ? p.zeit.von <= sonntag && p.zeit.bis >= w
            : p.zeit.von >= w && p.zeit.von <= sonntag;
        if (!trifft) continue;
        const h = gruppeVon(p.k);
        const e = proHerkunft.get(h) ?? { namen: 0, platzhalter: 0, liste: [] };
        if (p.k.platzhalter) e.platzhalter += 1;
        else e.namen += 1;
        e.liste.push(p.k);
        proHerkunft.set(h, e);
      }
      map.set(w, proHerkunft);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochen, terminiert, modus, farbModus]);

  const summeWoche = (w: string) =>
    [...(daten.get(w)?.values() ?? [])].reduce(
      (s, e) => s + e.namen + e.platzhalter,
      0
    );
  const maxWert = Math.max(
    1,
    ...wochen.map(summeWoche),
    modus === "anwesend" ? sollGesamt : 0
  );
  // etwas Luft nach oben, damit Soll-Linie und Summen nicht am Rand kleben
  const yStep = schritt(maxWert * 1.1);
  const yMax = Math.ceil((maxWert * 1.1) / yStep) * yStep;

  // Geometrie
  const links = 40;
  const rechts = 12;
  // Oben ein Streifen je Saisonzeitraum (16 px), darunter das Diagramm.
  const bandH = 16;
  const bandOben = 8;
  const oben = 16 + (baender.length > 0 ? bandOben + baender.length * (bandH + 4) : 0);
  const unten = 40;
  const hoehe = 420 + (oben - 16);
  // Spaltenbreite aus der verfügbaren Breite (mind. 30 px, dann scrollt der
  // Rahmen waagerecht; höchstens 90 px, damit wenige Wochen nicht zu
  // klobigen Blöcken werden).
  const anzahlSpalten = Math.max(wochen.length, 1);
  const spalte = Math.min(
    90,
    Math.max(30, (rahmenBreite - links - rechts) / anzahlSpalten)
  );
  const breite = links + rechts + anzahlSpalten * spalte;
  const plotH = hoehe - oben - unten;
  const y = (v: number) => oben + plotH - (v / yMax) * plotH;
  const balkenB = Math.min(spalte - 8, spalte * 0.7);

  const farbe = (h: string) =>
    farbModus === "herkunft"
      ? herkunftFarbe(herkunftListe, h === OHNE ? null : h)
      : bereichFarbe(einsatzbereiche, h === OHNE ? null : h);
  const label = (h: string) =>
    h === OHNE ? (farbModus === "herkunft" ? "ohne Herkunft" : "ohne Bereich") : h;
  // x-Position eines Datums (Tage seit dem ersten Montag, je Woche eine Spalte)
  const xVon = (iso: string) => {
    if (wochen.length === 0) return links;
    const tage =
      (new Date(`${iso}T00:00:00Z`).getTime() -
        new Date(`${wochen[0]}T00:00:00Z`).getTime()) /
      86400000;
    return links + Math.max(0, Math.min(tage / 7, anzahlSpalten)) * spalte;
  };

  const aktiveWoche = gewaehlteWoche ?? hoverWoche;

  if (personen.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        Noch keine zugesagten Personen für {saisonJahr}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded border border-linie">
          {(
            [
              ["anwesend", "Anwesend je Woche"],
              ["anreisen", "Anreisen je Woche"],
            ] as const
          ).map(([m, text]) => (
            <button
              key={m}
              type="button"
              className={`px-3 py-1 text-sm ${modus === m ? "bg-emerald-700 text-white" : "bg-white text-neutral-700"}`}
              onClick={() => {
                setModus(m);
                setGewaehlteWoche(null);
              }}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-sm text-neutral-600">
          Farbe nach
          <div className="flex overflow-hidden rounded border border-linie">
            {(
              [
                ["herkunft", "Herkunft"],
                ["bereich", "Einsatzbereich"],
              ] as const
            ).map(([m, text]) => (
              <button
                key={m}
                type="button"
                className={`px-3 py-1 text-sm ${farbModus === m ? "bg-emerald-700 text-white" : "bg-white text-neutral-700"}`}
                onClick={() => setFarbModus(m)}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={alsTabelle}
            onChange={(e) => setAlsTabelle(e.target.checked)}
          />
          als Tabelle
        </label>
        {ohneDatum > 0 && (
          <span className="text-sm text-amber-700">
            ⚠ noch nicht terminiert: {ohneDatum} (fehlen im Zeitstrahl)
          </span>
        )}
      </div>

      {/* Legende */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-700">
        {stapelGruppen.map((h) => (
          <span key={h} className="flex items-center gap-1">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: farbe(h) }}
            />
            {label(h)}
          </span>
        ))}
        <span className="flex items-center gap-1 text-neutral-500">
          <svg width="12" height="12" aria-hidden="true">
            <rect width="12" height="12" rx="2" fill="#8a8984" opacity="0.3" />
            <path d="M0 12 L12 0 M-3 3 L3 -3 M9 15 L15 9" stroke="#8a8984" strokeWidth="1.5" />
          </svg>
          hell/schraffiert = Platzhalter
        </span>
        {modus === "anwesend" && sollGesamt > 0 && (
          <span className="flex items-center gap-1 text-neutral-500">
            <svg width="16" height="12" aria-hidden="true">
              <line x1="0" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Soll gesamt ({sollGesamt})
          </span>
        )}
      </div>

      {alsTabelle ? (
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th>KW</th>
                <th>ab</th>
                {stapelGruppen.map((h) => (
                  <th key={h}>{label(h)}</th>
                ))}
                <th>Summe</th>
                <th>davon Platzhalter</th>
              </tr>
            </thead>
            <tbody>
              {wochen.map((w) => {
                const d = daten.get(w);
                const ph = [...(d?.values() ?? [])].reduce((s, e) => s + e.platzhalter, 0);
                return (
                  <tr key={w}>
                    <td>{kalenderwoche(w)}</td>
                    <td>{formatDatumDE(w)}</td>
                    {stapelGruppen.map((h) => {
                      const e = d?.get(h);
                      return <td key={h}>{e ? e.namen + e.platzhalter : "—"}</td>;
                    })}
                    <td className="font-medium">{summeWoche(w)}</td>
                    <td>{ph || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={rahmenRef}
          className="relative overflow-x-auto rounded border border-linie bg-white"
        >
          <svg
            viewBox={`0 0 ${breite} ${hoehe}`}
            width={breite}
            height={hoehe}
            role="img"
            aria-label={`${modus === "anwesend" ? "Anwesende" : "Anreisende"} Personen je Kalenderwoche, gestapelt nach Herkunft, Saison ${saisonJahr}`}
            className="block text-neutral-700"
            onMouseLeave={() => setHoverWoche(null)}
          >
            <defs>
              {stapelGruppen.map((h, i) => (
                <pattern
                  key={h}
                  id={`pp-schraffur-${i}`}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="6" height="6" fill={farbe(h)} opacity="0.3" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={farbe(h)} strokeWidth="2" />
                </pattern>
              ))}
            </defs>

            {/* Saisonzeiträume der Einsatzbereiche */}
            {baender.map((b, i) => {
              const x0 = xVon(b.von);
              const x1 = xVon(plusTage(b.bis, 1));
              const yb = bandOben + i * (bandH + 4);
              const c = bereichFarbe(einsatzbereiche, b.einsatzbereich);
              return (
                <g key={b.einsatzbereich}>
                  <title>{`${b.einsatzbereich}: ${formatDatumDE(b.von)} – ${formatDatumDE(b.bis)}`}</title>
                  <rect
                    x={x0}
                    y={yb}
                    width={Math.max(2, x1 - x0)}
                    height={bandH}
                    rx={4}
                    fill={c}
                    fillOpacity={0.28}
                    stroke={c}
                    strokeWidth={1.5}
                  />
                  <text
                    x={x0 + 6}
                    y={yb + bandH - 4}
                    fontSize="11"
                    fill="currentColor"
                    fontWeight="600"
                  >
                    {b.einsatzbereich}
                  </text>
                  {/* dezente Hilfslinien bis in das Diagramm */}
                  {[x0, x1].map((x, j) => (
                    <line
                      key={j}
                      x1={x}
                      x2={x}
                      y1={yb + bandH}
                      y2={hoehe - unten}
                      stroke={c}
                      strokeOpacity={0.35}
                      strokeDasharray="2 3"
                    />
                  ))}
                </g>
              );
            })}

            {/* Raster + y-Achse */}
            {Array.from({ length: yMax / yStep + 1 }, (_, i) => i * yStep).map((v) => (
              <g key={v}>
                <line
                  x1={links}
                  x2={breite - rechts}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  strokeOpacity={v === 0 ? 0.5 : 0.12}
                />
                <text
                  x={links - 6}
                  y={y(v) + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="currentColor"
                  fillOpacity="0.7"
                >
                  {v}
                </text>
              </g>
            ))}

            {/* Säulen */}
            {wochen.map((w, wi) => {
              const x = links + wi * spalte + (spalte - balkenB) / 2;
              const d = daten.get(w);
              let basis = 0;
              const segmente: React.ReactNode[] = [];
              stapelGruppen.forEach((h, hi) => {
                const e = d?.get(h);
                if (!e) return;
                for (const [teil, n] of [
                  ["namen", e.namen],
                  ["platzhalter", e.platzhalter],
                ] as const) {
                  if (n === 0) continue;
                  const y1 = y(basis + n);
                  const y0 = y(basis);
                  const hgt = Math.max(1, y0 - y1 - 2); // 2px Fuge
                  segmente.push(
                    <rect
                      key={`${h}-${teil}`}
                      x={x}
                      y={y1}
                      width={balkenB}
                      height={hgt}
                      rx={2}
                      fill={teil === "namen" ? farbe(h) : `url(#pp-schraffur-${hi})`}
                    />
                  );
                  basis += n;
                }
              });
              const aktiv = aktiveWoche === w;
              const kw = kalenderwoche(w);
              const zeigeLabel = spalte >= 40 || wi % 2 === 0;
              return (
                <g
                  key={w}
                  onMouseEnter={() => setHoverWoche(w)}
                  onClick={() => setGewaehlteWoche(gewaehlteWoche === w ? null : w)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Trefferfläche größer als die Säule */}
                  <rect
                    x={links + wi * spalte}
                    y={oben}
                    width={spalte}
                    height={plotH}
                    fill="currentColor"
                    fillOpacity={aktiv ? 0.06 : 0}
                  />
                  {segmente}
                  {basis > 0 && (aktiv || spalte >= 34) && (
                    <text
                      x={x + balkenB / 2}
                      y={y(basis) - 4}
                      textAnchor="middle"
                      fontSize="11"
                      fill="currentColor"
                    >
                      {basis}
                    </text>
                  )}
                  {zeigeLabel && (
                    <>
                      <text
                        x={x + balkenB / 2}
                        y={hoehe - unten + 14}
                        textAnchor="middle"
                        fontSize="11"
                        fill="currentColor"
                        fillOpacity="0.8"
                      >
                        KW{kw}
                      </text>
                      <text
                        x={x + balkenB / 2}
                        y={hoehe - unten + 27}
                        textAnchor="middle"
                        fontSize="10"
                        fill="currentColor"
                        fillOpacity="0.55"
                      >
                        {formatDatumDE(w).slice(0, 6)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {/* Soll-Linie */}
            {modus === "anwesend" && sollGesamt > 0 && (
              <line
                x1={links}
                x2={breite - rechts}
                y1={y(sollGesamt)}
                y2={y(sollGesamt)}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            {modus === "anwesend" && sollGesamt > 0 && (
              <text
                x={breite - rechts}
                y={y(sollGesamt) - 5}
                textAnchor="end"
                fontSize="11"
                fill="currentColor"
                pointerEvents="none"
              >
                Soll gesamt {sollGesamt}
              </text>
            )}
          </svg>
        </div>
      )}

      {/* Detail zur gewählten / überfahrenen Woche */}
      {aktiveWoche && !alsTabelle && (
        <div className="rounded border border-linie bg-white p-3 text-sm">
          <p className="mb-2 font-medium">
            KW {kalenderwoche(aktiveWoche)} ({formatDatumDE(aktiveWoche)} –{" "}
            {formatDatumDE(plusTage(aktiveWoche, 6))}):{" "}
            {summeWoche(aktiveWoche)}{" "}
            {modus === "anwesend" ? "anwesend" : "Anreisen"}
            {!gewaehlteWoche && (
              <span className="font-normal text-neutral-500">
                {" "}
                – klicken, um die Namen festzuhalten
              </span>
            )}
          </p>
          <div className="flex flex-col gap-1">
            {stapelGruppen.map((h) => {
              const e = daten.get(aktiveWoche)?.get(h);
              if (!e) return null;
              return (
                <div key={h}>
                  <span className="inline-flex items-center gap-1 font-medium">
                    <span
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ background: farbe(h) }}
                    />
                    {label(h)}: {e.namen + e.platzhalter}
                  </span>
                  {e.platzhalter > 0 && (
                    <span className="text-neutral-500">
                      {" "}
                      (davon {e.platzhalter} Platzhalter)
                    </span>
                  )}
                  {gewaehlteWoche && (
                    <div className="ml-4 text-xs text-neutral-600">
                      {e.liste
                        .filter((k) => !k.platzhalter)
                        .map(
                          (k) =>
                            `${kandidatAnzeige(k)}${modus === "anwesend" && k.geplante_ankunft ? ` (ab ${formatDatumDE(k.geplante_ankunft)})` : ""}`
                        )
                        .join(" · ") || "nur Platzhalter"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
