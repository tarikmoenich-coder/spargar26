"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import { formatDatumDE } from "@/lib/format";
import {
  FUEHRERSCHEIN_KATEGORIEN,
  type Employee,
  type Herkunft,
  type PersonalKandidat,
  type UnterkunftHerkunftKontingent,
  type VerpflegungsSatz,
} from "@/lib/types";
import PersonalTabs from "@/components/PersonalTabs";

const emptyForm = {
  personal_nr: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  nationalitaet: "",
  herkunft: "",
  stundenlohn: "",
  geplante_ankunft: "",
  fuehrerschein: [] as string[],
  notiz: "",
};

export default function PersonalplanungPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [kandidaten, setKandidaten] = useState<PersonalKandidat[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  // Falls diese Person schon einmal hier war: Verknüpfung zu ihrer
  // (ggf. inaktiven) employees-Zeile - siehe Kommentar in schema.sql bei
  // personal_kandidaten.verknuepfter_employee_id.
  const [verknuepfterId, setVerknuepfterId] = useState<string | null>(null);
  const [employeeSuche, setEmployeeSuche] = useState("");
  const [naechsteKreis, setNaechsteKreis] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ausgewaehlt, setAusgewaehlt] = useState<string[]>([]);
  const [aktivierenLaufend, setAktivierenLaufend] = useState(false);
  const [showStorniert, setShowStorniert] = useState(false);
  // Für die Vorbelegung des Stundenlohns mit dem Mindestlohn (siehe
  // Einstellungen-Seite).
  const [verpflegungssatz, setVerpflegungssatz] =
    useState<VerpflegungsSatz | null>(null);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: kData }, { data: eData }, { data: hData }, { data: vData }] =
      await Promise.all([
        supabase
          .from("personal_kandidaten")
          .select("*")
          .order("herkunft")
          .order("name"),
        supabase.from("employees").select("*").order("name"),
        supabase.from("herkuenfte").select("*").order("reihenfolge"),
        supabase
          .from("verpflegungssaetze")
          .select("*")
          .order("saison_jahr", { ascending: false })
          .limit(1),
      ]);
    setKandidaten((kData as PersonalKandidat[]) ?? []);
    setEmployees((eData as Employee[]) ?? []);
    setHerkuenfte((hData as Herkunft[]) ?? []);
    setVerpflegungssatz(((vData as VerpflegungsSatz[]) ?? [])[0] ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  // "Belegt" zählt employees UND alle nicht-stornierten Kandidaten - eine
  // stornierte Reservierung gibt ihre Nummer sofort wieder frei (siehe
  // Kommentar in schema.sql).
  const belegteNummern = useMemo(() => {
    const belegt = new Set<number>();
    employees.forEach((e) => {
      const n = parsePersonalNrNummer(e.personal_nr);
      if (n !== null) belegt.add(n);
    });
    kandidaten
      .filter((k) => k.status !== "storniert")
      .forEach((k) => {
        const n = parsePersonalNrNummer(k.personal_nr);
        if (n !== null) belegt.add(n);
      });
    return belegt;
  }, [employees, kandidaten]);

  // Vorbelegt den Stundenlohn für NEUE (nicht verknüpfte) Kandidaten mit dem
  // aktuell gültigen Mindestlohn aus den Einstellungen - bleibt weiterhin
  // frei änderbar. Läuft absichtlich bei jedem load() erneut (z.B. nach dem
  // Zurücksetzen des Formulars nach dem Anlegen), nicht nur beim ersten Mal.
  useEffect(() => {
    if (verknuepfterId) return;
    if (form.stundenlohn !== "") return;
    if (verpflegungssatz?.mindestlohn == null) return;
    setForm((f) => ({ ...f, stundenlohn: String(verpflegungssatz.mindestlohn) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verpflegungssatz]);

  function naechsteFreieUebernehmen() {
    const frei = naechsteFreieNummer(belegteNummern, Number(naechsteKreis));
    if (frei !== null) {
      setForm((f) => ({ ...f, personal_nr: frei.toString() }));
    }
  }

  const personalNrKonflikt = (() => {
    const typed = form.personal_nr.trim().toLowerCase();
    if (!typed || verknuepfterId) return null;
    const inEmployees = employees.find(
      (e) => e.personal_nr.trim().toLowerCase() === typed
    );
    if (inEmployees) {
      return `${inEmployees.name}, ${inEmployees.vorname} (Personal)`;
    }
    const inKandidaten = kandidaten.find(
      (k) =>
        k.status !== "storniert" &&
        k.personal_nr.trim().toLowerCase() === typed
    );
    if (inKandidaten) {
      return `${inKandidaten.name}, ${inKandidaten.vorname} (bereits geplant)`;
    }
    return null;
  })();

  const employeeTreffer = useMemo(() => {
    const q = employeeSuche.trim().toLowerCase();
    if (q.length < 2) return [];
    return employees
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.vorname.toLowerCase().includes(q) ||
          e.personal_nr.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [employeeSuche, employees]);

  const verknuepfterEmployee = verknuepfterId
    ? employees.find((e) => e.id === verknuepfterId) ?? null
    : null;

  function personVerknuepfen(emp: Employee) {
    setVerknuepfterId(emp.id);
    setForm((f) => ({
      ...f,
      personal_nr: emp.personal_nr,
      name: emp.name,
      vorname: emp.vorname,
      geburtsdatum: emp.geburtsdatum ?? "",
      nationalitaet: emp.nationalitaet ?? "",
      herkunft: emp.herkunft ?? "",
      // Vorbelegt aus dem letzten Einsatz, aber bewusst editierbar - der
      // Lohn kann sich zur neuen Saison geändert haben.
      stundenlohn: emp.stundenlohn?.toString() ?? "",
    }));
    setEmployeeSuche("");
  }

  function verknuepfungLoesen() {
    setVerknuepfterId(null);
    setForm(emptyForm);
  }

  function toggleFuehrerschein(kategorie: string) {
    setForm((f) => ({
      ...f,
      fuehrerschein: f.fuehrerschein.includes(kategorie)
        ? f.fuehrerschein.filter((k) => k !== kategorie)
        : [...f.fuehrerschein, kategorie],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (personalNrKonflikt) return;
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("personal_kandidaten").insert({
      personal_nr: form.personal_nr,
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      nationalitaet: form.nationalitaet || null,
      herkunft: form.herkunft || null,
      verknuepfter_employee_id: verknuepfterId,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      geplante_ankunft: form.geplante_ankunft || null,
      fuehrerschein_kategorien:
        form.fuehrerschein.length > 0 ? form.fuehrerschein : null,
      notiz: form.notiz || null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    setForm(emptyForm);
    setVerknuepfterId(null);
    load();
  }

  function toggleAusgewaehlt(id: string) {
    setAusgewaehlt((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Erzeugt aus jedem ausgewählten Kandidaten einen echten employees-
  // Datensatz (bei einer Verknüpfung wird die bestehende, ggf. inaktive
  // Person reaktiviert - Historie bleibt an einer ID, ADR-011; sonst neu
  // angelegt mit der reservierten Personalnummer) und verschiebt ihn in die
  // Anreiseliste (Personal → Anreiseliste), wo Vertragszeitraum, Dokumente
  // und die weiteren Unterlagen erfasst werden.
  async function anreiseVorbereiten() {
    if (ausgewaehlt.length === 0) return;
    if (
      !window.confirm(
        `${ausgewaehlt.length} Kandidat(en) jetzt aktivieren und in die Anreiseliste verschieben?`
      )
    ) {
      return;
    }
    setAktivierenLaufend(true);
    setError(null);
    const supabase = getSupabaseClient();
    const fehlerListe: string[] = [];

    // Herkunfts-Stammplätze laden: die reservierten Wohneinheiten je
    // (Saison, Herkunft) und die aktuelle Belegung/Planung je Wohneinheit.
    const jahre = [
      ...new Set(
        ausgewaehlt.map((id) => {
          const k = kandidaten.find((x) => x.id === id);
          return k?.geplante_ankunft
            ? new Date(k.geplante_ankunft).getFullYear()
            : new Date().getFullYear();
        })
      ),
    ];
    const [{ data: kontData }, { data: ueberData }] = await Promise.all([
      supabase
        .from("unterkunft_herkunft_kontingent")
        .select("*")
        .in("saison_jahr", jahre)
        .order("reihenfolge"),
      supabase
        .from("unterkunft_wohneinheit_uebersicht")
        .select("wohneinheit_id, betten, fest, geplant"),
    ]);
    const kontingentByHerkunft = new Map<string, UnterkunftHerkunftKontingent[]>();
    ((kontData as UnterkunftHerkunftKontingent[]) ?? []).forEach((k) => {
      const key = `${k.saison_jahr}|${k.herkunft}`;
      if (!kontingentByHerkunft.has(key)) kontingentByHerkunft.set(key, []);
      kontingentByHerkunft.get(key)!.push(k);
    });
    const weUeber = new Map<
      number,
      { betten: number; fest: number; geplant: number }
    >(
      ((ueberData as { wohneinheit_id: number; betten: number; fest: number; geplant: number }[]) ??
        []).map((u) => [u.wohneinheit_id, u])
    );
    const platziertProWe = new Map<number, number>();
    const ohnePlatz = new Map<string, number>();

    for (const id of ausgewaehlt) {
      const k = kandidaten.find((x) => x.id === id);
      if (!k || k.status !== "geplant") continue;
      let employeeId: string | null = null;
      if (k.verknuepfter_employee_id) {
        const { error } = await supabase
          .from("employees")
          .update({
            aktiv: true,
            name: k.name,
            vorname: k.vorname,
            geburtsdatum: k.geburtsdatum,
            nationalitaet: k.nationalitaet,
            herkunft: k.herkunft,
            ...(k.stundenlohn !== null ? { stundenlohn: k.stundenlohn } : {}),
          })
          .eq("id", k.verknuepfter_employee_id);
        if (error) {
          fehlerListe.push(`${k.name}, ${k.vorname}: ${error.message}`);
          continue;
        }
        employeeId = k.verknuepfter_employee_id;
      } else {
        const { data, error } = await supabase
          .from("employees")
          .insert({
            personal_nr: k.personal_nr,
            name: k.name,
            vorname: k.vorname,
            geburtsdatum: k.geburtsdatum,
            nationalitaet: k.nationalitaet,
            herkunft: k.herkunft,
            stundenlohn: k.stundenlohn,
            aktiv: true,
          })
          .select("id")
          .single();
        if (error || !data) {
          fehlerListe.push(
            `${k.name}, ${k.vorname}: ${error?.message ?? "unbekannter Fehler"}`
          );
          continue;
        }
        employeeId = data.id;
      }
      await supabase
        .from("personal_kandidaten")
        .update({ status: "anreiseliste", aktivierter_employee_id: employeeId })
        .eq("id", k.id);

      // Person in das nächste freie reservierte Haus ihrer Herkunft setzen
      // (geplante Zimmerzuordnung, Wohneinheits-Ebene). Zimmer regelt der
      // Hausmeister bei der Ankunft.
      if (employeeId && k.herkunft) {
        const saisonJ = k.geplante_ankunft
          ? new Date(k.geplante_ankunft).getFullYear()
          : new Date().getFullYear();
        const kont = kontingentByHerkunft.get(`${saisonJ}|${k.herkunft}`) ?? [];
        let platziert = false;
        for (const we of kont) {
          const u = weUeber.get(we.wohneinheit_id);
          const betten = u?.betten ?? 0;
          const belegtJetzt =
            (u ? u.fest + u.geplant : 0) +
            (platziertProWe.get(we.wohneinheit_id) ?? 0);
          if (belegtJetzt >= betten) continue;
          const { error } = await supabase.from("unterkunft_zuordnung").insert({
            employee_id: employeeId,
            wohneinheit_id: we.wohneinheit_id,
            geplant_ab:
              k.geplante_ankunft ?? new Date().toISOString().slice(0, 10),
          });
          if (!error) {
            platziertProWe.set(
              we.wohneinheit_id,
              (platziertProWe.get(we.wohneinheit_id) ?? 0) + 1
            );
            platziert = true;
          } else if (error.code === "23505") {
            platziert = true; // schon einer Wohneinheit zugeordnet
          } else {
            fehlerListe.push(`${k.name}: Zuordnung – ${error.message}`);
            platziert = true;
          }
          break;
        }
        if (!platziert) {
          ohnePlatz.set(k.herkunft, (ohnePlatz.get(k.herkunft) ?? 0) + 1);
        }
      }
    }
    setAktivierenLaufend(false);
    setAusgewaehlt([]);
    if (ohnePlatz.size > 0) {
      fehlerListe.push(
        "Ohne reservierten Platz: " +
          [...ohnePlatz.entries()]
            .map(([h, n]) => `${n}× ${h}`)
            .join(" · ") +
          " – Kontingent in der Herkunfts-Planung erweitern."
      );
    }
    if (fehlerListe.length > 0) setError(fehlerListe.join(" · "));
    load();
  }

  async function stornieren(k: PersonalKandidat) {
    const grund = window.prompt(
      "Begründung für die Absage (Pflichtfeld, wird protokolliert):"
    );
    if (!grund) return;
    const supabase = getSupabaseClient();
    await supabase
      .from("personal_kandidaten")
      .update({ status: "storniert", storniert_grund: grund })
      .eq("id", k.id);
    load();
  }

  const geplante = kandidaten.filter((k) => k.status === "geplant");
  const stornierteListe = kandidaten.filter((k) => k.status === "storniert");

  const gruppen = useMemo(() => {
    const buckets = new Map<string, PersonalKandidat[]>();
    for (const k of geplante) {
      const key = k.herkunft ?? "__ohne__";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(k);
    }
    const reihenfolge = new Map(herkuenfte.map((h) => [h.wert, h.reihenfolge]));
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === "__ohne__") return 1;
      if (b === "__ohne__") return -1;
      return (reihenfolge.get(a) ?? 0) - (reihenfolge.get(b) ?? 0);
    });
    return keys.map((key) => ({
      key,
      anzeige: key === "__ohne__" ? "Ohne Herkunft" : key,
      liste: buckets.get(key)!,
    }));
  }, [geplante, herkuenfte]);

  function schwarzeListeVon(empId: string | null) {
    if (!empId) return null;
    const e = employees.find((x) => x.id === empId);
    return e?.schwarze_liste ? e : null;
  }

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Personalplanung
        </h1>
        <p className="text-sm text-neutral-500">
          Kandidaten für die kommende Saison vorab anlegen, bevor sie
          tatsächlich anreisen. Personalnummern werden dabei nur reserviert,
          nicht final vergeben – bei einer Absage wird die Nummer sofort
          wieder frei. Über „Anreise vorbereiten" wird aus einem Kandidaten
          ein echter Mitarbeiter unter „Personal" und er wandert in die{" "}
          <a href="/personal-anreiseliste" className="underline">
            Anreiseliste
          </a>{" "}
          weiter, wo Vertragszeitraum und Unterlagen erfasst werden.
        </p>
      </div>

      {canEdit && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded border border-neutral-200 bg-white p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-neutral-700">
              Bereits einmal hier gewesen?
            </label>
            {verknuepfterEmployee ? (
              <div className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-sm">
                Verknüpft mit {verknuepfterEmployee.name},{" "}
                {verknuepfterEmployee.vorname} ({verknuepfterEmployee.personal_nr}
                {!verknuepfterEmployee.aktiv ? ", inaktiv" : ""})
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={verknuepfungLoesen}
                >
                  Verknüpfung lösen
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  placeholder="Name/Personalnummer suchen, um eine bekannte Person zu verknüpfen…"
                  value={employeeSuche}
                  onChange={(e) => setEmployeeSuche(e.target.value)}
                  className="w-full"
                />
                {employeeTreffer.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded border border-neutral-200 bg-white shadow-md">
                    {employeeTreffer.map((e) => (
                      <button
                        type="button"
                        key={e.id}
                        className="flex w-full items-center justify-between px-2 py-1 text-left text-sm hover:bg-neutral-50"
                        onClick={() => personVerknuepfen(e)}
                      >
                        <span>
                          {e.name}, {e.vorname} ({e.personal_nr})
                          {!e.aktiv ? " · inaktiv" : ""}
                        </span>
                        {e.schwarze_liste && (
                          <span className="font-medium text-red-600">
                            ⚠ Schwarze Liste
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {verknuepfterEmployee?.schwarze_liste && (
              <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                ⚠ Diese Person steht auf der Schwarzen Liste
                {verknuepfterEmployee.schwarze_liste_grund
                  ? `: ${verknuepfterEmployee.schwarze_liste_grund}`
                  : "."}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  placeholder="Personalnummer (reserviert)"
                  required
                  value={form.personal_nr}
                  disabled={!!verknuepfterId}
                  onChange={(e) =>
                    setForm({ ...form, personal_nr: e.target.value })
                  }
                />
                {!verknuepfterId && (
                  <>
                    <select
                      value={naechsteKreis}
                      onChange={(e) => setNaechsteKreis(e.target.value)}
                    >
                      {Array.from(
                        { length: ANZAHL_PERSONALNUMMERN_KREISE },
                        (_, i) => i + 1
                      ).map((kreis) => {
                        const [von, bis] = kreisBereich(kreis);
                        return (
                          <option key={kreis} value={kreis}>
                            Kreis {kreis} ({von}-{bis})
                          </option>
                        );
                      })}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary whitespace-nowrap text-xs"
                      onClick={naechsteFreieUebernehmen}
                    >
                      Nächste freie Nr.
                    </button>
                  </>
                )}
              </div>
              {personalNrKonflikt && (
                <span className="text-xs text-red-600">
                  Bereits vergeben an {personalNrKonflikt}
                </span>
              )}
            </div>
            <input
              placeholder="Name"
              required
              disabled={!!verknuepfterId}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              placeholder="Vorname"
              required
              disabled={!!verknuepfterId}
              value={form.vorname}
              onChange={(e) => setForm({ ...form, vorname: e.target.value })}
            />
            <input
              type="date"
              placeholder="Geburtsdatum"
              disabled={!!verknuepfterId}
              value={form.geburtsdatum}
              onChange={(e) =>
                setForm({ ...form, geburtsdatum: e.target.value })
              }
            />
            <input
              placeholder="Staatsangehörigkeit"
              value={form.nationalitaet}
              onChange={(e) =>
                setForm({ ...form, nationalitaet: e.target.value })
              }
            />
            <select
              value={form.herkunft}
              onChange={(e) => setForm({ ...form, herkunft: e.target.value })}
            >
              <option value="">— keine Herkunft —</option>
              {herkuenfte.map((h) => (
                <option key={h.wert} value={h.wert}>
                  {h.wert}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Geplante Ankunft
              <input
                type="date"
                value={form.geplante_ankunft}
                onChange={(e) =>
                  setForm({ ...form, geplante_ankunft: e.target.value })
                }
              />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Stundenlohn € (für Arbeitsvertrag)
              <input
                type="number"
                step="0.01"
                value={form.stundenlohn}
                onChange={(e) =>
                  setForm({ ...form, stundenlohn: e.target.value })
                }
              />
            </label>
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-xs text-neutral-500">
                Führerschein (Selbstauskunft)
              </span>
              <div className="flex flex-wrap gap-3">
                {FUEHRERSCHEIN_KATEGORIEN.map((kategorie) => (
                  <label key={kategorie} className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={form.fuehrerschein.includes(kategorie)}
                      onChange={() => toggleFuehrerschein(kategorie)}
                    />
                    {kategorie}
                  </label>
                ))}
              </div>
            </div>
            <input
              placeholder="Notiz"
              className="col-span-2"
              value={form.notiz}
              onChange={(e) => setForm({ ...form, notiz: e.target.value })}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="btn"
              disabled={saving || !!personalNrKonflikt}
            >
              Kandidat anlegen
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      {canEdit && ausgewaehlt.length > 0 && (
        <div className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 flex items-center gap-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2">
          <span className="text-sm font-medium text-emerald-800">
            {ausgewaehlt.length} ausgewählt
          </span>
          <button
            type="button"
            className="btn"
            disabled={aktivierenLaufend}
            onClick={anreiseVorbereiten}
          >
            Anreise vorbereiten
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : geplante.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Keine geplanten Kandidaten.
        </p>
      ) : (
        gruppen.map((g) => (
          <div key={g.key} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold text-emerald-800">
              {g.anzeige} ({g.liste.length})
            </h2>
            <table>
              <thead>
                <tr>
                  {canEdit && <th></th>}
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Vorname</th>
                  <th>Geburtsdatum</th>
                  <th>Geplante Ankunft</th>
                  <th>Führerschein</th>
                  <th>Verknüpft</th>
                  <th>Notiz</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {g.liste.map((k) => {
                  const blacklisted = schwarzeListeVon(
                    k.verknuepfter_employee_id
                  );
                  return (
                    <tr key={k.id}>
                      {canEdit && (
                        <td>
                          <input
                            type="checkbox"
                            checked={ausgewaehlt.includes(k.id)}
                            onChange={() => toggleAusgewaehlt(k.id)}
                          />
                        </td>
                      )}
                      <td>{k.personal_nr}</td>
                      <td>{k.name}</td>
                      <td>{k.vorname}</td>
                      <td>{formatDatumDE(k.geburtsdatum)}</td>
                      <td>{formatDatumDE(k.geplante_ankunft)}</td>
                      <td>
                        {k.fuehrerschein_kategorien &&
                        k.fuehrerschein_kategorien.length > 0
                          ? k.fuehrerschein_kategorien.join(", ")
                          : "—"}
                      </td>
                      <td>
                        {k.verknuepfter_employee_id ? (
                          blacklisted ? (
                            <span
                              className="font-medium text-red-600"
                              title={blacklisted.schwarze_liste_grund ?? undefined}
                            >
                              ⚠ Schwarze Liste
                            </span>
                          ) : (
                            <span className="text-emerald-700">Ja</span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{k.notiz ?? "—"}</td>
                      {canEdit && (
                        <td>
                          <button
                            type="button"
                            className="btn-danger text-xs"
                            onClick={() => stornieren(k)}
                          >
                            Absagen
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {stornierteListe.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="btn-secondary w-fit text-xs"
            onClick={() => setShowStorniert((v) => !v)}
          >
            {showStorniert
              ? "Stornierte ausblenden"
              : `Stornierte anzeigen (${stornierteListe.length})`}
          </button>
          {showStorniert && (
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>Vorname</th>
                  <th>Grund</th>
                </tr>
              </thead>
              <tbody>
                {stornierteListe.map((k) => (
                  <tr key={k.id} className="opacity-60">
                    <td>{k.personal_nr}</td>
                    <td>{k.name}</td>
                    <td>{k.vorname}</td>
                    <td>{k.storniert_grund}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
