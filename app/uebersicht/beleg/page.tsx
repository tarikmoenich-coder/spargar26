"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { formatDatumDE, formatMenge } from "@/lib/format";
import type { SeasonSummaryRow } from "@/lib/types";

// Einzelbeleg der Abrechnung EINER Person mit der kompletten Rechenkette
// (Stunden → Brutto → Netto → Abzüge → Auszahlung), Nutzer-Wunsch 2026-09-25.
// Reine Anzeige/Druck: alle Zahlen stammen aus season_summary (bei bereits
// abgerechneten Personen der eingefrorene Snapshot, wie in der Lohnübersicht),
// die Aufschlüsselung der Prämien/Abzüge ergänzend aus season_bonuses,
// work_entries und employee_vorschuss_historie. Es wird nichts neu berechnet
// oder geschrieben - fehlen Detaildaten (Rolle ohne Zugriff auf
// season_bonuses), erscheint stattdessen die zusammengefasste Zeile.

// Muss mit dem festen Satz in der Sicht season_summary übereinstimmen
// (round(bruttolohn * 0.05275, 2), nur Abrechnungsart 'pauschal').
const LOHNSTEUER_PAUSCHAL_SATZ = 0.05275;

const MONATE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

interface BonusDetail {
  akkord_betrag: number | null;
  praemie_ausgleich: number | null;
  fahrer_zulage: number | null;
  erdbeer_praemie: number | null;
  spargel_praemie: number | null;
  bus_hin: number | null;
  bus_rueck: number | null;
  kleidung_hose_anzahl: number | null;
  kleidung_jacke_anzahl: number | null;
  kleidung_stiefel_anzahl: number | null;
}

interface VerpflegungsSatzKleidung {
  kleidung_hose: number | null;
  kleidung_jacke: number | null;
  kleidung_stiefel: number | null;
}

interface ArbeitsTag {
  datum: string;
  stunden: number | null;
  markierung: string | null;
}

interface VorschussZeile {
  datum: string;
  betrag: number | null;
  zahlungsart: string | null;
  begruendung: string | null;
  art: string | null;
}

interface Zeile {
  label: string;
  rechnung?: string;
  betrag: number;
  // "plus"/"minus" schreibt das Vorzeichen vor den Betrag, "summe" ist eine
  // fett gesetzte Zwischensumme.
  art: "plus" | "minus" | "summe";
}

function fmt(n: number | string | null | undefined) {
  return n === null || n === undefined || n === ""
    ? "—"
    : formatMenge(Number(n), 2);
}

