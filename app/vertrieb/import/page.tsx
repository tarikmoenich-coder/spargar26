"use client";

// Vertrieb → Stände → Import (Vertriebsplanung V1, Nutzer-Vorgabe
// 2026-11-25: "Die würde ich nicht alle mit Adressen von Hand einpflegen").
// Liest den Export aus dem Google-Unternehmensprofil (eine Zeile je Stand mit
// Adresse und Öffnungszeiten je Wochentag), sucht die Koordinaten bei
// OpenStreetMap und legt Stände + Öffnungszeiten an. Wiederholbar: Stände mit
// gleichem Namen werden aktualisiert statt doppelt angelegt. Logik in
// lib/staendeImport.ts. Rechte wie die Stände-Maske (vt_darf(true): admin/hr
// mit Bereich Vertrieb, Durchsetzung in der Datenbank).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { ladeAlleMitFehler } from "@/lib/ladeAlle";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";
import PageHeader from "@/components/PageHeader";
import VertriebTabs from "@/components/VertriebTabs";
import type { VtStand, VtStandZeit } from "@/lib/types";
import { WOCHENTAGE, zeitKurz } from "@/lib/vertrieb";
import {
  HALBTAG_GRENZE,
  standSuchen,
  staendeLesen,
  staendeZusammenfuehren,
  warten,
  type GeoTreffer,
  type StandImport,
} from "@/lib/staendeImport";
import { liste2026Anwenden } from "@/lib/staendeListe2026";

type GeoStatus = GeoTreffer | "nicht_gefunden" | "fehler";

interface PlanZeile {
  imp: StandImport;
  nummer: number;
  bestand: VtStand | null;
  nummerKonflikt: VtStand | null;
}

function nameSchluessel(n: string) {
  return n.trim().toLocaleLowerCase("de");
}

