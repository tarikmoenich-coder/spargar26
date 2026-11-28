// Wetter & Frost (docs/wetter-konzept.md): gemeinsame Typen und Auswertung
// für /wetter und die Startseiten-Kachel. Quelle: DWD MOSMIX (wetter-poller).

import { getSupabaseClient } from "@/lib/supabase/client";

export type WetterStation = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  hoehe_m: number | null;
  ausgabe: string | null;
  geladen_am: string | null;
};

export type WetterStunde = {
  station_id: string;
  zeit: string;
  t2m: number | null;
  t5cm: number | null;
  td: number | null;
  regen_mm: number | null;
  regen_wahrsch: number | null;
  sonne_min: number | null;
  wolken_proz: number | null;
  wind_ms: number | null;
};

export type FeldWetter = {
  feld_id: number;
  bezeichnung: string;
  kultur: string | null;
  station_id: string | null;
  station_name: string | null;
  entfernung_km: number | null;
};

export type FrostStunde = {
  feld_id: number;
  bezeichnung: string;
  kultur: "erdbeeren" | "gruenspargel";
  zeit: string;
  t5cm: number;
  td: number | null;
  stufe: "kritisch" | "vorwarnung";
  grund: string;
};

// Eine Frostwarnung je Feld und Nacht (zusammenhängende Warnstunden).
export type FrostNacht = {
  feld_id: number;
  bezeichnung: string;
  kultur: "erdbeeren" | "gruenspargel";
  von: string;
  bis: string;
  tiefst: number;
  stufe: "kritisch" | "vorwarnung";
  gruende: string[];
};

export type WetterTag = {
  datum: string; // YYYY-MM-DD (Ortszeit)
  tmin: number | null;
  tmax: number | null;
  t5min: number | null;
  regen: number;
  sonne_h: number;
  regen_wahrsch_max: number | null;
  stunden: number;
};

export type Umschwung = {
  datum: string;
  art: "sturz" | "waerme" | "starkregen" | "hitze" | "regen_samstag" | "frost";
  text: string;
};

export const KULTUR_TEXT: Record<string, string> = { erdbeeren: "Erdbeeren (Blüte)", gruenspargel: "Grünspargel" };

export function ortsDatum(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}
export function ortsStunde(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
}

// Warnstunden je Feld zu Nächten bündeln: Lücke > 3 h = neue Warnung.
export function frostNaechte(stunden: FrostStunde[]): FrostNacht[] {
  const nachFeld = new Map<number, FrostStunde[]>();
  for (const s of [...stunden].sort((a, b) => a.zeit.localeCompare(b.zeit))) {
    nachFeld.set(s.feld_id, [...(nachFeld.get(s.feld_id) ?? []), s]);
  }
  const ergebnis: FrostNacht[] = [];
  for (const liste of nachFeld.values()) {
    let akt: FrostNacht | null = null;
    for (const s of liste) {
      if (akt && new Date(s.zeit).getTime() - new Date(akt.bis).getTime() <= 3 * 3600e3) {
        akt.bis = s.zeit;
        akt.tiefst = Math.min(akt.tiefst, Number(s.t5cm));
        if (s.stufe === "kritisch") akt.stufe = "kritisch";
        if (!akt.gruende.includes(s.grund)) akt.gruende.push(s.grund);
      } else {
        akt = {
          feld_id: s.feld_id,
          bezeichnung: s.bezeichnung,
          kultur: s.kultur,
          von: s.zeit,
          bis: s.zeit,
          tiefst: Number(s.t5cm),
          stufe: s.stufe,
          gruende: [s.grund],
        };
        ergebnis.push(akt);
      }
    }
  }
  return ergebnis.sort((a, b) => (a.stufe === b.stufe ? a.von.localeCompare(b.von) : a.stufe === "kritisch" ? -1 : 1));
}

export function tageswerte(stunden: WetterStunde[]): WetterTag[] {
  const m = new Map<string, WetterStunde[]>();
  // DWD-Zeitschritt = Ende der Stunde -> eine Minute zurück für die Tageszuordnung
  for (const s of stunden) {
    const d = ortsDatum(new Date(new Date(s.zeit).getTime() - 60e3).toISOString());
    m.set(d, [...(m.get(d) ?? []), s]);
  }
  const min = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null).map(Number);
    return v.length ? Math.min(...v) : null;
  };
  const max = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null).map(Number);
    return v.length ? Math.max(...v) : null;
  };
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datum, l]) => ({
      datum,
      tmin: min(l.map((x) => x.t2m)),
      tmax: max(l.map((x) => x.t2m)),
      t5min: min(l.map((x) => x.t5cm)),
      regen: l.reduce((s, x) => s + Number(x.regen_mm ?? 0), 0),
      sonne_h: l.reduce((s, x) => s + Number(x.sonne_min ?? 0), 0) / 60,
      regen_wahrsch_max: max(l.map((x) => x.regen_wahrsch)),
      stunden: l.length,
    }));
}

