"use client";

// Personen zusammenführen / Saisonjahre verschieben (2026-11-25). Für die
// Klärungsliste aus dem HSC-Abgleich Landwirtschaft, aber allgemein
// nutzbar: Dubletten im Personalstamm zusammenführen (der überflüssige
// Datensatz wird gelöscht - Nutzer-Entscheidung, das Änderungsprotokoll
// behält ihn) und Saisonjahre, die durch eine falsch vergebene
// Personalnummer an der falschen Person hängen, umhängen.
// Datenbank-Funktionen: migration_2026-11-25g (alles-oder-nichts, bricht bei
// echten Überschneidungen ab).

import PageHeader from "@/components/PageHeader";
import PersonalTabs from "@/components/PersonalTabs";
import { Merge } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { darf as hatRecht } from "@/lib/rollen";
import { ladeAlleSeiten } from "@/lib/ladeAlle";
import { dublettenFinden, type DublettenPerson } from "@/lib/dubletten";
import { formatDatumDE as formatDatum } from "@/lib/format";

interface Person extends DublettenPerson {
  aktiv: boolean;
  notiz: string | null;
}

interface Umfang {
  jahre: number[];
  zahlen: { label: string; n: number; jahre?: string }[];
}

// Was an einer Person hängt (nur Zählung, für die Gegenüberstellung)
const ZAEHLEN: { tabelle: string; label: string; spalte?: string; jahrAus?: "datum" | "saison_jahr" }[] = [
  { tabelle: "work_entries", label: "Stundentage", jahrAus: "datum" },
  { tabelle: "advance_recipients", label: "Vorschüsse" },
  { tabelle: "saison_abrechnungen", label: "Abrechnungen", jahrAus: "saison_jahr" },
  { tabelle: "season_bonuses", label: "Saisonwerte", jahrAus: "saison_jahr" },
  { tabelle: "stundenkonto_bewegungen", label: "Stundenkonto", jahrAus: "saison_jahr" },
  { tabelle: "employee_documents", label: "Dokumente" },
  { tabelle: "employee_beschaeftigungsabschnitte", label: "Beschäftigungszeiträume" },
  { tabelle: "unterkunft_belegung", label: "Unterkunft" },
  { tabelle: "personal_kandidaten", label: "Planung (Kandidat)", spalte: "aktivierter_employee_id" },
];

function PersonWahl({
  titel,
  personen,
  gewaehlt,
  setGewaehlt,
}: {
  titel: string;
  personen: Person[];
  gewaehlt: Person | null;
  setGewaehlt: (p: Person | null) => void;
}) {
  const [suche, setSuche] = useState("");
  const treffer = useMemo(() => {
    const s = suche.trim().toLowerCase();
    if (s.length < 2) return [];
    return personen
      .filter(
        (p) =>
          p.personal_nr.toLowerCase() === s ||
          p.personal_nr.toLowerCase().startsWith(s) ||
          `${p.name} ${p.vorname}`.toLowerCase().includes(s) ||
          `${p.vorname} ${p.name}`.toLowerCase().includes(s)
      )
      .slice(0, 12);
  }, [suche, personen]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{titel}</span>
      {gewaehlt ? (
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {gewaehlt.personal_nr} · {gewaehlt.name}, {gewaehlt.vorname}
          </span>
          <button type="button" className="text-xs text-emerald-700 underline" onClick={() => setGewaehlt(null)}>
            ändern
          </button>
        </div>
      ) : (
        <>
          <input
            placeholder="Personalnummer oder Name…"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          {treffer.map((p) => (
            <button
              key={p.id}
              type="button"
              className="text-left text-sm hover:bg-emerald-50"
              onClick={() => {
                setGewaehlt(p);
                setSuche("");
              }}
            >
              {p.personal_nr} · {p.name}, {p.vorname} {p.geburtsdatum ? `(${formatDatum(p.geburtsdatum)})` : ""}
            </button>
          ))}
        </>
      )}
    </div>
  );
}