export default function StaendeImportPage() {
  const { profile } = useProfile();
  const darfPflegen = hatRolle(profile, "admin", "hr");

  const [bestand, setBestand] = useState<VtStand[]>([]);
  const [bestandZeiten, setBestandZeiten] = useState<VtStandZeit[]>([]);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);

  const [dateiNamen, setDateiNamen] = useState<string[]>([]);
  const [eingelesen, setEingelesen] = useState<StandImport[]>([]);
  // Ständeliste 2026: eigene Namen, nicht gelistete inaktiv, Stände ohne
  // Google-Profil ergänzen (lib/staendeListe2026.ts)
  const [liste2026, setListe2026] = useState(true);
  const staende = useMemo(
    () => (liste2026 ? liste2026Anwenden(eingelesen) : eingelesen),
    [eingelesen, liste2026]
  );
  const [leseFehler, setLeseFehler] = useState<string | null>(null);
  const [startNummer, setStartNummer] = useState("1");
  const [nummernNeu, setNummernNeu] = useState(false);

  const [geo, setGeo] = useState<Record<string, GeoStatus>>({});
  const [sucheLaeuft, setSucheLaeuft] = useState(false);
  const abbrechen = useRef(false);

  const [uebernimmt, setUebernimmt] = useState(false);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const ladeBestand = useCallback(async () => {
    const sb = getSupabaseClient();
    const [s, z] = await Promise.all([
      sb.from("vt_stand").select("*").order("nummer"),
      ladeAlleMitFehler<VtStandZeit>((von, bis) =>
        sb.from("vt_stand_zeit").select("*").order("id").range(von, bis)
      ),
    ]);
    const err = s.error ?? z.error;
    setLadeFehler(err ? err.message : null);
    setBestand((s.data as VtStand[]) ?? []);
    setBestandZeiten(z.data);
  }, []);

  useEffect(() => {
    ladeBestand();
  }, [ladeBestand]);

  // Mehrere Dateien auf einmal (ein Export je Google-Konto) - nur so laufen
  // die Nummern alphabetisch über alle Stände.
  async function dateienGewaehlt(liste: FileList | null) {
    setLeseFehler(null);
    setErgebnis(null);
    setFehler(null);
    setEingelesen([]);
    setGeo({});
    const dateien = liste ? Array.from(liste) : [];
    setDateiNamen(dateien.map((d) => d.name));
    if (!dateien.length) return;
    try {
      const listen: StandImport[][] = [];
      for (const datei of dateien) {
        try {
          const wb = XLSX.read(await datei.arrayBuffer(), { type: "array" });
          const blatt = wb.Sheets[wb.SheetNames[0]];
          const zeilen = XLSX.utils.sheet_to_json<unknown[]>(blatt, { header: 1, defval: null });
          listen.push(staendeLesen(zeilen, datei.name));
        } catch (e) {
          throw new Error(`${datei.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setEingelesen(staendeZusammenfuehren(listen));
    } catch (e) {
      setLeseFehler(e instanceof Error ? e.message : String(e));
    }
  }

  const bestandNachName = useMemo(
    () => new Map(bestand.map((s) => [nameSchluessel(s.name), s])),
    [bestand]
  );

  // Nummern: alphabetisch nach Ort fortlaufend ab Startnummer. Vorhandene
  // Stände behalten ihre Nummer, außer "Nummern neu vergeben" ist gesetzt.
  const plan: PlanZeile[] = useMemo(() => {
    const start = Math.max(1, Math.floor(Number(startNummer) || 1));
    const imNamen = new Set(staende.map((s) => nameSchluessel(s.name)));
    const fremdeNummern = new Map(
      bestand.filter((b) => !imNamen.has(nameSchluessel(b.name))).map((b) => [b.nummer, b])
    );
    return staende.map((imp, i) => {
      const b = bestandNachName.get(nameSchluessel(imp.name)) ?? null;
      const nummer = b && !nummernNeu ? b.nummer : start + i;
      return { imp, nummer, bestand: b, nummerKonflikt: fremdeNummern.get(nummer) ?? null };
    });
  }, [staende, bestand, bestandNachName, startNummer, nummernNeu]);

  const nichtInDatei = useMemo(() => {
    const imNamen = new Set(staende.map((s) => nameSchluessel(s.name)));
    return bestand.filter((b) => !imNamen.has(nameSchluessel(b.name)));
  }, [staende, bestand]);

  const doppelteNamen = useMemo(() => {
    const z = new Map<string, number>();
    staende.forEach((s) => z.set(nameSchluessel(s.name), (z.get(nameSchluessel(s.name)) ?? 0) + 1));
    return staende.filter((s) => (z.get(nameSchluessel(s.name)) ?? 0) > 1).map((s) => s.name);
  }, [staende]);

  const konflikte = plan.filter((p) => p.nummerKonflikt);
  const neu = plan.filter((p) => !p.bestand).length;

  // Wer braucht Koordinaten? Neue Stände und vorhandene ohne Koordinaten.
  const brauchtGeo = (p: PlanZeile) => !!p.imp.adresse && (!p.bestand || p.bestand.lat === null);
  const offenGeo = plan.filter((p) => brauchtGeo(p) && geo[p.imp.name] === undefined);
  const geoGefunden = plan.filter((p) => {
    const g = geo[p.imp.name];
    return typeof g === "object" && g.genauigkeit === "strasse";
  }).length;

  async function koordinatenSuchen() {
    abbrechen.current = false;
    setSucheLaeuft(true);
    setFehler(null);
    for (const p of offenGeo) {
      if (abbrechen.current) break;
      let status: GeoStatus;
      try {
        status = (await standSuchen(p.imp)) ?? "nicht_gefunden";
      } catch (e) {
        status = "fehler";
        setFehler(`Koordinaten-Suche: ${e instanceof Error ? e.message : String(e)}`);
      }
      setGeo((alt) => ({ ...alt, [p.imp.name]: status }));
      if (status === "fehler") break;
      // Nutzungsregel OpenStreetMap: höchstens eine Anfrage je Sekunde
      await warten(1100);
    }
    setSucheLaeuft(false);
  }

  async function uebernehmen() {
    if (konflikte.length || doppelteNamen.length) return;
    setUebernimmt(true);
    setFehler(null);
    setErgebnis(null);
    const sb = getSupabaseClient();
    try {
      // 1) Bei "Nummern neu vergeben": vorhandene erst auf Zwischennummern,
      //    damit sich die neuen Nummern nicht gegenseitig blockieren.
      const umnummerieren = plan.filter((p) => p.bestand && p.bestand.nummer !== p.nummer);
      for (const p of umnummerieren) {
        const { error } = await sb
          .from("vt_stand")
          .update({ nummer: 100000 + p.bestand!.id })
          .eq("id", p.bestand!.id);
        if (error) throw new Error(`${p.imp.name}: ${error.message}`);
      }

      // 2) Stände anlegen bzw. aktualisieren
      const ids = new Map<string, number>();
      let angelegt = 0;
      let aktualisiert = 0;
      for (const p of plan) {
        const g = geo[p.imp.name];
        const koord =
          typeof g === "object" && g.genauigkeit === "strasse" ? { lat: g.lat, lng: g.lng } : null;
        if (p.bestand) {
          const patch: Partial<VtStand> = { nummer: p.nummer, aktiv: p.imp.aktiv };
          if (p.imp.adresse) patch.adresse = p.imp.adresse;
          if (koord && p.bestand.lat === null) Object.assign(patch, koord);
          if (!p.bestand.notiz && p.imp.notiz) patch.notiz = p.imp.notiz;
          const { error } = await sb.from("vt_stand").update(patch).eq("id", p.bestand.id);
          if (error) throw new Error(`${p.imp.name}: ${error.message}`);
          ids.set(p.imp.name, p.bestand.id);
          aktualisiert++;
        } else {
          const { data, error } = await sb
            .from("vt_stand")
            .insert({
              nummer: p.nummer,
              name: p.imp.name,
              adresse: p.imp.adresse || null,
              notiz: p.imp.notiz || null,
              aktiv: p.imp.aktiv,
              ...(koord ?? {}),
            })
            .select("id")
            .single();
          if (error) throw new Error(`${p.imp.name}: ${error.message}`);
          ids.set(p.imp.name, (data as { id: number }).id);
          angelegt++;
        }
      }

      // 3) Öffnungszeiten: je Stand genau die Halbtage aus der Datei. Stände
      //    ohne Angaben in der Datei behalten ihre bisherigen Zeiten.
      const zeilen = plan
        .filter((p) => !p.imp.ohneZeiten)
        .flatMap((p) =>
          p.imp.zeiten.map((z) => ({ stand_id: ids.get(p.imp.name)!, ...z }))
        );
      for (let i = 0; i < zeilen.length; i += 500) {
        const { error } = await sb
          .from("vt_stand_zeit")
          .upsert(zeilen.slice(i, i + 500), { onConflict: "stand_id,wochentag,halbtag" });
        if (error) throw new Error(`Öffnungszeiten: ${error.message}`);
      }
      const soll = new Set(zeilen.map((z) => `${z.stand_id}|${z.wochentag}|${z.halbtag}`));
      const betroffen = new Set(
        plan.filter((p) => !p.imp.ohneZeiten).map((p) => ids.get(p.imp.name)!)
      );
      const weg = bestandZeiten
        .filter((z) => betroffen.has(z.stand_id) && !soll.has(`${z.stand_id}|${z.wochentag}|${z.halbtag}`))
        .map((z) => z.id);
      for (let i = 0; i < weg.length; i += 200) {
        const { error } = await sb.from("vt_stand_zeit").delete().in("id", weg.slice(i, i + 200));
        if (error) throw new Error(`Öffnungszeiten entfernen: ${error.message}`);
      }

      setErgebnis(
        `Fertig: ${angelegt} Stände angelegt, ${aktualisiert} aktualisiert, ${zeilen.length} Öffnungs-Halbtage gesetzt` +
          (weg.length ? `, ${weg.length} nicht mehr geöffnete Halbtage entfernt` : "") +
          "."
      );
      setEingelesen([]);
      setGeo({});
      setDateiNamen([]);
      await ladeBestand();
    } catch (e) {
      setFehler(
        `Abgebrochen: ${e instanceof Error ? e.message : String(e)}. Bereits übernommene Stände bleiben erhalten - ein erneuter Import ergänzt den Rest.`
      );
      await ladeBestand();
    }
    setUebernimmt(false);
  }

  function zeitenText(imp: StandImport) {
    if (imp.ohneZeiten) return <span className="text-amber-700">keine Angaben</span>;
    return WOCHENTAGE.map((t) => {
      const vm = imp.zeiten.find((z) => z.wochentag === t.nr && z.halbtag === "VM");
      const nm = imp.zeiten.find((z) => z.wochentag === t.nr && z.halbtag === "NM");
      if (!vm && !nm) return null;
      const von = (vm ?? nm)!.von;
      const bis = (nm ?? vm)!.bis;
      return (
        <span key={t.nr} className="mr-2 whitespace-nowrap">
          {t.kurz} {zeitKurz(von)}–{zeitKurz(bis)}
          {!nm && <span className="text-neutral-500"> (VM)</span>}
          {!vm && <span className="text-neutral-500"> (NM)</span>}
        </span>
      );
    });
  }

  function geoText(p: PlanZeile) {
    if (!brauchtGeo(p)) return <span className="text-neutral-500">vorhanden</span>;
    const g = geo[p.imp.name];
    if (g === undefined) return <span className="text-neutral-400">—</span>;
    if (g === "nicht_gefunden") return <span className="text-amber-700">nicht gefunden</span>;
    if (g === "fehler") return <span className="text-beere-600">Fehler</span>;
    if (g.genauigkeit === "ort")
      return (
        <span className="text-amber-700" title={g.anzeige}>
          nur Ort - bitte von Hand
        </span>
      );
    return (
      <a
        className="text-emerald-700 underline"
        href={`https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lng}#map=18/${g.lat}/${g.lng}`}
        target="_blank"
        rel="noreferrer"
        title={g.anzeige}
      >
        {g.lat.toFixed(5)}, {g.lng.toFixed(5)}
      </a>
    );
  }

  if (profile && !darfPflegen) {
    return (
      <div className="flex flex-col gap-6">
        <VertriebTabs />
        <p className="text-sm text-neutral-600">
          Den Import dürfen nur Administrator und Personal (HR) mit Bereich Vertrieb durchführen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VertriebTabs />
      <PageHeader
        icon={Upload}
        titel="Stände importieren"
        beschreibung={`Export aus dem Google-Unternehmensprofil (.xlsx oder .csv) einlesen: je Stand Adresse und Öffnungszeiten. Die Öffnungszeiten werden um ${HALBTAG_GRENZE} Uhr in Vormittag und Nachmittag geteilt, die Standnummern alphabetisch nach Ort vergeben. Stände mit gleichem Namen werden aktualisiert, nicht doppelt angelegt.`}
        aktionen={
          <Link href="/vertrieb" className="btn-secondary">
            ← Stände
          </Link>
        }
      />

      {ladeFehler && <p className="text-sm text-beere-600">Bestand konnte nicht geladen werden: {ladeFehler}</p>}
      {ergebnis && <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">{ergebnis}</p>}
      {fehler && <p className="text-sm text-beere-600">{fehler}</p>}

      <div className="card flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span>Dateien</span>
          <input
            id="staende-datei"
            type="file"
            multiple
            accept=".xlsx,.xls,.csv"
            onChange={(e) => dateienGewaehlt(e.target.files)}
          />
        </label>
        {dateiNamen.length > 0 && (
          <span className="text-sm text-neutral-600">{dateiNamen.join(", ")}</span>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={liste2026} onChange={(e) => setListe2026(e.target.checked)} />
          Ständeliste 2026 anwenden (eigene Namen, nicht gelistete inaktiv, Stände ohne Google-Profil ergänzen)
        </label>
        <span className="w-full text-xs text-neutral-500">
          Alle Exporte (je Google-Konto einer) zusammen auswählen, damit die Nummern über alle
          Stände alphabetisch durchlaufen.
        </span>
      </div>
      {leseFehler && <p className="text-sm text-beere-600">{leseFehler}</p>}

      {staende.length > 0 && (
        <>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="badge">{staende.length} Stände {dateiNamen.length > 1 ? `aus ${dateiNamen.length} Dateien` : "in der Datei"}</span>
            <span className="badge">{neu} neu</span>
            <span className="badge">{staende.filter((s) => s.aktiv).length} aktiv</span>
            <span className="badge">{staende.filter((s) => !s.aktiv).length} inaktiv</span>
            <span className="badge">{staende.length - neu} schon vorhanden (werden aktualisiert)</span>
            <span className="badge">
              Koordinaten: {geoGefunden} gefunden, {offenGeo.length} noch nicht gesucht
            </span>
          </div>

          <div className="card flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                Nummern ab
                <input
                  id="start-nummer"
                  type="number"
                  min={1}
                  className="w-20"
                  value={startNummer}
                  onChange={(e) => setStartNummer(e.target.value)}
                />
              </label>
              {staende.length - neu > 0 && (
                <label className="flex items-center gap-2">
                  <input
                    id="nummern-neu"
                    type="checkbox"
                    checked={nummernNeu}
                    onChange={(e) => setNummernNeu(e.target.checked)}
                  />
                  auch vorhandene Stände neu durchnummerieren
                </label>
              )}
            </div>
            {nichtInDatei.length > 0 && (
              <p className="text-neutral-600">
                Schon angelegt, aber nicht in der Datei (bleiben unverändert):{" "}
                {nichtInDatei.map((b) => `${b.nummer} ${b.name}`).join(", ")}
              </p>
            )}
            {konflikte.length > 0 && (
              <p className="text-beere-600">
                Nummer schon vergeben an einen Stand, der nicht in der Datei ist:{" "}
                {konflikte
                  .map((k) => `${k.nummer} (${k.imp.name} ↔ ${k.nummerKonflikt!.name})`)
                  .join(", ")}
                . Bitte eine andere Startnummer wählen oder den alten Stand unter „Stände“
                umnummerieren bzw. löschen.
              </p>
            )}
            {doppelteNamen.length > 0 && (
              <p className="text-beere-600">
                Name kommt mehrfach in der Datei vor: {[...new Set(doppelteNamen)].join(", ")}. Bitte in
                der Datei eindeutig machen.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {!sucheLaeuft ? (
                <button className="btn-secondary" onClick={koordinatenSuchen} disabled={offenGeo.length === 0}>
                  Koordinaten bei OpenStreetMap suchen ({offenGeo.length})
                </button>
              ) : (
                <button className="btn-secondary" onClick={() => (abbrechen.current = true)}>
                  Suche anhalten
                </button>
              )}
              <span className="text-neutral-500">
                ca. 1 Sekunde je Stand. Übernommen werden nur straßengenaue Treffer; der Rest lässt sich
                später in der Stände-Maske eintragen (Koordinaten aus Google Maps einfügen).
              </span>
            </div>
            <div>
              <button
                className="btn"
                onClick={uebernehmen}
                disabled={uebernimmt || sucheLaeuft || konflikte.length > 0 || doppelteNamen.length > 0}
              >
                {uebernimmt ? "Übernimmt…" : `${staende.length} Stände übernehmen`}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Name</th>
                  <th>Adresse</th>
                  <th>Öffnungszeiten</th>
                  <th>Koordinaten</th>
                  <th>Notiz</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr key={`${p.imp.datei}:${p.imp.zeile}`} className={p.nummerKonflikt ? "bg-beere-50" : undefined}>
                    <td className="font-medium tabular-nums">
                      {p.nummer}
                      {p.bestand && p.bestand.nummer !== p.nummer && (
                        <span className="text-neutral-500"> (bisher {p.bestand.nummer})</span>
                      )}
                    </td>
                    <td>
                      {p.imp.name}
                      {p.bestand ? (
                        <span className="ml-1 text-xs text-neutral-500">vorhanden</span>
                      ) : (
                        <span className="ml-1 text-xs text-emerald-700">neu</span>
                      )}
                      {!p.imp.aktiv && <span className="ml-1 badge-warn">inaktiv</span>}
                      {dateiNamen.length > 1 && (
                        <div className="text-xs text-neutral-500">{p.imp.datei}</div>
                      )}
                    </td>
                    <td>{p.imp.adresse}</td>
                    <td>
                      {zeitenText(p.imp)}
                      {p.imp.zeitFehler.length > 0 && (
                        <span className="text-beere-600"> {p.imp.zeitFehler.join("; ")}</span>
                      )}
                    </td>
                    <td>{geoText(p)}</td>
                    <td className="text-neutral-600">{p.imp.notiz}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