// Umschwünge, die Ernte und Vertrieb betreffen (Schwellen siehe Konzept).
// Nur vollständige Tage (>= 20 Stunden), damit der angebrochene heutige Tag
// keinen falschen "Sturz" erzeugt.
export function umschwuenge(tage: WetterTag[]): Umschwung[] {
  const voll = tage.filter((t) => t.stunden >= 20);
  const r: Umschwung[] = [];
  const wt = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  voll.forEach((t, i) => {
    const vor = voll[i - 1];
    if (vor && t.tmax !== null && vor.tmax !== null) {
      const diff = t.tmax - vor.tmax;
      if (diff <= -7) r.push({ datum: t.datum, art: "sturz", text: `Temperatursturz: ${fmtGrad(vor.tmax)} → ${fmtGrad(t.tmax)}` });
      if (diff >= 7) r.push({ datum: t.datum, art: "waerme", text: `Wärmeschub: ${fmtGrad(vor.tmax)} → ${fmtGrad(t.tmax)}` });
    }
    if (t.regen >= 10) r.push({ datum: t.datum, art: "starkregen", text: `Viel Regen: ${fmtMm(t.regen)}` });
    if (t.tmax !== null && t.tmax >= 30) r.push({ datum: t.datum, art: "hitze", text: `Hitze: bis ${fmtGrad(t.tmax)}` });
    if (wt(t.datum) === 6 && t.regen >= 2) r.push({ datum: t.datum, art: "regen_samstag", text: `Regen am Samstag (Verkauf): ${fmtMm(t.regen)}` });
    // Bodenfrost nur beim Wechsel melden (frostfrei -> Frost), sonst steht
    // im Winter an jedem Tag derselbe Hinweis.
    if (t.t5min !== null && t.t5min <= 0 && (!vor || vor.t5min === null || vor.t5min > 0))
      r.push({ datum: t.datum, art: "frost", text: `Bodenfrost kommt: bis ${fmtGrad(t.t5min)} in 5 cm` });
  });
  return r;
}

export function fmtGrad(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return `${Number(v).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 0 })} °C`;
}
export function fmtMm(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return `${Number(v).toLocaleString("de-DE", { maximumFractionDigits: 1 })} l/m²`;
}

// Hauptort = Vorhersagepunkt mit den meisten Feldern.
export function hauptStation(felder: FeldWetter[], stationen: WetterStation[]): string | null {
  const zaehl = new Map<string, number>();
  for (const f of felder) if (f.station_id) zaehl.set(f.station_id, (zaehl.get(f.station_id) ?? 0) + 1);
  const best = [...zaehl.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? stationen[0]?.id ?? null;
}

// Für Startseite und Seite: alles Nötige in einem Rutsch.
export async function wetterLaden(stationId?: string | null) {
  const sb = getSupabaseClient();
  const [st, fe, fr] = await Promise.all([
    sb.from("wetter_station").select("*").order("name"),
    sb.from("feld_wetter").select("feld_id, bezeichnung, kultur, station_id, station_name, entfernung_km").order("bezeichnung"),
    sb.from("wetter_frost").select("feld_id, bezeichnung, kultur, zeit, t5cm, td, stufe, grund").order("zeit"),
  ]);
  const stationen = (st.data as WetterStation[]) ?? [];
  const felder = (fe.data as FeldWetter[]) ?? [];
  const sid = stationId ?? hauptStation(felder, stationen);
  let stunden: WetterStunde[] = [];
  let fehler = st.error?.message ?? fe.error?.message ?? fr.error?.message ?? null;
  if (sid) {
    const { data, error } = await sb
      .from("wetter_stunde")
      .select("*")
      .eq("station_id", sid)
      .gt("zeit", new Date().toISOString())
      .order("zeit")
      .limit(260);
    stunden = (data as WetterStunde[]) ?? [];
    fehler = fehler ?? error?.message ?? null;
  }
  return {
    stationen,
    felder,
    frost: frostNaechte((fr.data as FrostStunde[]) ?? []),
    stationId: sid,
    stunden,
    fehler,
  };
}

// Daten älter als 12 h -> Poller läuft vermutlich nicht.
export function veraltet(station: WetterStation | undefined): boolean {
  if (!station?.ausgabe) return true;
  return Date.now() - new Date(station.ausgabe).getTime() > 12 * 3600e3;
}