export default function PersonalZusammenfuehrenPage() {
  const { profile } = useProfile();
  const darf = hatRecht(profile, "personal.verwaltung:S");
  const [personen, setPersonen] = useState<Person[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [modus, setModus] = useState<"zusammen" | "jahre">("zusammen");
  const [a, setA] = useState<Person | null>(null);
  const [b, setB] = useState<Person | null>(null);
  const [bleibt, setBleibt] = useState<"a" | "b">("a");
  const [umfang, setUmfang] = useState<Record<string, Umfang>>({});
  const [jahreWahl, setJahreWahl] = useState<Set<number>>(new Set());
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [nurSichere, setNurSichere] = useState(false);
  const [ausgeblendet, setAusgeblendet] = useState<Set<string>>(new Set());

  const laden = useCallback(async () => {
    setLaedt(true);
    const supabase = getSupabaseClient();
    const p = await ladeAlleSeiten<Person>((von, bis) =>
      supabase
        .from("employee_personaldaten")
        .select("id, personal_nr, name, vorname, geburtsdatum, sozialversicherungsnummer, steuer_id, bereich, vorgaenger_employee_id, aktiv, notiz")
        .order("id")
        .range(von, bis)
    );
    setPersonen(p);
    setLaedt(false);
  }, []);
  useEffect(() => {
    if (darf) laden();
  }, [darf, laden]);

  const umfangLaden = useCallback(async (p: Person) => {
    const supabase = getSupabaseClient();
    const { data: pr, error: prFehler } = await supabase
      .from("employee_saison_praesenz")
      .select("saison_jahr")
      .eq("employee_id", p.id)
      .order("saison_jahr");
    const zahlen = await Promise.all(
      ZAEHLEN.map(async (z) => {
        const spalte = z.spalte ?? "employee_id";
        if (z.jahrAus) {
          const { data, error } = await supabase.from(z.tabelle).select(z.jahrAus).eq(spalte, p.id).limit(1000);
          if (error) return { label: `${z.label} (Fehler: ${error.message})`, n: -1 };
          const zeilen = (data as Record<string, string | number>[] | null) ?? [];
          const jahre = Array.from(new Set(zeilen.map((r) => String(r[z.jahrAus!]).slice(0, 4)))).sort();
          return { label: z.label, n: zeilen.length, jahre: jahre.join(", ") };
        }
        const { count, error } = await supabase.from(z.tabelle).select("*", { count: "exact", head: true }).eq(spalte, p.id);
        if (error) return { label: `${z.label} (Fehler: ${error.message})`, n: -1 };
        return { label: z.label, n: count ?? 0 };
      })
    );
    setUmfang((alt) => ({
      ...alt,
      [p.id]: { jahre: ((pr as { saison_jahr: number }[] | null) ?? []).map((r) => r.saison_jahr), zahlen },
    }));
    if (prFehler) setMeldung({ ok: false, text: `Saisonjahre von ${p.personal_nr} nicht geladen: ${prFehler.message}` });
  }, []);
  useEffect(() => {
    if (a) umfangLaden(a);
  }, [a, umfangLaden]);
  useEffect(() => {
    if (b) umfangLaden(b);
  }, [b, umfangLaden]);
  useEffect(() => {
    setJahreWahl(new Set());
    setMeldung(null);
  }, [a, b, modus]);

  const paare = useMemo(() => dublettenFinden(personen), [personen]);
  const sichtbarePaare = paare.filter(
    (p) => (!nurSichere || p.sicher) && !ausgeblendet.has(`${p.a.id}|${p.b.id}`)
  );

  // Vorschlag, wer bleibt: ohne "-alt"/Firmenzusatz, dann mit mehr Daten
  function vorschlag(x: Person, y: Person): "a" | "b" {
    const zusatz = (p: Person) => (/-/.test(p.personal_nr) ? 1 : 0);
    if (zusatz(x) !== zusatz(y)) return zusatz(x) < zusatz(y) ? "a" : "b";
    return "a";
  }
  function paarWaehlen(x: Person, y: Person) {
    setModus("zusammen");
    setA(x);
    setB(y);
    setBleibt(vorschlag(x, y));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function zusammenfuehren() {
    if (!a || !b) return;
    const [ziel, weg] = bleibt === "a" ? [a, b] : [b, a];
    if (
      !window.confirm(
        `Alles von ${weg.personal_nr} (${weg.name}, ${weg.vorname}) auf ${ziel.personal_nr} übertragen und ${weg.personal_nr} danach LÖSCHEN?`
      )
    )
      return;
    setLaeuft(true);
    setMeldung(null);
    // Hatte der übertragene Datensatz einen Erntewirtschafts-Ausweis? Dessen
    // QR-Code enthält die alte Personalnummer -> nach dem Zusammenführen neu
    // drucken.
    const { data: wegAusweis } = await getSupabaseClient()
      .from("ernte_ausweis")
      .select("employee_id")
      .eq("employee_id", weg.id)
      .maybeSingle();
    const { data, error } = await getSupabaseClient().rpc("employees_zusammenfuehren", {
      p_bleibt: ziel.id,
      p_weg: weg.id,
    });
    if (error) {
      setMeldung({ ok: false, text: `${error.message} - es wurde nichts geändert.` });
    } else {
      const d = (data as Record<string, number | string>) ?? {};
      const teile = Object.entries(d)
        .filter(([k]) => k !== "geloescht")
        .map(([k, n]) => `${k}: ${n}`);
      setMeldung({
        ok: true,
        text:
          `Zusammengeführt in ${ziel.personal_nr}, ${weg.personal_nr} gelöscht.${teile.length ? ` Umgehängt: ${teile.join(", ")}.` : ""}` +
          (wegAusweis
            ? ` Hinweis: ${weg.personal_nr} hatte einen Erntewirtschafts-Ausweis - bitte für ${ziel.personal_nr} neu drucken (Erntewirtschaft → Ausweise), der QR-Code enthält die Personalnummer.`
            : ""),
      });
      setA(ziel);
      setB(null);
      await laden();
      umfangLaden(ziel);
    }
    setLaeuft(false);
  }

  async function jahreVerschieben() {
    if (!a || !b || jahreWahl.size === 0) return;
    const jahre = Array.from(jahreWahl).sort();
    if (!window.confirm(`Saisonjahre ${jahre.join(", ")} von ${a.personal_nr} zu ${b.personal_nr} verschieben?`)) return;
    setLaeuft(true);
    setMeldung(null);
    const { data, error } = await getSupabaseClient().rpc("employee_jahre_verschieben", {
      p_von: a.id,
      p_nach: b.id,
      p_jahre: jahre,
    });
    if (error) setMeldung({ ok: false, text: `${error.message} - es wurde nichts geändert.` });
    else {
      const d = (data as Record<string, number>) ?? {};
      setMeldung({
        ok: true,
        text: `Verschoben: ${d.saisonjahre ?? 0} Saisonjahre, ${d.zeitraeume ?? 0} Beschäftigungszeiträume.`,
      });
      setJahreWahl(new Set());
      umfangLaden(a);
      umfangLaden(b);
    }
    setLaeuft(false);
  }

  if (!darf) {
    return (
      <div className="flex flex-col gap-4">
        <PersonalTabs />
        <PageHeader icon={Merge} titel="Zusammenführen" />
        <p className="text-sm text-neutral-500">Nur Administrator und Personal (HR).</p>
      </div>
    );
  }

  const spalte = (p: Person | null, seite: "a" | "b") => {
    if (!p) return <div className="text-sm text-neutral-400">noch keine Person gewählt</div>;
    const u = umfang[p.id];
    return (
      <div className="flex flex-col gap-1 text-sm">
        {modus === "zusammen" && (
          <label className="flex items-center gap-2 font-medium">
            <input type="radio" checked={bleibt === seite} onChange={() => setBleibt(seite)} />
            {bleibt === seite ? "bleibt" : "wird übertragen und gelöscht"}
          </label>
        )}
        <div>
          <span className="font-semibold">{p.personal_nr}</span> · {p.name}, {p.vorname}
          {p.aktiv ? <span className="badge-ok ml-1">aktiv</span> : null}
        </div>
        <div className="text-neutral-600">
          Geb.: {p.geburtsdatum ? formatDatum(p.geburtsdatum) : "-"} · SV: {p.sozialversicherungsnummer ?? "-"} · Steuer-ID:{" "}
          {p.steuer_id ?? "-"}
        </div>
        {p.notiz && <div className="text-xs text-neutral-500">{p.notiz}</div>}
        {u ? (
          <>
            <div>
              Saisonjahre:{" "}
              {modus === "jahre" && seite === "a" ? (
                <span className="inline-flex flex-wrap gap-2">
                  {u.jahre.map((j) => (
                    <label key={j} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={jahreWahl.has(j)}
                        onChange={(e) =>
                          setJahreWahl((alt) => {
                            const n = new Set(alt);
                            if (e.target.checked) n.add(j);
                            else n.delete(j);
                            return n;
                          })
                        }
                      />
                      {j}
                    </label>
                  ))}
                  {u.jahre.length === 0 && "-"}
                </span>
              ) : (
                u.jahre.join(", ") || "-"
              )}
            </div>
            <ul className="text-neutral-600">
              {u.zahlen
                .filter((z) => z.n !== 0)
                .map((z) => (
                  <li key={z.label} className={z.n < 0 ? "text-beere-600" : undefined}>
                    {z.label}
                    {z.n >= 0 ? `: ${z.n}` : ""}
                    {z.jahre ? ` (${z.jahre})` : ""}
                  </li>
                ))}
              {u.zahlen.every((z) => z.n === 0) && <li>sonst keine Daten (Stunden, Vorschüsse …)</li>}
            </ul>
          </>
        ) : (
          <div className="text-neutral-400">lädt…</div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <PageHeader
        icon={Merge}
        titel="Zusammenführen"
        beschreibung="Dubletten im Personalstamm zusammenführen und falsch zugeordnete Saisonjahre umhängen. Bei echten Überschneidungen (z.B. Stunden am selben Tag) wird abgebrochen und nichts geändert."
      />

      <div className="card flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={modus === "zusammen" ? "btn" : "btn-secondary"}
            onClick={() => setModus("zusammen")}
          >
            Zusammenführen
          </button>
          <button type="button" className={modus === "jahre" ? "btn" : "btn-secondary"} onClick={() => setModus("jahre")}>
            Saisonjahre verschieben
          </button>
        </div>
        <p className="text-sm text-neutral-600">
          {modus === "zusammen"
            ? "Alles, was am übertragenen Datensatz hängt (Stunden, Vorschüsse, Abrechnungen, Dokumente, Saisonjahre, Unterkunft, Planung …), wandert zum bleibenden Datensatz. Leere Stammfelder werden ergänzt, dann wird der übertragene Datensatz gelöscht."
            : "Links die Person, an der die Jahre fälschlich hängen, rechts die Person, zu der sie gehören. Verschoben werden Saisonjahr, Firma je Saison und Beschäftigungszeiträume - nur Jahre ohne Stunden, Vorschüsse oder Abrechnungen."}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded border border-linie p-3">
            <PersonWahl
              titel={modus === "jahre" ? "Jahre hängen an" : "Person A"}
              personen={personen}
              gewaehlt={a}
              setGewaehlt={setA}
            />
            {spalte(a, "a")}
          </div>
          <div className="flex flex-col gap-2 rounded border border-linie p-3">
            <PersonWahl
              titel={modus === "jahre" ? "gehören zu" : "Person B"}
              personen={personen}
              gewaehlt={b}
              setGewaehlt={setB}
            />
            {spalte(b, "b")}
          </div>
        </div>
        {a && b && a.bereich !== b.bereich && (
          <p className="text-sm text-beere-600">Die beiden Personen gehören zu verschiedenen Bereichen.</p>
        )}
        {a && b && a.id !== b.id && a.bereich === b.bereich && (
          <div>
            {modus === "zusammen" ? (
              <button type="button" className="btn" disabled={laeuft} onClick={zusammenfuehren}>
                {(bleibt === "a" ? b : a).personal_nr} in {(bleibt === "a" ? a : b).personal_nr} zusammenführen
              </button>
            ) : (
              <button type="button" className="btn" disabled={laeuft || jahreWahl.size === 0} onClick={jahreVerschieben}>
                {jahreWahl.size ? `${jahreWahl.size} Saisonjahr(e) verschieben` : "Jahre links anhaken"}
              </button>
            )}
          </div>
        )}
        {meldung && <p className={`text-sm ${meldung.ok ? "text-emerald-800" : "text-beere-600"}`}>{meldung.text}</p>}
      </div>

      <div className="card flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-emerald-800">
            Mögliche Dubletten {laedt ? "(lädt…)" : `(${sichtbarePaare.length})`}
          </h2>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={nurSichere} onChange={(e) => setNurSichere(e.target.checked)} />
            nur sichere (SV-Nummer, Steuer-ID, Name + Geburtsdatum)
          </label>
        </div>
        <p className="text-neutral-500">
          Statuswechsel (1234 → 1234a) werden nicht vorgeschlagen. „Keine Dublette“ blendet ein Paar bis zum Neuladen
          aus.
        </p>
        <div className="max-h-[32rem] overflow-auto">
          <table>
            <thead>
              <tr>
                <th>Person A</th>
                <th>Person B</th>
                <th>Grund</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sichtbarePaare.map((p) => (
                <tr key={`${p.a.id}|${p.b.id}`}>
                  <td>
                    {p.a.personal_nr} · {p.a.name}, {p.a.vorname}
                  </td>
                  <td>
                    {p.b.personal_nr} · {p.b.name}, {p.b.vorname}
                  </td>
                  <td className={p.sicher ? "" : "text-neutral-500"}>{p.grund}</td>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      className="text-emerald-700 underline"
                      onClick={() => paarWaehlen(p.a as Person, p.b as Person)}
                    >
                      ansehen
                    </button>{" "}
                    <button
                      type="button"
                      className="text-neutral-500 underline"
                      onClick={() => setAusgeblendet((alt) => new Set(alt).add(`${p.a.id}|${p.b.id}`))}
                    >
                      keine Dublette
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
