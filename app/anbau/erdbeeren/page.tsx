"use client";

// "Anbau → Erdbeeren" (Nutzer-Vorgabe 2026-08-11, nur admin/erntewirtschaft).
// Löst die Excel "Erdbeerpflanzplanung.xlsx" ab.
//
// Seit Migration 2026-10-19 auf dem generischen Feld/Anbau-Schema: ein
// "Tunnel" ist jetzt eine Gruppe von feld_anbau_abschnitt-Zeilen mit
// gleicher bezeichnung (normalerweise genau eine - zwei nur bei geteilter
// Sorte im selben Tunnel). Länge/Reihenabstand/Pfl.-pro-lfm/Cotura gelten
// als physische Eigenschaft des Tunnels und werden beim Bearbeiten auf ALLE
// Zeilen der Gruppe angewendet; Sorte/Reihenzahl/Pflanzjahr/Pflanztyp sind
// je Zeile (= je Sorte) eigene Werte. Das Standjahr für die gewählte Saison
// wird aus dem Pflanzjahr abgeleitet (Migration 2026-10-31), nicht mehr
// jährlich von Hand hochgezählt.
//
// Pflanzenzahlen und laufende Meter werden gerechnet, nicht getippt -
// Länge × Reihen × Pflanzen-pro-lfm, wie in der Excel Spalte I (4,37 im
// Feld, 8 im Glashaus).

import PageHeader from "@/components/PageHeader";
import { Sprout } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import ErntewirtschaftTabs from "@/components/ErntewirtschaftTabs";
import {
  PFLANZTYPEN,
  PFLANZTYP_LABELS,
  type Feld,
  type FeldAnbauAbschnitt,
  type FeldAnbauUebersicht,
  type Pflanztyp,
} from "@/lib/types";
import { formatDatumDE, formatZahlDE } from "@/lib/format";
import { berechneStandjahr } from "@/lib/anbau";

const CURRENT_YEAR = new Date().getFullYear();

interface Gruppe {
  bezeichnung: string;
  rows: FeldAnbauAbschnitt[];
}

function vergleicheBezeichnung(a: string, b: string): number {
  return a.localeCompare(b, "de", { numeric: true });
}

// Gruppiert die flache Abschnitt-Liste eines Anbau-Jahrgangs nach
// bezeichnung (= "Tunnel") - normalerweise 1 Zeile je Gruppe, 2 bei
// geteilter Sorte. Sortiert nach der frei gewählten Position (bildet die
// räumliche Anordnung auf dem Feld ab); ohne Position hilfsweise natürlich
// nach bezeichnung.
function gruppieren(rows: FeldAnbauAbschnitt[]): Gruppe[] {
  const byBezeichnung = new Map<string, FeldAnbauAbschnitt[]>();
  for (const r of rows) {
    const liste = byBezeichnung.get(r.bezeichnung) ?? [];
    liste.push(r);
    byBezeichnung.set(r.bezeichnung, liste);
  }
  const gruppen: Gruppe[] = [...byBezeichnung.entries()].map(([bezeichnung, rs]) => ({
    bezeichnung,
    rows: rs,
  }));
  gruppen.sort((a, b) => {
    const posA = a.rows[0]?.position;
    const posB = b.rows[0]?.position;
    if (posA != null && posB != null) return posA - posB;
    if (posA != null) return -1;
    if (posB != null) return 1;
    return vergleicheBezeichnung(a.bezeichnung, b.bezeichnung);
  });
  return gruppen;
}