function zahl(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function BelegInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const jahrParam = params.get("jahr");
  const { profile, loading: profilLaedt } = useProfile();
  const canView =
    profile?.role === "admin" ||
    profile?.role === "hr" ||
    profile?.role === "kasse" ||
    profile?.role === "lohnabrechnung" ||
    profile?.role === "pruefer" ||
    profile?.role === "management";

  const [row, setRow] = useState<SeasonSummaryRow | null>(null);
  const [bonus, setBonus] = useState<BonusDetail | null>(null);
  const [kleidungSaetze, setKleidungSaetze] =
    useState<VerpflegungsSatzKleidung | null>(null);
  const [tage, setTage] = useState<ArbeitsTag[]>([]);
  const [vorschuesse, setVorschuesse] = useState<VorschussZeile[]>([]);
  const [belegnummer, setBelegnummer] = useState<string | null>(null);
  const [gruppeText, setGruppeText] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !canView) {
      setLaedt(false);
      return;
    }
    (async () => {
      const supabase = getSupabaseClient();
      const { data: rows, error } = await supabase
        .from("season_summary")
        .select("*")
        .eq("employee_id", id);
      if (error) {
        setFehler(error.message);
        setLaedt(false);
        return;
      }
      const alle = (rows ?? []) as SeasonSummaryRow[];
      const gewaehlt = jahrParam
        ? alle.find((r) => r.saison_jahr === Number(jahrParam))
        : [...alle].sort((a, b) => b.saison_jahr - a.saison_jahr)[0];
      if (!gewaehlt) {
        setFehler("Für diese Person gibt es (noch) keine Abrechnungsdaten.");
        setLaedt(false);
        return;
      }
      setRow(gewaehlt);
      const jahr = gewaehlt.saison_jahr;

      const [bonusRes, satzRes, tageListe, vorschussListe, belegRes, grpRes] =
        await Promise.all([
          supabase
            .from("season_bonuses")
            .select(
              "akkord_betrag, praemie_ausgleich, fahrer_zulage, erdbeer_praemie, spargel_praemie, bus_hin, bus_rueck, kleidung_hose_anzahl, kleidung_jacke_anzahl, kleidung_stiefel_anzahl"
            )
            .eq("employee_id", id)
            .eq("saison_jahr", jahr)
            .maybeSingle(),
          supabase
            .from("verpflegungssaetze")
            .select("kleidung_hose, kleidung_jacke, kleidung_stiefel")
            .eq("saison_jahr", jahr)
            .maybeSingle(),
          ladeAlleSeiten<ArbeitsTag>((von, bis) =>
            supabase
              .from("work_entries")
              .select("datum, stunden, markierung")
              .eq("employee_id", id)
              .gte("datum", `${jahr}-01-01`)
              .lte("datum", `${jahr}-12-31`)
              .order("datum")
              .range(von, bis)
          ),
          ladeAlleSeiten<VorschussZeile & { storniert: boolean }>((von, bis) =>
            supabase
              .from("employee_vorschuss_historie")
              .select("datum, betrag, zahlungsart, begruendung, art, storniert")
              .eq("employee_id", id)
              .eq("storniert", false)
              .order("datum")
              .range(von, bis)
          ),
          gewaehlt.auszahlungsbeleg_id
            ? supabase
                .from("auszahlungsbelege")
                .select("belegnummer")
                .eq("id", gewaehlt.auszahlungsbeleg_id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          gewaehlt.gruppe_nr
            ? supabase
                .from("arbeitsgruppen")
                .select("bezeichnung")
                .eq("gruppe_nr", gewaehlt.gruppe_nr)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

      setBonus((bonusRes.data as BonusDetail | null) ?? null);
      setKleidungSaetze(
        (satzRes.data as VerpflegungsSatzKleidung | null) ?? null
      );
      setTage(tageListe);
      setVorschuesse(
        vorschussListe.filter((v) => v.datum.slice(0, 4) === String(jahr))
      );
      setBelegnummer(
        (belegRes.data as { belegnummer: string } | null)?.belegnummer ?? null
      );
      const grp = grpRes.data as { bezeichnung: string | null } | null;
      setGruppeText(
        gewaehlt.gruppe_nr
          ? `${gewaehlt.gruppe_nr} – ${grp?.bezeichnung ?? "?"}`
          : null
      );
      setLaedt(false);
    })();
  }, [id, jahrParam, canView]);

  // Bei abgerechneten Personen gilt der eingefrorene Stand, sonst live -
  // identisch zu anzeige() in der Lohnübersicht.
  const wert = (feld: keyof SeasonSummaryRow): number | string | null => {
    if (!row) return null;
    if (row.snapshot && feld in row.snapshot) return row.snapshot[feld];
    return row[feld] as number | string | null;
  };

  const monate = useMemo(() => {
    const m = new Map<
      number,
      { tage: number; arbeit: number; urlaubTage: number }
    >();
    for (const t of tage) {
      if (t.stunden === null && t.markierung === null) continue;
      const monat = Number(t.datum.slice(5, 7));
      const e = m.get(monat) ?? { tage: 0, arbeit: 0, urlaubTage: 0 };
      e.tage += 1;
      e.arbeit += zahl(t.stunden);
      if (t.markierung === "U") e.urlaubTage += 1;
      m.set(monat, e);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [tage]);

  if (profilLaedt || laedt) {
    return <p className="p-4 text-sm text-neutral-500">Lädt …</p>;
  }
  if (!canView) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        Der Auszahlungsbeleg ist nur für Rollen mit Zugriff auf die Lohnübersicht.
      </p>
    );
  }
  if (!id || fehler || !row) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        {fehler ?? "Keine Person angegeben (?id=…)."}
      </p>
    );
  }

  // --- Zahlen (alle aus derselben Quelle: Snapshot oder live) --------------
  const stunden = zahl(wert("gesamt_stunden"));
  const anwTage = zahl(wert("anwesenheitstage"));
  const basis = zahl(wert("basis_brutto"));
  const praemienSumme = zahl(wert("praemien_summe"));
  const stundenkonto = zahl(wert("stundenkonto_auszahlung_betrag"));
  const brutto = zahl(wert("bruttolohn"));
  const lohnsteuer = zahl(wert("lohnsteuer_pauschal"));
  const nettoRaw = wert("netto");
  const netto = nettoRaw === null ? null : zahl(nettoRaw);
  const verpflegung = zahl(wert("abzug_verpflegung"));
  const wohnen = zahl(wert("abzug_wohnen"));
  const vorschuss = zahl(wert("vorschuss_summe"));
  const busKosten = zahl(wert("bus_kosten"));
  const kleidung = zahl(wert("kleidung_betrag"));
  const fahrerKaution = zahl(wert("fahrer_kaution"));
  const zimmerKaution = zahl(wert("zimmer_kaution"));
  const freieTage = zahl(wert("verpflegungsfreie_tage"));
  const auszahlungRaw = wert("auszahlungsbetrag");
  const auszahlung = auszahlungRaw === null ? null : zahl(auszahlungRaw);

  const stundenlohn = stunden > 0 ? basis / stunden : null;
  const verpflegungTage = Math.max(0, anwTage - freieTage);
  const verpflegungSatz = verpflegungTage > 0 ? verpflegung / verpflegungTage : null;
  const wohnenSatz = anwTage > 0 ? wohnen / anwTage : null;
  const istPauschal = row.abrechnungsart === "pauschal";

  // Prämien: mit Detailzugriff einzeln, der Rest (Zuckermais/Erdbeeren aus
  // der Tageserfassung) ergibt sich als Differenz zur Summe der Sicht - so
  // geht die Aufschlüsselung immer exakt auf.
  const praemienZeilen: Zeile[] = [];
  if (bonus) {
    const einzeln: [string, number | null][] = [
      ["Akkord", bonus.akkord_betrag],
      ["Prämienausgleich", bonus.praemie_ausgleich],
      ["Fahrerzulage", bonus.fahrer_zulage],
      ["Erdbeerprämie", bonus.erdbeer_praemie],
      ["Spargelprämie", bonus.spargel_praemie],
    ];
    let bekannt = 0;
    for (const [label, betrag] of einzeln) {
      const b = zahl(betrag);
      bekannt += b;
      if (b !== 0) praemienZeilen.push({ label, betrag: b, art: "plus" });
    }
    const rest = Math.round((praemienSumme - bekannt) * 100) / 100;
    if (Math.abs(rest) > 0.004) {
      praemienZeilen.push({
        label: "Prämien aus Tageserfassung (Zuckermais/Erdbeeren)",
        betrag: rest,
        art: "plus",
      });
    }
  } else if (praemienSumme !== 0) {
    praemienZeilen.push({ label: "Prämien gesamt", betrag: praemienSumme, art: "plus" });
  }

  const bruttoZeilen: Zeile[] = [
    {
      label: "Basislohn",
      rechnung:
        stundenlohn !== null
          ? `${fmt(stunden)} Std. × ${fmt(stundenlohn)} €/Std.`
          : `${fmt(stunden)} Std.`,
      betrag: basis,
      art: "plus",
    },
    ...praemienZeilen,
  ];
  if (stundenkonto !== 0) {
    bruttoZeilen.push({
      label: "Stundenkonto in Auszahlung umgewandelt",
      betrag: stundenkonto,
      art: "plus",
    });
  }
  bruttoZeilen.push({ label: "Bruttolohn", betrag: brutto, art: "summe" });

  const nettoZeilen: Zeile[] = [];
  if (istPauschal) {
    nettoZeilen.push({
      label: "Lohnsteuer pauschal",
      rechnung: `${fmt(brutto)} € × ${(LOHNSTEUER_PAUSCHAL_SATZ * 100)
        .toString()
        .replace(".", ",")} %`,
      betrag: lohnsteuer,
      art: "minus",
    });
    if (netto !== null) {
      nettoZeilen.push({ label: "Netto", betrag: netto, art: "summe" });
    }
  } else if (netto !== null) {
    nettoZeilen.push({
      label: "Netto laut Lohnprogramm (von Hand eingetragen)",
      rechnung: `Bruttolohn ${fmt(brutto)} €`,
      betrag: netto,
      art: "summe",
    });
  }

  const hose = zahl(bonus?.kleidung_hose_anzahl);
  const jacke = zahl(bonus?.kleidung_jacke_anzahl);
  const stiefel = zahl(bonus?.kleidung_stiefel_anzahl);
  const kleidungRechnung = [
    hose ? `${hose} Hose × ${fmt(kleidungSaetze?.kleidung_hose)} €` : null,
    jacke ? `${jacke} Jacke × ${fmt(kleidungSaetze?.kleidung_jacke)} €` : null,
    stiefel
      ? `${stiefel} Stiefel × ${fmt(kleidungSaetze?.kleidung_stiefel)} €`
      : null,
  ]
    .filter(Boolean)
    .join(" + ");

  const abzugZeilen: Zeile[] = [];
  if (verpflegung !== 0) {
    abzugZeilen.push({
      label: "Verpflegung",
      rechnung:
        verpflegungSatz !== null
          ? `${verpflegungTage} Tage × ${fmt(verpflegungSatz)} €` +
            (freieTage ? ` (${freieTage} verpflegungsfreie Tage nicht gezählt)` : "")
          : undefined,
      betrag: verpflegung,
      art: "minus",
    });
  }
  if (wohnen !== 0) {
    abzugZeilen.push({
      label: "Unterkunft",
      rechnung:
        wohnenSatz !== null ? `${anwTage} Tage × ${fmt(wohnenSatz)} €` : undefined,
      betrag: wohnen,
      art: "minus",
    });
  }
  if (vorschuss !== 0) {
    abzugZeilen.push({
      label: "Vorschüsse / Strafen / Rechnungen",
      rechnung: `${vorschuesse.length} Buchung(en), siehe Aufstellung unten`,
      betrag: vorschuss,
      art: "minus",
    });
  }
  if (busKosten !== 0) {
    abzugZeilen.push({
      label: "Buskosten (Heimreise)",
      rechnung: bonus
        ? `Hinfahrt ${fmt(zahl(bonus.bus_hin))} € + Rückfahrt ${fmt(zahl(bonus.bus_rueck))} €`
        : undefined,
      betrag: busKosten,
      art: "minus",
    });
  }
  if (kleidung !== 0) {
    abzugZeilen.push({
      label: "Arbeitskleidung",
      rechnung: kleidungRechnung || undefined,
      betrag: kleidung,
      art: "minus",
    });
  }
  if (fahrerKaution !== 0) {
    abzugZeilen.push({ label: "Fahrerkaution", betrag: fahrerKaution, art: "minus" });
  }
  if (zimmerKaution !== 0) {
    abzugZeilen.push({ label: "Zimmerkaution", betrag: zimmerKaution, art: "minus" });
  }
  const abzuegeGesamt =
    verpflegung + wohnen + vorschuss + busKosten + kleidung + fahrerKaution + zimmerKaution;

  const vorschussListeSumme = vorschuesse.reduce((s, v) => s + zahl(v.betrag), 0);
  const vorschussAbweichung = Math.abs(vorschussListeSumme - vorschuss) > 0.005;

  const tageSumme = monate.reduce((s, [, m]) => s + m.tage, 0);
  const stundenSumme = monate.reduce(
    (s, [, m]) => s + m.arbeit + m.urlaubTage * 8,
    0
  );
  const listeWeichtAb =
    Math.abs(stundenSumme - stunden) > 0.005 || tageSumme !== anwTage;

  const live = row.auszahlungsbetrag === null ? NaN : Number(row.auszahlungsbetrag);
  const snapshotAbweichung =
    !!row.snapshot &&
    auszahlung !== null &&
    !Number.isNaN(live) &&
    Math.abs(live - auszahlung) > 0.005;

  function Tabelle({ zeilen }: { zeilen: Zeile[] }) {
    return (
      <table className="w-full text-sm">
        <tbody>
          {zeilen.map((z, i) => (
            <tr
              key={i}
              className={z.art === "summe" ? "border-t border-neutral-400 font-semibold" : ""}
            >
              <td className="py-0.5 pr-2">{z.label}</td>
              <td className="py-0.5 pr-2 text-xs text-neutral-500">{z.rechnung}</td>
              <td className="w-28 py-0.5 text-right tabular-nums">
                {z.art === "minus" ? "− " : z.art === "plus" && i > 0 ? "+ " : ""}
                {fmt(z.betrag)} €
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
    return (
      <section className="break-inside-avoid">
        <h2 className="mb-1 border-b border-emerald-800 text-xs font-semibold uppercase tracking-wide text-emerald-800">
          {titel}
        </h2>
        {children}
      </section>
    );
  }

  return (
    <div className="beleg mx-auto flex max-w-3xl flex-col gap-4 p-4 print:gap-3 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <a href="/uebersicht" className="btn-secondary text-xs">
          ← Lohnübersicht
        </a>
        <button type="button" className="btn text-xs" onClick={() => window.print()}>
          Drucken
        </button>
      </div>

      <div className="flex items-end justify-between border-b-2 border-emerald-800 pb-2">
        <div>
          <h1 className="text-xl font-bold text-emerald-800">
            Auszahlungsbeleg · Saison {row.saison_jahr}
          </h1>
          <p className="text-sm text-neutral-700">
            {row.name}, {row.vorname}
            {!row.aktiv && " · inaktiv"}
          </p>
          <p className="text-xs text-neutral-500">
            {gruppeText ? `Gruppe ${gruppeText} · ` : ""}
            Abrechnungsart:{" "}
            {istPauschal
              ? "pauschal (Lohnsteuer 5,275 %)"
              : row.abrechnungsart === "lohnsteuerklasse_1"
                ? "Steuerklasse 1 (Netto aus Lohnprogramm)"
                : "sozialversicherungspflichtig (Netto aus Lohnprogramm)"}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums">{row.personal_nr}</div>
          <div className="text-[10px] text-neutral-500">
            {row.abgerechnet_am
              ? `Abgerechnet am ${formatDatumDE(row.abgerechnet_am)}${
                  belegnummer ? ` · Beleg ${belegnummer}` : ""
                }`
              : "Vorläufig – noch nicht abgerechnet"}
          </div>
          <div className="text-[10px] text-neutral-500">
            Stand {formatDatumDE(new Date().toISOString())}
          </div>
        </div>
      </div>

      {snapshotAbweichung && (
        <div className="border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-900 print:bg-white">
          Dieser Beleg zeigt den bei der Abrechnung eingefrorenen Stand. Die
          Live-Berechnung ergibt heute {fmt(live)} € – seitdem wurde etwas
          geändert.
        </div>
      )}

      <Abschnitt titel="1 · Arbeitszeit">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-0.5 font-normal">Monat</th>
              <th className="py-0.5 text-right font-normal">Anwesenheitstage</th>
              <th className="py-0.5 text-right font-normal">Arbeitsstunden</th>
              <th className="py-0.5 text-right font-normal">Urlaub (8 Std./Tag)</th>
              <th className="py-0.5 text-right font-normal">Stunden</th>
            </tr>
          </thead>
          <tbody>
            {monate.map(([monat, m]) => (
              <tr key={monat} className="border-t border-linie">
                <td className="py-0.5">{MONATE[monat - 1]}</td>
                <td className="py-0.5 text-right tabular-nums">{m.tage}</td>
                <td className="py-0.5 text-right tabular-nums">{fmt(m.arbeit)}</td>
                <td className="py-0.5 text-right tabular-nums">
                  {m.urlaubTage ? `${m.urlaubTage} Tg. = ${fmt(m.urlaubTage * 8)}` : "—"}
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {fmt(m.arbeit + m.urlaubTage * 8)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-neutral-400 font-semibold">
              <td className="py-0.5">Saison gesamt</td>
              <td className="py-0.5 text-right tabular-nums">{anwTage}</td>
              <td className="py-0.5" />
              <td className="py-0.5" />
              <td className="py-0.5 text-right tabular-nums">{fmt(stunden)}</td>
            </tr>
          </tbody>
        </table>
        {listeWeichtAb && (
          <p className="mt-1 text-[11px] text-amber-700">
            Hinweis: Die Monatsaufstellung ergibt {fmt(stundenSumme)} Std. an{" "}
            {tageSumme} Tagen – die abgerechneten Werte oben weichen davon ab
            (eingefrorener Stand oder spätere Änderung).
          </p>
        )}
      </Abschnitt>

      <Abschnitt titel="2 · Bruttolohn">
        <Tabelle zeilen={bruttoZeilen} />
      </Abschnitt>

      <Abschnitt titel="3 · Netto">
        {nettoZeilen.length > 0 ? (
          <Tabelle zeilen={nettoZeilen} />
        ) : (
          <p className="text-sm text-amber-700">
            Netto-Betrag aus dem Lohnprogramm noch nicht eingetragen – der
            Auszahlungsbetrag ist deshalb noch nicht berechenbar.
          </p>
        )}
      </Abschnitt>

      <Abschnitt titel="4 · Abzüge">
        {abzugZeilen.length > 0 ? (
          <Tabelle
            zeilen={[
              ...abzugZeilen,
              { label: "Abzüge gesamt", betrag: abzuegeGesamt, art: "summe" },
            ]}
          />
        ) : (
          <p className="text-sm text-neutral-500">Keine Abzüge.</p>
        )}
      </Abschnitt>

      <section className="break-inside-avoid border-2 border-emerald-800 px-3 py-2">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-sm font-semibold">Auszahlungsbetrag</div>
            <div className="text-xs text-neutral-600">
              {netto !== null
                ? `Netto ${fmt(netto)} € − Abzüge ${fmt(abzuegeGesamt)} €`
                : "noch nicht berechenbar"}
              {auszahlung !== null && stunden > 0
                ? ` · ${fmt(auszahlung / stunden)} €/Std. auf die Hand`
                : ""}
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {auszahlung !== null ? `${fmt(auszahlung)} €` : "—"}
          </div>
        </div>
      </section>

      {vorschuesse.length > 0 && (
        <Abschnitt titel="Anhang · Vorschüsse und Abzugsbuchungen">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="py-0.5 font-normal">Datum</th>
                <th className="py-0.5 font-normal">Art</th>
                <th className="py-0.5 font-normal">Zahlung</th>
                <th className="py-0.5 font-normal">Begründung</th>
                <th className="py-0.5 text-right font-normal">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {vorschuesse.map((v, i) => (
                <tr key={i} className="border-t border-linie">
                  <td className="py-0.5">{formatDatumDE(v.datum)}</td>
                  <td className="py-0.5">{v.art ?? "—"}</td>
                  <td className="py-0.5">{v.zahlungsart ?? "—"}</td>
                  <td className="py-0.5">{v.begruendung ?? ""}</td>
                  <td className="py-0.5 text-right tabular-nums">{fmt(v.betrag)} €</td>
                </tr>
              ))}
              <tr className="border-t border-neutral-400 font-semibold">
                <td className="py-0.5" colSpan={4}>
                  Summe
                </td>
                <td className="py-0.5 text-right tabular-nums">
                  {fmt(vorschussListeSumme)} €
                </td>
              </tr>
            </tbody>
          </table>
          {vorschussAbweichung && (
            <p className="mt-1 text-[11px] text-amber-700">
              Hinweis: Die Liste ergibt {fmt(vorschussListeSumme)} €, abgezogen
              wurden {fmt(vorschuss)} € (eingefrorener Stand oder spätere
              Änderung).
            </p>
          )}
        </Abschnitt>
      )}

      <section className="mt-6 grid break-inside-avoid grid-cols-2 gap-10 text-xs text-neutral-600">
        <div className="border-t border-neutral-500 pt-1">
          Datum, Unterschrift Empfänger/in (Betrag erhalten)
        </div>
        <div className="border-t border-neutral-500 pt-1">
          Datum, Unterschrift Auszahlende Stelle
        </div>
      </section>
    </div>
  );
}

export default function BelegPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-neutral-500">Lädt …</p>}>
      <BelegInner />
    </Suspense>
  );
}
