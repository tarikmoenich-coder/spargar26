"use client";

// "Anbau → Erdbeeren" (Nutzer-Vorgabe 2026-08-11, nur admin/erntewirtschaft).
// Löst die Excel "Erdbeerpflanzplanung.xlsx" ab.
//
// Aufbau bewusst als Baum Feld → Tunnel → Bepflanzung: in der Excel ist eine
// Zeile mal ein ganzes Feld, mal nur ein Teilstück davon (weil sich
// unterschiedlich lange Tunnel dort nicht abbilden lassen), und die neun
// Sorten sind Spalten. Beides verschwindet mit dieser Struktur.
//
// Pflanzenzahlen und laufende Meter werden gerechnet, nicht getippt -
// Länge × Reihen × Pflanzen-pro-lfm, wie in der Excel Spalte I (4,37 im
// Feld, 8 im Glashaus).

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import AnbauTabs from "@/components/AnbauTabs";
import {
  PFLANZTYPEN,
  PFLANZTYP_LABELS,
  type ErdbeerenAnbauUebersicht,
  type ErdbeerenBepflanzungBerechnet,
  type ErdbeerenParzelle,
  type ErdbeerenTunnel,
  type Pflanztyp,
} from "@/lib/types";
import { formatDatumDE, formatZahlDE } from "@/lib/format";

const CURRENT_YEAR = new Date().getFullYear();