export default function AnbauErdbeerenPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [felder, setFelder] = useState<Feld[]>([]);
  const [uebersicht, setUebersicht] = useState<FeldAnbauUebersicht[]>([]);
  const [abschnitte, setAbschnitte] = useState<Record<number, FeldAnbauAbschnitt[]>>({});

  const [offenesFeld, setOffenesFeld] = useState<number | null>(null);

  // Zweite Sorte in einer Gruppe: eigenes kleines Formular je Gruppe, weil
  // hier die Reihenzahl mit angegeben werden muss.
  const [sortenFormularGruppe, setSortenFormularGruppe] = useState<string | null>(null);

  // Gezogene Zeile beim Umsortieren. Zusätzlich gibt es Pfeiltasten je
  // Zeile - Ziehen funktioniert auf Tablets nicht zuverlässig.
  const [ziehtIndex, setZiehtIndex] = useState<number | null>(null);
  const [nsSorte, setNsSorte] = useState("");
  const [nsReihen, setNsReihen] = useState("");
  const [nsPflanzjahr, setNsPflanzjahr] = useState(String(jahr));
  const [nsPflanztyp, setNsPflanztyp] = useState<Pflanztyp | "">("");
  const [nsPflanzdatum, setNsPflanzdatum] = useState("");

  // Sammelanlage je Feld
  const [saVon, setSaVon] = useState("1");
  const [saBis, setSaBis] = useState("10");
  const [saLaenge, setSaLaenge] = useState("");
  const [saReihen, setSaReihen] = useState("8");
  const [saAbstand, setSaAbstand] = useState("");
  const [saPflLfm, setSaPflLfm] = useState("4.37");

  // Sorte für Tunnelbereich
  const [sbVon, setSbVon] = useState("");
  const [sbBis, setSbBis] = useState("");
  const [sbSorte, setSbSorte] = useState("");
  const [sbPflanzjahr, setSbPflanzjahr] = useState(String(jahr));
  const [sbPflanztyp, setSbPflanztyp] = useState<Pflanztyp | "">("");

  // Tunnel auf anderes Feld verschieben
  const [verschiebeVon, setVerschiebeVon] = useState("");
  const [verschiebeBis, setVerschiebeBis] = useState("");
  const [verschiebeZiel, setVerschiebeZiel] = useState("");

  const [laeuft, setLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: fData }, { data: uData }] = await Promise.all([
      supabase
        .from("feld")
        .select("*")
        .eq("aktiv", true)
        .eq("kultur", "erdbeeren")
        .order("bezeichnung"),
      supabase
        .from("feld_anbau_uebersicht")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("kultur", "erdbeeren")
        .order("feld_bezeichnung"),
    ]);
    setFelder((fData as Feld[]) ?? []);
    const ueb = (uData as FeldAnbauUebersicht[]) ?? [];
    setUebersicht(ueb);

    const anbauIds = ueb.map((u) => u.anbau_id);
    if (anbauIds.length > 0) {
      const { data: aData } = await supabase
        .from("feld_anbau_abschnitt")
        .select("*")
        .in("feld_anbau_id", anbauIds);
      const aMap: Record<number, FeldAnbauAbschnitt[]> = {};
      ((aData as FeldAnbauAbschnitt[]) ?? []).forEach((a) => {
        if (!aMap[a.feld_anbau_id]) aMap[a.feld_anbau_id] = [];
        aMap[a.feld_anbau_id].push(a);
      });
      setAbschnitte(aMap);
    } else {
      setAbschnitte({});
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function anbauAnlegen(feldId: number) {
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau")
      .insert({ feld_id: feldId, saison_jahr: jahr });
    if (error) setFehler(error.message);
    setLaeuft(false);
    load();
  }

  async function vorjahrUebernehmen() {
    if (
      !window.confirm(
        `Alle Felder aus ${jahr - 1} nach ${jahr} übernehmen? ` +
          `Felder, die für ${jahr} schon geplant sind, bleiben unverändert.`
      )
    ) {
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("feld_anbau_vorjahr_uebernehmen", {
      p_saison_jahr: jahr,
      p_quelle_jahr: jahr - 1,
    });
    if (error) setFehler(error.message);
    else window.alert(`${data ?? 0} Feld(er) übernommen.`);
    setLaeuft(false);
    load();
  }

  async function sammelanlage(anbauId: number) {
    const von = Number(saVon);
    const bis = Number(saBis);
    if (!Number.isFinite(von) || !Number.isFinite(bis) || bis < von) {
      setFehler("Bitte einen gültigen Tunnel-Bereich angeben (von ≤ bis).");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc("feld_anbau_abschnitt_sammelanlage", {
      p_feld_anbau_id: anbauId,
      p_von: von,
      p_bis: bis,
      p_reihenlaenge_m: saLaenge ? Number(saLaenge) : null,
      p_reihen_anzahl: saReihen ? Number(saReihen) : null,
      p_pflanzen_pro_lfm: saPflLfm ? Number(saPflLfm) : null,
      p_reihenabstand_m: saAbstand ? Number(saAbstand) : null,
    });
    if (error) setFehler(error.message);
    else window.alert(`${data ?? 0} Tunnel angelegt.`);
    setLaeuft(false);
    load();
  }

  // Gruppen (= Tunnel) eines Feldes im Nummernbereich - Basis für
  // Sorten-Zuweisung und Verschieben.
  function gruppenImBereich(anbauId: number, von: string, bis: string): Gruppe[] {
    const liste = gruppieren(abschnitte[anbauId] ?? []);
    const v = Number(von);
    const b = Number(bis);
    if (!Number.isFinite(v) || !Number.isFinite(b)) return [];
    return liste.filter((g) => {
      const n = Number(g.bezeichnung);
      return Number.isFinite(n) && n >= v && n <= b;
    });
  }

  async function sorteFuerBereich(anbauId: number) {
    const treffer = gruppenImBereich(anbauId, sbVon, sbBis);
    if (treffer.length === 0) {
      setFehler("Keine Tunnel in diesem Nummernbereich gefunden.");
      return;
    }
    if (!sbSorte.trim()) {
      setFehler("Bitte eine Sorte angeben.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    // Setzt die Sorte auf die ERSTE Zeile jeder Gruppe (der Normalfall: eine
    // Sorte je Tunnel). Für eine zweite Sorte im selben Tunnel "+ Sorte"
    // nutzen.
    const ids = treffer.map((g) => g.rows[0].id);
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({
        sorte: sbSorte.trim(),
        pflanzjahr: sbPflanzjahr ? Number(sbPflanzjahr) : null,
        pflanztyp: sbPflanztyp || null,
      })
      .in("id", ids);
    if (error) setFehler(error.message);
    setLaeuft(false);
    load();
  }

  async function tunnelVerschieben(anbauId: number) {
    const treffer = gruppenImBereich(anbauId, verschiebeVon, verschiebeBis);
    if (treffer.length === 0) {
      setFehler("Keine Tunnel in diesem Nummernbereich gefunden.");
      return;
    }
    if (!verschiebeZiel) {
      setFehler("Bitte ein Zielfeld wählen.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const ids = treffer.flatMap((g) => g.rows.map((r) => r.id));
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({ feld_anbau_id: Number(verschiebeZiel) })
      .in("id", ids);
    if (error) setFehler(error.message);
    setLaeuft(false);
    load();
  }

  // Bearbeitung der physischen Tunnel-Eigenschaften (Länge/Reihenabstand/
  // Pfl.-pro-lfm/Cotura) - gilt für ALLE Zeilen der Gruppe, damit sie bei
  // einer geteilten Sorte nicht auseinanderlaufen.
  async function gruppeAendern(
    gruppe: Gruppe,
    feld: "reihenlaenge_m" | "reihenabstand_m" | "pflanzen_pro_lfm" | "cotura_nr",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const istZahlfeld = feld !== "cotura_nr";
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({ [feld]: istZahlfeld ? (wert ? Number(wert) : null) : wert || null })
      .in(
        "id",
        gruppe.rows.map((r) => r.id)
      );
    if (error) setFehler(error.message);
    load();
  }

  // Schreibt die Reihenfolge der Gruppen als fortlaufende Positionen zurück
  // (alle Zeilen einer Gruppe bekommen Positionen in Folge, damit sie
  // beieinander bleiben).
  async function reihenfolgeSpeichern(anbauId: number, liste: Gruppe[]) {
    const supabase = getSupabaseClient();
    // Sofort anzeigen, nicht erst nach dem Speichern.
    setAbschnitte((prev) => ({ ...prev, [anbauId]: liste.flatMap((g) => g.rows) }));
    const alleIds = liste.flatMap((g) => g.rows.map((r) => r.id));
    const { error } = await supabase.rpc("feld_anbau_abschnitt_reihenfolge_setzen", {
      p_ids: alleIds,
    });
    if (error) {
      setFehler(`Reihenfolge konnte nicht gespeichert werden: ${error.message}`);
      load();
    }
  }

  function verschiebeInListe<T>(liste: T[], vonIndex: number, nachIndex: number): T[] {
    const kopie = [...liste];
    const [bewegt] = kopie.splice(vonIndex, 1);
    kopie.splice(nachIndex, 0, bewegt);
    return kopie;
  }

  async function gruppeVerschiebenUm(anbauId: number, gruppen: Gruppe[], index: number, delta: number) {
    const ziel = index + delta;
    if (ziel < 0 || ziel >= gruppen.length) return;
    await reihenfolgeSpeichern(anbauId, verschiebeInListe(gruppen, index, ziel));
  }

  function sortenFormularOeffnen(gruppe: Gruppe) {
    setSortenFormularGruppe(gruppe.bezeichnung);
    setNsSorte("");
    const belegt = gruppe.rows.reduce((s, r) => s + (r.reihen_anzahl ?? 0), 0);
    const gesamt = gruppe.rows[0]?.reihen_anzahl ?? 0;
    const frei = gesamt - belegt;
    setNsReihen(frei > 0 ? String(frei) : "");
    setNsPflanzjahr(String(jahr));
    setNsPflanztyp("");
    setNsPflanzdatum("");
  }

  async function sorteHinzufuegen(anbauId: number, gruppe: Gruppe) {
    if (!nsSorte.trim()) {
      setFehler("Bitte eine Sorte angeben.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const vorlage = gruppe.rows[0];
    const { error } = await supabase.from("feld_anbau_abschnitt").insert({
      feld_anbau_id: anbauId,
      bezeichnung: gruppe.bezeichnung,
      reihenlaenge_m: vorlage.reihenlaenge_m,
      reihenabstand_m: vorlage.reihenabstand_m,
      pflanzen_pro_lfm: vorlage.pflanzen_pro_lfm,
      cotura_nr: vorlage.cotura_nr,
      position: vorlage.position,
      sorte: nsSorte.trim(),
      reihen_anzahl: nsReihen ? Number(nsReihen) : null,
      pflanzjahr: nsPflanzjahr ? Number(nsPflanzjahr) : null,
      pflanztyp: nsPflanztyp || null,
      pflanzdatum: nsPflanzdatum || null,
    });
    if (error) setFehler(error.message);
    else setSortenFormularGruppe(null);
    setLaeuft(false);
    load();
  }

  async function zeileAendern(
    id: number,
    feld: "sorte" | "reihen_anzahl" | "pflanzjahr" | "pflanzdatum",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const zahlFelder = ["reihen_anzahl", "pflanzjahr"];
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .update({
        [feld]: zahlFelder.includes(feld) ? (wert ? Number(wert) : null) : wert || null,
      })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  async function zeileLoeschen(id: number) {
    if (!window.confirm("Diese Bepflanzung wirklich entfernen?")) return;
    const supabase = getSupabaseClient();
    await supabase.from("feld_anbau_abschnitt").delete().eq("id", id);
    load();
  }

  async function tunnelLoeschen(gruppe: Gruppe) {
    if (!window.confirm("Tunnel samt Bepflanzung(en) wirklich löschen?")) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("feld_anbau_abschnitt")
      .delete()
      .in(
        "id",
        gruppe.rows.map((r) => r.id)
      );
    if (error) setFehler(error.message);
    load();
  }

  // Das aktuell gewählte Feld - sein Tunnel-Block steht unter der
  // Feldtabelle, damit die Übersicht erhalten bleibt.
  const gewaehlt = uebersicht.find((u) => u.anbau_id === offenesFeld) ?? null;
  const gewaehlteGruppen: Gruppe[] = gewaehlt ? gruppieren(abschnitte[gewaehlt.anbau_id] ?? []) : [];

  const geplanteIds = new Set(uebersicht.map((u) => u.feld_id));
  const nochNichtGeplant = felder.filter((f) => !geplanteIds.has(f.id));

  const gesamtPflanzen = uebersicht.reduce((s, u) => s + (u.anzahl_pflanzen ?? 0), 0);
  const gesamtAbschnitte = uebersicht.reduce((s, u) => s + (u.anzahl_abschnitte ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <ErntewirtschaftTabs />
      <div>
        <PageHeader icon={Sprout} titel="Anbauplanung Erdbeeren" />
        <p className="text-sm text-neutral-500">
          Je Feld die einzelnen Tunnel mit eigener Länge und Reihenzahl,
          darunter die Bepflanzung je Sorte. Laufende Meter und Pflanzenzahl
          werden gerechnet – Länge × Reihen × Pflanzen je laufendem Meter.
          <br />
          <strong>Zwei Sorten in einem Tunnel:</strong> in der Spalte
          „Bepflanzung" auf „+ Sorte" klicken und die Reihenzahl angeben, die
          diese Sorte belegt – z.B. 4 und 4 bei einem Tunnel mit 8 Reihen.
          <br />
          <strong>Reihenfolge:</strong> die Tunnel lassen sich per Ziehen
          (oder mit den Pfeilen ▲▼) umsortieren – so, wie sie auf dem Feld
          tatsächlich nebeneinander liegen. Die Tunnelnummer bleibt davon
          unberührt.
          <br />
          Das Prämiensystem ist davon unberührt: die Erfassung zeigt
          weiterhin nur die Feldauswahl.
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-4 bg-sand py-2 text-sm">
        <label>
          Saison{" "}
          <input
            type="number"
            value={jahr}
            onChange={(e) => setJahr(Number(e.target.value))}
            className="w-24"
          />
        </label>
        {canEdit && (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={vorjahrUebernehmen}
            disabled={laeuft}
            title={`Felder, Tunnel und Maße aus ${jahr - 1} übernehmen`}
          >
            Aus {jahr - 1} übernehmen
          </button>
        )}
        <span className="text-neutral-500">
          {uebersicht.length} Feld(er) · {formatZahlDE(gesamtAbschnitte)} Tunnel ·{" "}
          {formatZahlDE(gesamtPflanzen)} Pflanzen
        </span>
      </div>

      {fehler && (
        <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">
          {fehler}
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : uebersicht.length === 0 ? (
        <p className="text-neutral-500">
          Für {jahr} ist noch nichts geplant. Übernimm den Vorjahrgang oder
          füge unten ein Feld hinzu.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Feld</th>
                <th>Tunnel</th>
                <th title="Summe Länge × Reihen aller Bepflanzungen">lfm</th>
                <th>Pflanzen</th>
                <th title="Aus der echten Geometrie (ST_Area), unabhängig von der Reihen-Planung">
                  Brutto ha
                </th>
                <th title="Aus Reihen × Länge × Reihenabstand">Netto ha</th>
                <th>Sorten</th>
                <th>Erntefenster</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {uebersicht.map((u) => {
                const offen = offenesFeld === u.anbau_id;
                return (
                  <Fragment key={u.anbau_id}>
                    <tr className={offen ? "bg-emerald-50 font-medium" : ""}>
                      <td className="font-medium">{u.feld_bezeichnung}</td>
                      <td>{u.anzahl_abschnitte}</td>
                      <td>{formatZahlDE(u.laufende_meter)}</td>
                      <td>{formatZahlDE(u.anzahl_pflanzen)}</td>
                      <td>{u.flaeche_brutto_ha != null ? formatZahlDE(u.flaeche_brutto_ha) : "—"}</td>
                      <td>{formatZahlDE(u.netto_ha)}</td>
                      <td className="text-sm">{u.sorten ?? "—"}</td>
                      <td className="text-xs">
                        {u.erntefenster_von || u.erntefenster_bis
                          ? `${formatDatumDE(u.erntefenster_von)} – ${formatDatumDE(u.erntefenster_bis)}`
                          : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => setOffenesFeld(offen ? null : u.anbau_id)}
                        >
                          {offen ? "Ausgewählt" : "Tunnel"}
                        </button>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gewaehlt && (
        <div className="flex flex-col gap-4 rounded border border-emerald-300 bg-sand p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-emerald-800">
              Tunnel: {gewaehlt.feld_bezeichnung}
            </h2>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setOffenesFeld(null)}
            >
              Schließen
            </button>
          </div>

          {fehler && (
            <p className="rounded border border-beere-300 bg-beere-50 p-2 text-sm text-beere-700">
              {fehler}
            </p>
          )}

          {canEdit && (
            <div className="flex flex-col gap-3 rounded border border-linie bg-white p-3 text-xs">
              <div className="flex flex-wrap items-end gap-2">
                <span className="font-medium">Tunnel anlegen:</span>
                <label>
                  von{" "}
                  <input
                    type="number"
                    value={saVon}
                    onChange={(e) => setSaVon(e.target.value)}
                    className="w-16"
                  />
                </label>
                <label>
                  bis{" "}
                  <input
                    type="number"
                    value={saBis}
                    onChange={(e) => setSaBis(e.target.value)}
                    className="w-16"
                  />
                </label>
                <label>
                  Länge m{" "}
                  <input
                    type="number"
                    step="0.01"
                    value={saLaenge}
                    onChange={(e) => setSaLaenge(e.target.value)}
                    className="w-20"
                  />
                </label>
                <label>
                  Reihen{" "}
                  <input
                    type="number"
                    value={saReihen}
                    onChange={(e) => setSaReihen(e.target.value)}
                    className="w-16"
                  />
                </label>
                <label title="Abstand zwischen den Reihen - treibt die Netto-Hektarfläche">
                  Abstand m{" "}
                  <input
                    type="number"
                    step="0.01"
                    value={saAbstand}
                    onChange={(e) => setSaAbstand(e.target.value)}
                    className="w-20"
                  />
                </label>
                <label title="Pflanzen je laufendem Meter - in der bisherigen Excel Spalte I (4,37 im Feld, 8 im Glashaus)">
                  Pfl./lfm{" "}
                  <input
                    type="number"
                    step="0.01"
                    value={saPflLfm}
                    onChange={(e) => setSaPflLfm(e.target.value)}
                    className="w-20"
                  />
                </label>
                <button
                  type="button"
                  className="btn text-xs"
                  disabled={laeuft}
                  onClick={() => sammelanlage(gewaehlt.anbau_id)}
                >
                  Anlegen
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <span className="font-medium">Sorte für Tunnel:</span>
                <label>
                  von{" "}
                  <input
                    type="number"
                    value={sbVon}
                    onChange={(e) => setSbVon(e.target.value)}
                    className="w-16"
                  />
                </label>
                <label>
                  bis{" "}
                  <input
                    type="number"
                    value={sbBis}
                    onChange={(e) => setSbBis(e.target.value)}
                    className="w-16"
                  />
                </label>
                <input
                  placeholder="Sorte"
                  value={sbSorte}
                  onChange={(e) => setSbSorte(e.target.value)}
                  className="w-32"
                />
                <label>
                  Pflanzjahr{" "}
                  <input
                    type="number"
                    placeholder="JJJJ"
                    value={sbPflanzjahr}
                    onChange={(e) => setSbPflanzjahr(e.target.value)}
                    className="w-20"
                  />
                </label>
                <select
                  value={sbPflanztyp}
                  onChange={(e) => setSbPflanztyp(e.target.value as Pflanztyp | "")}
                >
                  <option value="">Pflanztyp …</option>
                  {PFLANZTYPEN.map((t) => (
                    <option key={t} value={t}>
                      {PFLANZTYP_LABELS[t]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn text-xs"
                  disabled={laeuft}
                  onClick={() => sorteFuerBereich(gewaehlt.anbau_id)}
                >
                  Zuweisen
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <span
                  className="font-medium"
                  title="Tunnel auf ein anderes Feld umziehen - z.B. in Vorbereitung auf die Cotura"
                >
                  Tunnel verschieben:
                </span>
                <label>
                  von{" "}
                  <input
                    type="number"
                    value={verschiebeVon}
                    onChange={(e) => setVerschiebeVon(e.target.value)}
                    className="w-16"
                  />
                </label>
                <label>
                  bis{" "}
                  <input
                    type="number"
                    value={verschiebeBis}
                    onChange={(e) => setVerschiebeBis(e.target.value)}
                    className="w-16"
                  />
                </label>
                <select value={verschiebeZiel} onChange={(e) => setVerschiebeZiel(e.target.value)}>
                  <option value="">Zielfeld …</option>
                  {uebersicht
                    .filter((z) => z.anbau_id !== gewaehlt.anbau_id)
                    .map((z) => (
                      <option key={z.anbau_id} value={z.anbau_id}>
                        {z.feld_bezeichnung}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={laeuft}
                  onClick={() => tunnelVerschieben(gewaehlt.anbau_id)}
                >
                  Verschieben
                </button>
              </div>
            </div>
          )}

          {gewaehlteGruppen.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine Tunnel angelegt.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  {canEdit && (
                    <th title="Zeile anfassen und ziehen, oder Pfeile benutzen - die Reihenfolge bildet die Anordnung auf dem Feld ab">
                      ↕
                    </th>
                  )}
                  <th>Tunnel</th>
                  <th>Länge m</th>
                  <th title="Abstand zwischen den Reihen">Abstand m</th>
                  <th title="Pflanzen je laufendem Meter">Pfl./lfm</th>
                  <th title="Rollennummer der Folie">Cotura</th>
                  <th>Bepflanzung</th>
                  <th>Pflanzen</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {gewaehlteGruppen.map((gruppe, index) => {
                  const vorlage = gruppe.rows[0];
                  const summeReihen = gruppe.rows.reduce((s, r) => s + (r.reihen_anzahl ?? 0), 0);
                  return (
                    <tr
                      key={gruppe.bezeichnung}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        setZiehtIndex(index);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", gruppe.bezeichnung);
                      }}
                      onDragEnd={() => setZiehtIndex(null)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={() => {
                        if (ziehtIndex === null || ziehtIndex === index) return;
                        reihenfolgeSpeichern(
                          gewaehlt.anbau_id,
                          verschiebeInListe(gewaehlteGruppen, ziehtIndex, index)
                        );
                        setZiehtIndex(null);
                      }}
                      className={ziehtIndex === index ? "opacity-40" : undefined}
                    >
                      {canEdit && (
                        <td className="whitespace-nowrap">
                          <span className="cursor-grab text-neutral-400" title="Zum Umsortieren ziehen">
                            ⠿
                          </span>
                          <button
                            type="button"
                            className="px-1 text-neutral-500 hover:text-emerald-700 disabled:opacity-30"
                            disabled={index === 0}
                            title="Nach oben"
                            onClick={() => gruppeVerschiebenUm(gewaehlt.anbau_id, gewaehlteGruppen, index, -1)}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            className="px-1 text-neutral-500 hover:text-emerald-700 disabled:opacity-30"
                            disabled={index === gewaehlteGruppen.length - 1}
                            title="Nach unten"
                            onClick={() => gruppeVerschiebenUm(gewaehlt.anbau_id, gewaehlteGruppen, index, 1)}
                          >
                            ▼
                          </button>
                        </td>
                      )}
                      <td className="font-medium">{gruppe.bezeichnung}</td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={vorlage.reihenlaenge_m ?? ""}
                          disabled={!canEdit}
                          className="w-20"
                          onBlur={(e) => gruppeAendern(gruppe, "reihenlaenge_m", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={vorlage.reihenabstand_m ?? ""}
                          disabled={!canEdit}
                          className="w-20"
                          onBlur={(e) => gruppeAendern(gruppe, "reihenabstand_m", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          defaultValue={vorlage.pflanzen_pro_lfm ?? ""}
                          disabled={!canEdit}
                          className="w-20"
                          onBlur={(e) => gruppeAendern(gruppe, "pflanzen_pro_lfm", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          defaultValue={vorlage.cotura_nr ?? ""}
                          disabled={!canEdit}
                          className="w-20"
                          onBlur={(e) => gruppeAendern(gruppe, "cotura_nr", e.target.value)}
                        />
                      </td>
                      <td className="text-xs">
                        <div className="flex flex-col gap-1">
                          {gruppe.rows.map((r) => (
                            <div key={r.id} className="flex flex-wrap items-center gap-1">
                              <input
                                defaultValue={r.sorte ?? ""}
                                placeholder="Sorte"
                                disabled={!canEdit}
                                className="w-28"
                                onBlur={(e) => zeileAendern(r.id, "sorte", e.target.value)}
                              />
                              <input
                                type="number"
                                defaultValue={r.reihen_anzahl ?? ""}
                                disabled={!canEdit}
                                className="w-14"
                                placeholder="Reihen"
                                title="Wie viele Reihen diese Sorte belegt"
                                onBlur={(e) => zeileAendern(r.id, "reihen_anzahl", e.target.value)}
                              />
                              <span className="text-neutral-500">
                                R.
                                {r.pflanzjahr != null && ` · ${berechneStandjahr(r.pflanzjahr, jahr)}. Stj.`}
                                {r.pflanztyp && ` · ${PFLANZTYP_LABELS[r.pflanztyp]}`}
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  className="text-neutral-400 hover:text-beere-600"
                                  title="Entfernen"
                                  onClick={() => zeileLoeschen(r.id)}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}

                          {gruppe.rows.length > 1 && (
                            <span className="text-neutral-400">ΣReihen: {summeReihen}</span>
                          )}

                          {canEdit &&
                            (sortenFormularGruppe === gruppe.bezeichnung ? (
                              <div className="flex flex-wrap items-center gap-1 rounded border border-emerald-300 bg-emerald-50 p-1">
                                <input
                                  placeholder="Sorte"
                                  value={nsSorte}
                                  onChange={(e) => setNsSorte(e.target.value)}
                                  className="w-28"
                                  autoFocus
                                />
                                <input
                                  type="number"
                                  placeholder="Reihen"
                                  value={nsReihen}
                                  onChange={(e) => setNsReihen(e.target.value)}
                                  className="w-16"
                                  title="Wie viele Reihen diese Sorte belegt"
                                />
                                <input
                                  type="number"
                                  placeholder="Pflanzj."
                                  value={nsPflanzjahr}
                                  onChange={(e) => setNsPflanzjahr(e.target.value)}
                                  className="w-20"
                                />
                                <select
                                  value={nsPflanztyp}
                                  onChange={(e) => setNsPflanztyp(e.target.value as Pflanztyp | "")}
                                >
                                  <option value="">Typ …</option>
                                  {PFLANZTYPEN.map((pt) => (
                                    <option key={pt} value={pt}>
                                      {PFLANZTYP_LABELS[pt]}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="date"
                                  value={nsPflanzdatum}
                                  onChange={(e) => setNsPflanzdatum(e.target.value)}
                                  title="Pflanzdatum"
                                />
                                <button
                                  type="button"
                                  className="btn text-xs"
                                  disabled={laeuft}
                                  onClick={() => sorteHinzufuegen(gewaehlt.anbau_id, gruppe)}
                                >
                                  Speichern
                                </button>
                                <button
                                  type="button"
                                  className="btn-secondary text-xs"
                                  onClick={() => setSortenFormularGruppe(null)}
                                >
                                  Abbrechen
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="self-start text-emerald-700 underline"
                                onClick={() => sortenFormularOeffnen(gruppe)}
                              >
                                + Sorte
                              </button>
                            ))}
                        </div>
                      </td>
                      <td>
                        {formatZahlDE(
                          gruppe.rows.reduce(
                            (s, r) =>
                              s +
                              Math.round(
                                (r.reihenlaenge_m ?? 0) * (r.reihen_anzahl ?? 0) * (r.pflanzen_pro_lfm ?? 0)
                              ),
                            0
                          )
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            type="button"
                            className="btn-danger text-xs"
                            onClick={() => tunnelLoeschen(gruppe)}
                          >
                            Löschen
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {canEdit && nochNichtGeplant.length > 0 && (
        <div className="rounded border border-linie bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-emerald-800">
            Feld für {jahr} hinzufügen
          </h2>
          <div className="flex flex-wrap gap-2">
            {nochNichtGeplant.map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn-secondary text-xs"
                disabled={laeuft}
                onClick={() => anbauAnlegen(f.id)}
              >
                + {f.bezeichnung}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Neue Felder werden im Reiter „Felder" angelegt.
          </p>
        </div>
      )}
    </div>
  );
}
