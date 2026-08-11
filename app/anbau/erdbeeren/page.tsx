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
      // Nummern natürlich sortieren ("2" vor "10"), da sie Text sind.
      Object.values(tMap).forEach((liste) =>
        liste.sort((a, b) =>
          a.nummer.localeCompare(b.nummer, "de", { numeric: true })
        )
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
          darunter die Bepflanzung je Sorte (zwei Sorten in einem Tunnel sind
          zwei Zeilen). Laufende Meter und Pflanzenzahl werden gerechnet –
          Länge × Reihen × Pflanzen je laufendem Meter. Das Prämiensystem ist
          davon unberührt: die Erfassung zeigt weiterhin nur die Feldauswahl.
        </p>
      </div>

      <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex flex-wrap items-center gap-4 bg-neutral-50 py-2 text-sm">
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
                const tListe = tunnel[u.anbau_id] ?? [];
                return (
                  <Fragment key={u.anbau_id}>
                    <tr>
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
                          {offen ? "Schließen" : "Tunnel"}
                        </button>
                      </td>
                    </tr>
                    {offen && (
                      <tr>
                        <td colSpan={8} className="bg-neutral-50">
                          <div className="flex flex-col gap-4 py-3">
                            {canEdit && (
                              <div className="flex flex-col gap-3 rounded border border-neutral-200 bg-white p-3 text-xs">
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
                                    onClick={() => sammelanlage(u.anbau_id)}
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
                                    onClick={() => sorteFuerBereich(u.anbau_id)}
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
                                      .filter((z) => z.anbau_id !== u.anbau_id)
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
                                      tunnelVerschieben(u.anbau_id)
                                    }
                                  >
                                    Verschieben
                                  </button>
                                </div>
                              </div>
                            )}

                            {tListe.length === 0 ? (
                              <p className="text-sm text-neutral-500">
                                Noch keine Tunnel angelegt.
                              </p>
                            ) : (
                              <table>
                                <thead>
                                  <tr>
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
                                  {tListe.map((t) => {
                                    const bList = bepflanzung[t.id] ?? [];
                                    return (
                                      <tr key={t.id}>
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
                                          {bList.length === 0 ? (
                                            <span className="text-neutral-400">
                                              —
                                            </span>
                                          ) : (
                                            <div className="flex flex-col gap-0.5">
                                              {bList.map((b) => (
                                                <div
                                                  key={b.id}
                                                  className="flex items-center gap-1"
                                                >
                                                  <span>
                                                    {b.sorte}
                                                    {b.reihen_anzahl !==
                                                      t.reihen_anzahl &&
                                                      ` (${b.reihen_anzahl} R.)`}
                                                    {b.standjahr &&
                                                      ` · ${b.standjahr}. Standjahr`}
                                                    {b.pflanztyp &&
                                                      ` · ${PFLANZTYP_LABELS[b.pflanztyp]}`}
                                                  </span>
                                                  {canEdit && (
                                                    <button
                                                      type="button"
                                                      className="text-neutral-400 hover:text-red-600"
                                                      title="Entfernen"
                                                      onClick={() =>
                                                        bepflanzungLoeschen(
                                                          b.id
                                                        )
                                                      }
                                                    >
                                                      ✕
                                                    </button>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          )}
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && nochNichtGeplant.length > 0 && (
        <div className="rounded border border-neutral-200 bg-white p-3">
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
            Die Felder selbst werden weiterhin unter Prämien → Erdbeeren →
            „Parzellen verwalten" angelegt.
          </p>
        </div>
      )}
    </div>
  );
}