export default function AnbauErdbeerenPage() {
  const { profile } = useProfile();
  const canEdit =
    profile?.role === "admin" || profile?.role === "erntewirtschaft";

  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [parzellen, setParzellen] = useState<ErdbeerenParzelle[]>([]);
  const [uebersicht, setUebersicht] = useState<ErdbeerenAnbauUebersicht[]>([]);
  const [tunnel, setTunnel] = useState<Record<number, ErdbeerenTunnel[]>>({});
  const [bepflanzung, setBepflanzung] = useState<
    Record<number, ErdbeerenBepflanzungBerechnet[]>
  >({});

  const [offenesFeld, setOffenesFeld] = useState<number | null>(null);

  // Zweite Sorte in einem Tunnel: eigenes kleines Formular je Tunnel, weil
  // hier - anders als beim Bereichs-Werkzeug - die Reihenzahl mit angegeben
  // werden muss. Ohne sie würden sich zwei Sorten denselben Tunnel voll
  // anrechnen und die Pflanzenzahl doppelt zählen.
  const [sortenFormularTunnel, setSortenFormularTunnel] = useState<
    number | null
  >(null);

  // Gezogene Zeile beim Umsortieren. Zusätzlich gibt es Pfeiltasten je
  // Zeile - Ziehen funktioniert auf Tablets nicht zuverlässig, und die
  // Planung wird auch mal unterwegs angesehen.
  const [ziehtIndex, setZiehtIndex] = useState<number | null>(null);
  const [nsSorte, setNsSorte] = useState("");
  const [nsReihen, setNsReihen] = useState("");
  const [nsStandjahr, setNsStandjahr] = useState("1");
  const [nsPflanztyp, setNsPflanztyp] = useState<Pflanztyp | "">("");
  const [nsPflanzdatum, setNsPflanzdatum] = useState("");

  // Sammelanlage je Feld
  const [saVon, setSaVon] = useState("1");
  const [saBis, setSaBis] = useState("10");
  const [saLaenge, setSaLaenge] = useState("");
  const [saReihen, setSaReihen] = useState("8");
  const [saPflLfm, setSaPflLfm] = useState("4.37");

  // Sorte für Tunnelbereich
  const [sbVon, setSbVon] = useState("");
  const [sbBis, setSbBis] = useState("");
  const [sbSorte, setSbSorte] = useState("");
  const [sbStandjahr, setSbStandjahr] = useState("1");
  const [sbPflanztyp, setSbPflanztyp] = useState<Pflanztyp | "">("");

  // Tunnel auf anderes Feld verschieben
  const [verschiebeVon, setVerschiebeVon] = useState("");
  const [verschiebeBis, setVerschiebeBis] = useState("");
  const [verschiebeZiel, setVerschiebeZiel] = useState("");

  const [laeuft, setLaeuft] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: pData }, { data: uData }, { data: bData }] =
      await Promise.all([
        supabase
          .from("erdbeeren_parzellen")
          .select("*")
          .eq("aktiv", true)
          .order("name"),
        supabase
          .from("erdbeeren_anbau_uebersicht")
          .select("*")
          .eq("saison_jahr", jahr)
          .order("parzelle_name"),
        supabase
          .from("erdbeeren_bepflanzung_berechnet")
          .select("*")
          .eq("saison_jahr", jahr),
      ]);
    setParzellen((pData as ErdbeerenParzelle[]) ?? []);
    const ueb = (uData as ErdbeerenAnbauUebersicht[]) ?? [];
    setUebersicht(ueb);

    // Tunnel je Anbau-Jahrgang nachladen (nur für die vorhandenen Jahrgänge).
    const anbauIds = ueb.map((u) => u.anbau_id);
    if (anbauIds.length > 0) {
      const { data: tData } = await supabase
        .from("erdbeeren_tunnel")
        .select("*")
        .in("anbau_id", anbauIds);
      const tMap: Record<number, ErdbeerenTunnel[]> = {};
      ((tData as ErdbeerenTunnel[]) ?? []).forEach((t) => {
        if (!tMap[t.anbau_id]) tMap[t.anbau_id] = [];
        tMap[t.anbau_id].push(t);
      });
      // Nach der frei gewählten Position sortieren - sie bildet die
      // räumliche Anordnung auf dem Feld ab (Nutzer-Vorgabe 2026-08-11).
      // Ohne Position (Altbestand) hilfsweise nach Nummer, natürlich
      // sortiert ("2" vor "10"), da sie Text ist.
      Object.values(tMap).forEach((liste) =>
        liste.sort((a, b) => {
          if (a.position != null && b.position != null) {
            return a.position - b.position;
          }
          if (a.position != null) return -1;
          if (b.position != null) return 1;
          return a.nummer.localeCompare(b.nummer, "de", { numeric: true });
        })
      );
      setTunnel(tMap);
    } else {
      setTunnel({});
    }

    const bMap: Record<number, ErdbeerenBepflanzungBerechnet[]> = {};
    ((bData as ErdbeerenBepflanzungBerechnet[]) ?? []).forEach((b) => {
      if (!bMap[b.tunnel_id]) bMap[b.tunnel_id] = [];
      bMap[b.tunnel_id].push(b);
    });
    setBepflanzung(bMap);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jahr]);

  async function anbauAnlegen(parzelleId: number) {
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("erdbeeren_anbau")
      .insert({ parzelle_id: parzelleId, saison_jahr: jahr });
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
    const { data, error } = await supabase.rpc(
      "erdbeeren_anbau_vorjahr_uebernehmen",
      { p_saison_jahr: jahr, p_quelle_jahr: jahr - 1 }
    );
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
    const { data, error } = await supabase.rpc(
      "erdbeeren_tunnel_sammelanlage",
      {
        p_anbau_id: anbauId,
        p_von: von,
        p_bis: bis,
        p_laenge_m: saLaenge ? Number(saLaenge) : null,
        p_reihen_anzahl: saReihen ? Number(saReihen) : null,
        p_pflanzen_pro_lfm: saPflLfm ? Number(saPflLfm) : null,
      }
    );
    if (error) setFehler(error.message);
    else window.alert(`${data ?? 0} Tunnel angelegt.`);
    setLaeuft(false);
    load();
  }

  // Tunnel eines Feldes im Nummernbereich - Basis für Sorten-Zuweisung und
  // Verschieben, damit bei 182 Tunneln nicht jeder einzeln angefasst wird.
  function tunnelImBereich(
    anbauId: number,
    von: string,
    bis: string
  ): ErdbeerenTunnel[] {
    const liste = tunnel[anbauId] ?? [];
    const v = Number(von);
    const b = Number(bis);
    if (!Number.isFinite(v) || !Number.isFinite(b)) return [];
    return liste.filter((t) => {
      const n = Number(t.nummer);
      return Number.isFinite(n) && n >= v && n <= b;
    });
  }

  async function sorteFuerBereich(anbauId: number) {
    const treffer = tunnelImBereich(anbauId, sbVon, sbBis);
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
    const { error } = await supabase.from("erdbeeren_bepflanzung").insert(
      treffer.map((t) => ({
        tunnel_id: t.id,
        sorte: sbSorte.trim(),
        standjahr: sbStandjahr ? Number(sbStandjahr) : null,
        pflanztyp: sbPflanztyp || null,
      }))
    );
    if (error) setFehler(error.message);
    setLaeuft(false);
    load();
  }

  async function tunnelVerschieben(anbauId: number) {
    const treffer = tunnelImBereich(anbauId, verschiebeVon, verschiebeBis);
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
    const { error } = await supabase
      .from("erdbeeren_tunnel")
      .update({ anbau_id: Number(verschiebeZiel) })
      .in(
        "id",
        treffer.map((t) => t.id)
      );
    if (error) {
      // Häufigster Fall: im Zielfeld gibt es die Nummer schon.
      setFehler(
        error.message.includes("erdbeeren_tunnel_anbau_id_nummer_key")
          ? "Im Zielfeld gibt es bereits einen Tunnel mit dieser Nummer - bitte dort zuerst umbenennen."
          : error.message
      );
    }
    setLaeuft(false);
    load();
  }

  async function tunnelAendern(
    id: number,
    feld: keyof ErdbeerenTunnel,
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const zahlFelder = ["laenge_m", "reihen_anzahl", "pflanzen_pro_lfm"];
    const { error } = await supabase
      .from("erdbeeren_tunnel")
      .update({
        [feld]: zahlFelder.includes(feld as string)
          ? wert
            ? Number(wert)
            : null
          : wert || null,
      })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  // Schreibt die Reihenfolge einer Tunnel-Liste als fortlaufende Positionen
  // zurück. Bewusst alle Zeilen neu durchnummeriert statt nur die bewegten
  // zu tauschen - das hält die Werte lückenlos und ist bei ~20 Tunneln je
  // Feld unproblematisch.
  async function reihenfolgeSpeichern(liste: ErdbeerenTunnel[]) {
    const supabase = getSupabaseClient();
    // Sofort anzeigen, nicht erst nach dem Speichern - sonst "springt" die
    // Zeile beim Ziehen sichtbar zurück.
    setTunnel((prev) => ({ ...prev, [liste[0].anbau_id]: liste }));
    // Bewusst über eine Funktion statt per upsert: erdbeeren_tunnel hat
    // NOT-NULL-Spalten (anbau_id, nummer), ein upsert mit nur id+position
    // würde als INSERT scheitern (Vorfall 2026-08-11).
    const { error } = await supabase.rpc(
      "erdbeeren_tunnel_reihenfolge_setzen",
      { p_ids: liste.map((t) => t.id) }
    );
    if (error) {
      setFehler(`Reihenfolge konnte nicht gespeichert werden: ${error.message}`);
      load();
    }
  }

  function verschiebeInListe(
    liste: ErdbeerenTunnel[],
    vonIndex: number,
    nachIndex: number
  ): ErdbeerenTunnel[] {
    const kopie = [...liste];
    const [bewegt] = kopie.splice(vonIndex, 1);
    kopie.splice(nachIndex, 0, bewegt);
    return kopie;
  }

  async function tunnelVerschiebenUm(anbauId: number, index: number, delta: number) {
    const liste = tunnel[anbauId] ?? [];
    const ziel = index + delta;
    if (ziel < 0 || ziel >= liste.length) return;
    await reihenfolgeSpeichern(verschiebeInListe(liste, index, ziel));
  }

  // Belegte Reihen eines Tunnels - leer gelassene Reihenzahl zählt als
  // "alle Reihen" (siehe View), deshalb hier genauso behandeln.
  function belegteReihen(t: ErdbeerenTunnel): number {
    return (bepflanzung[t.id] ?? []).reduce(
      (s, b) => s + (b.reihen_anzahl ?? t.reihen_anzahl ?? 0),
      0
    );
  }

  function sortenFormularOeffnen(t: ErdbeerenTunnel) {
    setSortenFormularTunnel(t.id);
    setNsSorte("");
    // Vorschlag: die noch freien Reihen des Tunnels.
    const frei = (t.reihen_anzahl ?? 0) - belegteReihen(t);
    setNsReihen(frei > 0 ? String(frei) : "");
    setNsStandjahr("1");
    setNsPflanztyp("");
    setNsPflanzdatum("");
  }

  async function bepflanzungAnlegen(t: ErdbeerenTunnel) {
    if (!nsSorte.trim()) {
      setFehler("Bitte eine Sorte angeben.");
      return;
    }
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("erdbeeren_bepflanzung").insert({
      tunnel_id: t.id,
      sorte: nsSorte.trim(),
      reihen_anzahl: nsReihen ? Number(nsReihen) : null,
      standjahr: nsStandjahr ? Number(nsStandjahr) : null,
      pflanztyp: nsPflanztyp || null,
      pflanzdatum: nsPflanzdatum || null,
    });
    if (error) setFehler(error.message);
    else setSortenFormularTunnel(null);
    setLaeuft(false);
    load();
  }

  async function bepflanzungAendern(
    id: number,
    feld: "sorte" | "reihen_anzahl" | "standjahr" | "pflanzdatum",
    wert: string
  ) {
    const supabase = getSupabaseClient();
    const zahlFelder = ["reihen_anzahl", "standjahr"];
    const { error } = await supabase
      .from("erdbeeren_bepflanzung")
      .update({
        [feld]: zahlFelder.includes(feld)
          ? wert
            ? Number(wert)
            : null
          : wert || null,
      })
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  async function bepflanzungLoeschen(id: number) {
    if (!window.confirm("Diese Bepflanzung wirklich entfernen?")) return;
    const supabase = getSupabaseClient();
    await supabase.from("erdbeeren_bepflanzung").delete().eq("id", id);
    load();
  }

  async function tunnelLoeschen(id: number) {
    if (!window.confirm("Tunnel samt Bepflanzung wirklich löschen?")) return;
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("erdbeeren_tunnel")
      .delete()
      .eq("id", id);
    if (error) setFehler(error.message);
    load();
  }

  // Das aktuell gewählte Feld - sein Tunnel-Block steht unter der
  // Feldtabelle, damit die Übersicht erhalten bleibt.
  const gewaehlt = uebersicht.find((u) => u.anbau_id === offenesFeld) ?? null;
  const gewaehltTunnel: ErdbeerenTunnel[] = gewaehlt
    ? (tunnel[gewaehlt.anbau_id] ?? [])
    : [];

  const geplanteIds = new Set(uebersicht.map((u) => u.parzelle_id));
  const nochNichtGeplant = parzellen.filter((p) => !geplanteIds.has(p.id));

  const gesamtPflanzen = uebersicht.reduce(
    (s, u) => s + (u.anzahl_pflanzen ?? 0),
    0
  );
  const gesamtTunnel = uebersicht.reduce((s, u) => s + (u.anzahl_tunnel ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">
      <AnbauTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Anbauplanung Erdbeeren
        </h1>
        <p className="text-sm text-neutral-500">
          Je Feld die einzelnen Tunnel mit eigener Länge und Reihenzahl,
          darunter die Bepflanzung je Sorte. Laufende Meter und Pflanzenzahl
          werden gerechnet – Länge × Reihen × Pflanzen je laufendem Meter.
          <br />
          <strong>Zwei Sorten in einem Tunnel:</strong> in der Spalte
          „Bepflanzung" auf „+ Sorte" klicken und die Reihenzahl angeben, die
          diese Sorte belegt – z.B. 4 und 4 bei einem Tunnel mit 8 Reihen.
          Bleibt das Reihen-Feld leer, gilt die Sorte für alle Reihen; das ist
          der Normalfall mit nur einer Sorte. Sind zusammen mehr Reihen
          belegt, als der Tunnel hat, erscheint eine Warnung.
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
            title={`Felder, Tunnel und Maße aus ${jahr - 1} übernehmen - ersetzt das Copy/Paste zwischen den Excel-Blättern`}
          >
            Aus {jahr - 1} übernehmen
          </button>
        )}
        <span className="text-neutral-500">
          {uebersicht.length} Feld(er) · {formatZahlDE(gesamtTunnel)} Tunnel ·{" "}
          {formatZahlDE(gesamtPflanzen)} Pflanzen
        </span>
      </div>

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
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
                <th>ha</th>
                <th>Tunnel</th>
                <th title="Summe Länge × Reihen aller Bepflanzungen">lfm</th>
                <th>Pflanzen</th>
                <th>Sorten</th>
                <th>Erntefenster</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {uebersicht.map((u) => {
                const offen = offenesFeld === u.anbau_id;
                const gewaehltTunnel = tunnel[u.anbau_id] ?? [];
                return (
                  <Fragment key={u.anbau_id}>
                    <tr
                      className={
                        offen ? "bg-emerald-50 font-medium" : ""
                      }
                    >
                      <td className="font-medium">{u.parzelle_name}</td>
                      <td>{u.groesse_ha ?? "—"}</td>
                      <td>{u.anzahl_tunnel}</td>
                      <td>{formatZahlDE(u.laufende_meter)}</td>
                      <td>{formatZahlDE(u.anzahl_pflanzen)}</td>
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
                          onClick={() =>
                            setOffenesFeld(offen ? null : u.anbau_id)
                          }
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

      {/* Tunnel des gewählten Feldes - bewusst UNTER der Feldtabelle statt
          als aufgeklappte Zeile mittendrin (Nutzer-Hinweis 2026-08-11: beim
          Aufklappen ging die Übersicht verloren). So bleibt die Feldliste
          immer vollständig sichtbar. */}
      {gewaehlt && (
        <div className="flex flex-col gap-4 rounded border border-emerald-300 bg-sand p-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-emerald-800">
              Tunnel: {gewaehlt.parzelle_name}
            </h2>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setOffenesFeld(null)}
            >
              Schließen
            </button>
          </div>

          {/* Fehler auch hier zeigen, nicht nur ganz oben - beim Sortieren
              und Bearbeiten schaut man in diesen Bereich und würde eine
              Meldung am Seitenanfang schlicht nicht sehen (Nutzer-Meldung
              2026-08-11: "es passiert einfach nichts"). */}
          {fehler && (
            <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
              {fehler}
            </p>
          )}

              {canEdit && (
                <div className="flex flex-col gap-3 rounded border border-linie bg-white p-3 text-xs">
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="font-medium">
                      Tunnel anlegen:
                    </span>
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
                        onChange={(e) =>
                          setSaLaenge(e.target.value)
                        }
                        className="w-20"
                      />
                    </label>
                    <label>
                      Reihen{" "}
                      <input
                        type="number"
                        value={saReihen}
                        onChange={(e) =>
                          setSaReihen(e.target.value)
                        }
                        className="w-16"
                      />
                    </label>
                    <label
                      title="Pflanzen je laufendem Meter - in der bisherigen Excel Spalte I (4,37 im Feld, 8 im Glashaus)"
                    >
                      Pfl./lfm{" "}
                      <input
                        type="number"
                        step="0.01"
                        value={saPflLfm}
                        onChange={(e) =>
                          setSaPflLfm(e.target.value)
                        }
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
                    <span className="font-medium">
                      Sorte für Tunnel:
                    </span>
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
                      Standjahr{" "}
                      <input
                        type="number"
                        value={sbStandjahr}
                        onChange={(e) =>
                          setSbStandjahr(e.target.value)
                        }
                        className="w-16"
                      />
                    </label>
                    <select
                      value={sbPflanztyp}
                      onChange={(e) =>
                        setSbPflanztyp(
                          e.target.value as Pflanztyp | ""
                        )
                      }
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
                        onChange={(e) =>
                          setVerschiebeVon(e.target.value)
                        }
                        className="w-16"
                      />
                    </label>
                    <label>
                      bis{" "}
                      <input
                        type="number"
                        value={verschiebeBis}
                        onChange={(e) =>
                          setVerschiebeBis(e.target.value)
                        }
                        className="w-16"
                      />
                    </label>
                    <select
                      value={verschiebeZiel}
                      onChange={(e) =>
                        setVerschiebeZiel(e.target.value)
                      }
                    >
                      <option value="">Zielfeld …</option>
                      {uebersicht
                        .filter((z) => z.anbau_id !== gewaehlt.anbau_id)
                        .map((z) => (
                          <option
                            key={z.anbau_id}
                            value={z.anbau_id}
                          >
                            {z.parzelle_name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={laeuft}
                      onClick={() =>
                        tunnelVerschieben(gewaehlt.anbau_id)
                      }
                    >
                      Verschieben
                    </button>
                  </div>
                </div>
              )}

              {gewaehltTunnel.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Noch keine Tunnel angelegt.
                </p>
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
                      <th>Reihen</th>
                      <th title="Pflanzen je laufendem Meter">
                        Pfl./lfm
                      </th>
                      <th title="Rollennummer der Folie">
                        Cotura
                      </th>
                      <th>Bepflanzung</th>
                      <th>Pflanzen</th>
                      {canEdit && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {gewaehltTunnel.map((t, index) => {
                      const bList = bepflanzung[t.id] ?? [];
                      return (
                        <tr
                          key={t.id}
                          draggable={canEdit}
                          onDragStart={(e) => {
                            setZiehtIndex(index);
                            // Ohne gesetzte Daten startet Firefox den
                            // Ziehvorgang gar nicht erst.
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", String(t.id));
                          }}
                          onDragEnd={() => setZiehtIndex(null)}
                          // Ohne preventDefault lehnt der Browser das
                          // Fallenlassen ab.
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={() => {
                            if (ziehtIndex === null || ziehtIndex === index) {
                              return;
                            }
                            reihenfolgeSpeichern(
                              verschiebeInListe(
                                gewaehltTunnel,
                                ziehtIndex,
                                index
                              )
                            );
                            setZiehtIndex(null);
                          }}
                          className={
                            ziehtIndex === index ? "opacity-40" : undefined
                          }
                        >
                          {canEdit && (
                            <td className="whitespace-nowrap">
                              <span
                                className="cursor-grab text-neutral-400"
                                title="Zum Umsortieren ziehen"
                              >
                                ⠿
                              </span>
                              <button
                                type="button"
                                className="px-1 text-neutral-500 hover:text-emerald-700 disabled:opacity-30"
                                disabled={index === 0}
                                title="Nach oben"
                                onClick={() =>
                                  tunnelVerschiebenUm(
                                    gewaehlt.anbau_id,
                                    index,
                                    -1
                                  )
                                }
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                className="px-1 text-neutral-500 hover:text-emerald-700 disabled:opacity-30"
                                disabled={index === gewaehltTunnel.length - 1}
                                title="Nach unten"
                                onClick={() =>
                                  tunnelVerschiebenUm(
                                    gewaehlt.anbau_id,
                                    index,
                                    1
                                  )
                                }
                              >
                                ▼
                              </button>
                            </td>
                          )}
                          <td className="font-medium">
                            {t.nummer}
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={t.laenge_m ?? ""}
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) =>
                                tunnelAendern(
                                  t.id,
                                  "laenge_m",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              defaultValue={t.reihen_anzahl ?? ""}
                              disabled={!canEdit}
                              className="w-16"
                              onBlur={(e) =>
                                tunnelAendern(
                                  t.id,
                                  "reihen_anzahl",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              defaultValue={
                                t.pflanzen_pro_lfm ?? ""
                              }
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) =>
                                tunnelAendern(
                                  t.id,
                                  "pflanzen_pro_lfm",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              defaultValue={t.cotura_nr ?? ""}
                              disabled={!canEdit}
                              className="w-20"
                              onBlur={(e) =>
                                tunnelAendern(
                                  t.id,
                                  "cotura_nr",
                                  e.target.value
                                )
                              }
                            />
                          </td>
                          <td className="text-xs">
                            <div className="flex flex-col gap-1">
                              {bList.map((b) => (
                                <div
                                  key={b.id}
                                  className="flex flex-wrap items-center gap-1"
                                >
                                  <input
                                    defaultValue={b.sorte}
                                    disabled={!canEdit}
                                    className="w-28"
                                    onBlur={(e) =>
                                      bepflanzungAendern(
                                        b.id,
                                        "sorte",
                                        e.target.value
                                      )
                                    }
                                  />
                                  <input
                                    type="number"
                                    defaultValue={
                                      b.reihen_anzahl ?? ""
                                    }
                                    disabled={!canEdit}
                                    className="w-14"
                                    placeholder="alle"
                                    title="Wie viele Reihen des Tunnels diese Sorte belegt. Leer = alle Reihen."
                                    onBlur={(e) =>
                                      bepflanzungAendern(
                                        b.id,
                                        "reihen_anzahl",
                                        e.target.value
                                      )
                                    }
                                  />
                                  <span className="text-neutral-500">
                                    R.
                                    {b.standjahr &&
                                      ` · ${b.standjahr}. Stj.`}
                                    {b.pflanztyp &&
                                      ` · ${PFLANZTYP_LABELS[b.pflanztyp]}`}
                                  </span>
                                  {canEdit && (
                                    <button
                                      type="button"
                                      className="text-neutral-400 hover:text-red-600"
                                      title="Entfernen"
                                      onClick={() =>
                                        bepflanzungLoeschen(b.id)
                                      }
                                    >
                                      ✕
                                    </button>
                                  )}
                                </div>
                              ))}

                              {/* Reihen-Kontrolle: zwei Sorten
                                  dürfen zusammen nicht mehr
                                  Reihen belegen als der Tunnel
                                  hat - sonst wäre die
                                  Pflanzenzahl zu hoch. */}
                              {t.reihen_anzahl != null &&
                                belegteReihen(t) >
                                  t.reihen_anzahl && (
                                  <span className="font-medium text-red-600">
                                    ⚠ {belegteReihen(t)} von{" "}
                                    {t.reihen_anzahl} Reihen
                                    belegt
                                  </span>
                                )}

                              {canEdit &&
                                (sortenFormularTunnel === t.id ? (
                                  <div className="flex flex-wrap items-center gap-1 rounded border border-emerald-300 bg-emerald-50 p-1">
                                    <input
                                      placeholder="Sorte"
                                      value={nsSorte}
                                      onChange={(e) =>
                                        setNsSorte(e.target.value)
                                      }
                                      className="w-28"
                                      autoFocus
                                    />
                                    <input
                                      type="number"
                                      placeholder="Reihen"
                                      value={nsReihen}
                                      onChange={(e) =>
                                        setNsReihen(
                                          e.target.value
                                        )
                                      }
                                      className="w-16"
                                      title="Wie viele Reihen diese Sorte belegt - vorgeschlagen sind die noch freien"
                                    />
                                    <input
                                      type="number"
                                      placeholder="Stj."
                                      value={nsStandjahr}
                                      onChange={(e) =>
                                        setNsStandjahr(
                                          e.target.value
                                        )
                                      }
                                      className="w-14"
                                    />
                                    <select
                                      value={nsPflanztyp}
                                      onChange={(e) =>
                                        setNsPflanztyp(
                                          e.target
                                            .value as Pflanztyp | ""
                                        )
                                      }
                                    >
                                      <option value="">
                                        Typ …
                                      </option>
                                      {PFLANZTYPEN.map((pt) => (
                                        <option
                                          key={pt}
                                          value={pt}
                                        >
                                          {PFLANZTYP_LABELS[pt]}
                                        </option>
                                      ))}
                                    </select>
                                    <input
                                      type="date"
                                      value={nsPflanzdatum}
                                      onChange={(e) =>
                                        setNsPflanzdatum(
                                          e.target.value
                                        )
                                      }
                                      title="Pflanzdatum"
                                    />
                                    <button
                                      type="button"
                                      className="btn text-xs"
                                      disabled={laeuft}
                                      onClick={() =>
                                        bepflanzungAnlegen(t)
                                      }
                                    >
                                      Speichern
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-secondary text-xs"
                                      onClick={() =>
                                        setSortenFormularTunnel(
                                          null
                                        )
                                      }
                                    >
                                      Abbrechen
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="self-start text-emerald-700 underline"
                                    onClick={() =>
                                      sortenFormularOeffnen(t)
                                    }
                                  >
                                    + Sorte
                                  </button>
                                ))}
                            </div>
                          </td>
                          <td>
                            {formatZahlDE(
                              bList.reduce(
                                (s, b) => s + b.anzahl_pflanzen,
                                0
                              )
                            )}
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                className="btn-danger text-xs"
                                onClick={() =>
                                  tunnelLoeschen(t.id)
                                }
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
            {nochNichtGeplant.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn-secondary text-xs"
                disabled={laeuft}
                onClick={() => anbauAnlegen(p.id)}
              >
                + {p.name}
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
