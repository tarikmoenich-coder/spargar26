"use client";

// Einstellungen → Allgemein: Firmen (SEPA-Auftraggeber, Lohnsteuer-Antrag;
// seit Stufe 3a je Firma) und die je
// Saisonjahr versionierten Sätze für Verpflegung/Unterkunft/Mindestlohn/
// Arbeitskleidung. Arbeitsgruppen, Herkünfte und Nutzer & Rollen sind eigene
// Unterseiten (components/EinstellungenTabs.tsx).

import PageHeader from "@/components/PageHeader";
import { Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { formatMenge } from "@/lib/format";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import type { BereichSatz, Firma, VerpflegungsSatz } from "@/lib/types";

import { hatRolle } from "@/lib/rollen";
const CURRENT_YEAR = new Date().getFullYear();

export default function EinstellungenAllgemeinPage() {
  const { profile } = useProfile();
  const isAdmin = hatRolle(profile, "admin");

  const [saetze, setSaetze] = useState<VerpflegungsSatz[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    saison_jahr: CURRENT_YEAR.toString(),
    verpflegung: "10.00",
    wohnen: "10.00",
    mindestlohn: "",
    kleidung_hose: "",
    kleidung_jacke: "",
    kleidung_stiefel: "",
    minijob_grenze: "",
  });
  const [saving, setSaving] = useState(false);
  // Sätze Vertrieb (Stufe 3c): eigene Verpflegung/Unterkunft/Kleidung je
  // Saison; ohne Eintrag gelten die Sätze oben.
  const [vtSaetze, setVtSaetze] = useState<BereichSatz[]>([]);
  const leerVt = {
    saison_jahr: CURRENT_YEAR.toString(),
    verpflegung: "",
    wohnen: "",
    kleidung_hose: "",
    kleidung_jacke: "",
    kleidung_stiefel: "",
  };
  const [vtForm, setVtForm] = useState(leerVt);
  const [vtFehler, setVtFehler] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Firmen (Stufe 3a): Bankdaten/Anschrift je Firma statt einer Einzeile.
  const [firmen, setFirmen] = useState<Firma[]>([]);
  const [firmaKuerzel, setFirmaKuerzel] = useState("MA");
  const bankdaten = firmen.find((f) => f.kuerzel === firmaKuerzel) ?? null;
  const [bankdatenForm, setBankdatenForm] = useState({
    name: "",
    iban: "",
    bic: "",
    steuernummer: "",
    strasse: "",
    hausnummer: "",
    plz: "",
    ort: "",
  });
  const [bankdatenSaving, setBankdatenSaving] = useState(false);
  const [bankdatenError, setBankdatenError] = useState<string | null>(null);
  const [bankdatenGespeichert, setBankdatenGespeichert] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data, error }, { data: bankdatenData }] = await Promise.all([
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false }),
      supabase.from("firma").select("*").order("reihenfolge"),
    ]);
    const { data: vt } = await supabase
      .from("bereich_saetze")
      .select("*")
      .eq("bereich", "VT")
      .order("saison_jahr", { ascending: false });
    setVtSaetze((vt as BereichSatz[]) ?? []);
    if (!error) setSaetze((data as VerpflegungsSatz[]) ?? []);
    const liste = (bankdatenData as Firma[]) ?? [];
    setFirmen(liste);
    formAusFirma(liste.find((f) => f.kuerzel === firmaKuerzel) ?? liste[0] ?? null);
    setLoading(false);
  }

  function formAusFirma(bd: Firma | null) {
    if (bd) setFirmaKuerzel(bd.kuerzel);
    setBankdatenForm({
      name: bd?.name ?? "",
      iban: bd?.iban ?? "",
      bic: bd?.bic ?? "",
      steuernummer: bd?.steuernummer ?? "",
      strasse: bd?.strasse ?? "",
      hausnummer: bd?.hausnummer ?? "",
      plz: bd?.plz ?? "",
      ort: bd?.ort ?? "",
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleBankdatenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBankdatenSaving(true);
    setBankdatenError(null);
    setBankdatenGespeichert(false);
    const { error } = await getSupabaseClient()
      .from("firma")
      .update({
        name: bankdatenForm.name,
        iban: bankdatenForm.iban || null,
        bic: bankdatenForm.bic || null,
        steuernummer: bankdatenForm.steuernummer || null,
        strasse: bankdatenForm.strasse || null,
        hausnummer: bankdatenForm.hausnummer || null,
        plz: bankdatenForm.plz || null,
        ort: bankdatenForm.ort || null,
        updated_by: profile?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("kuerzel", firmaKuerzel);
    setBankdatenSaving(false);
    if (error) {
      setBankdatenError(error.message);
      return;
    }
    setBankdatenGespeichert(true);
    load();
  }

  function editRow(satz: VerpflegungsSatz) {
    setForm({
      saison_jahr: satz.saison_jahr.toString(),
      verpflegung: satz.verpflegung.toString(),
      wohnen: satz.wohnen.toString(),
      mindestlohn: satz.mindestlohn?.toString() ?? "",
      kleidung_hose: satz.kleidung_hose?.toString() ?? "",
      kleidung_jacke: satz.kleidung_jacke?.toString() ?? "",
      kleidung_stiefel: satz.kleidung_stiefel?.toString() ?? "",
      minijob_grenze: satz.minijob_grenze?.toString() ?? "",
    });
  }

  const zahlOderNull = (v: string) => (v.trim() === "" ? null : Number(v));

  async function vtSpeichern(e: React.FormEvent) {
    e.preventDefault();
    setVtFehler(null);
    const { error } = await getSupabaseClient()
      .from("bereich_saetze")
      .upsert(
        {
          saison_jahr: Number(vtForm.saison_jahr),
          bereich: "VT",
          verpflegung: zahlOderNull(vtForm.verpflegung),
          wohnen: zahlOderNull(vtForm.wohnen),
          kleidung_hose: zahlOderNull(vtForm.kleidung_hose),
          kleidung_jacke: zahlOderNull(vtForm.kleidung_jacke),
          kleidung_stiefel: zahlOderNull(vtForm.kleidung_stiefel),
        },
        { onConflict: "saison_jahr,bereich" }
      );
    if (error) {
      setVtFehler(error.message);
      return;
    }
    setVtForm(leerVt);
    load();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { error } = await getSupabaseClient()
      .from("verpflegungssaetze")
      .upsert({
        saison_jahr: Number(form.saison_jahr),
        verpflegung: Number(form.verpflegung),
        wohnen: Number(form.wohnen),
        mindestlohn: form.mindestlohn ? Number(form.mindestlohn) : null,
        kleidung_hose: form.kleidung_hose ? Number(form.kleidung_hose) : null,
        kleidung_jacke: form.kleidung_jacke
          ? Number(form.kleidung_jacke)
          : null,
        kleidung_stiefel: form.kleidung_stiefel
          ? Number(form.kleidung_stiefel)
          : null,
        minijob_grenze: form.minijob_grenze ? Number(form.minijob_grenze) : null,
      });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <div>
        <PageHeader icon={Settings} titel="Einstellungen – Allgemein" />
        <p className="mt-1 text-sm text-neutral-500">
          Firmen (Bankdaten/Anschrift für SEPA und Lohnsteuer-Antrag) sowie die je Saisonjahr
          versionierten Sätze (ADR-007) für Verpflegung, Unterkunft,
          Mindestlohn und Arbeitskleidung. Änderungen wirken nur auf das
          jeweilige Saisonjahr; bereits berechnete Jahre bleiben unverändert.
          Der Mindestlohn wird beim Neuanlegen einer Person als Stundenlohn
          vorbelegt, bleibt dort aber änderbar.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Firmen
        </h2>
        <p className="text-sm text-neutral-500">
          Je Firma das Auftraggeber-Konto für SEPA-Überweisungen (Vorschüsse,
          Auszahlungen) sowie Steuernummer/Anschrift für den Lohnsteuerabzug-
          Sammelantrag. Jede Person gehört je Saison zu einer Firma -
          Landwirtschaft standardmäßig Mömmel Agrar, Vertrieb Mönich Direkt.
        </p>
      </div>

      {firmen.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {firmen.map((f) => (
            <button
              key={f.kuerzel}
              type="button"
              className={f.kuerzel === firmaKuerzel ? "btn" : "btn-secondary"}
              onClick={() => {
                setBankdatenGespeichert(false);
                formAusFirma(f);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
      {isAdmin ? (
        <form
          onSubmit={handleBankdatenSubmit}
          className="grid grid-cols-1 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-3"
        >
          <input
            placeholder="Firmenname (z.B. Mömmel Agrar GmbH & Co. KG)"
            required
            value={bankdatenForm.name}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, name: e.target.value })
            }
          />
          <input
            placeholder="IBAN"
            value={bankdatenForm.iban}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, iban: e.target.value })
            }
          />
          <input
            placeholder="BIC"
            value={bankdatenForm.bic}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, bic: e.target.value })
            }
          />
          <input
            placeholder="Steuernummer (z.B. 07 390 01921)"
            value={bankdatenForm.steuernummer}
            onChange={(e) =>
              setBankdatenForm({
                ...bankdatenForm,
                steuernummer: e.target.value,
              })
            }
          />
          <input
            placeholder="Straße"
            value={bankdatenForm.strasse}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, strasse: e.target.value })
            }
          />
          <input
            placeholder="Haus-Nr."
            value={bankdatenForm.hausnummer}
            onChange={(e) =>
              setBankdatenForm({
                ...bankdatenForm,
                hausnummer: e.target.value,
              })
            }
          />
          <input
            placeholder="PLZ"
            value={bankdatenForm.plz}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, plz: e.target.value })
            }
          />
          <input
            placeholder="Ort"
            value={bankdatenForm.ort}
            onChange={(e) =>
              setBankdatenForm({ ...bankdatenForm, ort: e.target.value })
            }
          />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={bankdatenSaving}>
              Speichern
            </button>
            {bankdatenGespeichert && (
              <span className="text-sm text-emerald-700">Gespeichert.</span>
            )}
            {bankdatenError && (
              <span className="text-sm text-beere-600">{bankdatenError}</span>
            )}
          </div>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">
          {bankdaten?.iban
            ? "Bankdaten dieser Firma sind hinterlegt."
            : "Für diese Firma sind keine Bankdaten hinterlegt."}{" "}
          Nur admin kann sie ändern.
        </p>
      )}

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Verpflegung / Unterkunft / Mindestlohn / Arbeitskleidung
        </h2>
      </div>

      {isAdmin ? (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-4"
        >
          <input
            type="number"
            placeholder="Saison-Jahr"
            required
            value={form.saison_jahr}
            onChange={(e) => setForm({ ...form, saison_jahr: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Verpflegung €/Tag"
            required
            value={form.verpflegung}
            onChange={(e) => setForm({ ...form, verpflegung: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Unterkunft €/Tag"
            required
            value={form.wohnen}
            onChange={(e) => setForm({ ...form, wohnen: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Mindestlohn €/Std."
            value={form.mindestlohn}
            onChange={(e) => setForm({ ...form, mindestlohn: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Arbeitshose €/Stück"
            value={form.kleidung_hose}
            onChange={(e) =>
              setForm({ ...form, kleidung_hose: e.target.value })
            }
          />
          <input
            type="number"
            step="0.01"
            placeholder="Arbeitsjacke €/Stück"
            value={form.kleidung_jacke}
            onChange={(e) =>
              setForm({ ...form, kleidung_jacke: e.target.value })
            }
          />
          <input
            type="number"
            step="0.01"
            placeholder="Gummistiefel €/Stück"
            value={form.kleidung_stiefel}
            onChange={(e) =>
              setForm({ ...form, kleidung_stiefel: e.target.value })
            }
          />
          <input
            type="number"
            step="0.01"
            placeholder="Minijob-Grenze €/Monat"
            title="Monatliche Verdienstgrenze für Minijobs - die Lohnübersicht warnt bei Überschreitung"
            value={form.minijob_grenze}
            onChange={(e) => setForm({ ...form, minijob_grenze: e.target.value })}
          />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Speichern
            </button>
            {error && <span className="text-sm text-beere-600">{error}</span>}
          </div>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">
          Nur Administratoren können diese Sätze ändern.
        </p>
      )}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Saison-Jahr</th>
                <th>Verpflegung €/Tag</th>
                <th>Unterkunft €/Tag</th>
                <th>Mindestlohn €/Std.</th>
                <th>Hose €/Stück</th>
                <th>Jacke €/Stück</th>
                <th>Stiefel €/Stück</th>
                <th>Minijob-Grenze €/Monat</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {saetze.map((s) => (
                <tr key={s.saison_jahr}>
                  <td>{s.saison_jahr}</td>
                  <td>{formatMenge(Number(s.verpflegung), 2)}</td>
                  <td>{formatMenge(Number(s.wohnen), 2)}</td>
                  <td>
                    {s.mindestlohn != null
                      ? formatMenge(Number(s.mindestlohn), 2)
                      : "—"}
                  </td>
                  <td>
                    {s.kleidung_hose != null
                      ? formatMenge(Number(s.kleidung_hose), 2)
                      : "—"}
                  </td>
                  <td>
                    {s.kleidung_jacke != null
                      ? formatMenge(Number(s.kleidung_jacke), 2)
                      : "—"}
                  </td>
                  <td>
                    {s.kleidung_stiefel != null
                      ? formatMenge(Number(s.kleidung_stiefel), 2)
                      : "—"}
                  </td>
                  <td>
                    {s.minijob_grenze != null
                      ? formatMenge(Number(s.minijob_grenze), 2)
                      : "—"}
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() => editRow(s)}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">Sätze Vertrieb</h2>
        <p className="text-sm text-neutral-500">
          Eigene Sätze für Verkäufer (Bereich Vertrieb) je Saisonjahr. Leere
          Felder bzw. Jahre ohne Eintrag nutzen die Sätze oben. Ob jemand
          überhaupt bei uns wohnt/isst, steht je Person auf der Stammkarte
          (Zeiträume ohne Unterkunft/Verpflegung).
        </p>
      </div>
      {isAdmin && (
        <form
          onSubmit={vtSpeichern}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-6"
        >
          <input
            type="number"
            placeholder="Saison-Jahr"
            required
            value={vtForm.saison_jahr}
            onChange={(e) => setVtForm({ ...vtForm, saison_jahr: e.target.value })}
          />
          <input type="number" step="0.01" placeholder="Verpflegung €/Tag" value={vtForm.verpflegung}
            onChange={(e) => setVtForm({ ...vtForm, verpflegung: e.target.value })} />
          <input type="number" step="0.01" placeholder="Unterkunft €/Tag" value={vtForm.wohnen}
            onChange={(e) => setVtForm({ ...vtForm, wohnen: e.target.value })} />
          <input type="number" step="0.01" placeholder="Hose €/Stück" value={vtForm.kleidung_hose}
            onChange={(e) => setVtForm({ ...vtForm, kleidung_hose: e.target.value })} />
          <input type="number" step="0.01" placeholder="Jacke €/Stück" value={vtForm.kleidung_jacke}
            onChange={(e) => setVtForm({ ...vtForm, kleidung_jacke: e.target.value })} />
          <input type="number" step="0.01" placeholder="Stiefel €/Stück" value={vtForm.kleidung_stiefel}
            onChange={(e) => setVtForm({ ...vtForm, kleidung_stiefel: e.target.value })} />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn">Speichern</button>
            {vtFehler && <span className="text-sm text-beere-600">{vtFehler}</span>}
          </div>
        </form>
      )}
      {vtSaetze.length > 0 && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Saison-Jahr</th>
                <th>Verpflegung €/Tag</th>
                <th>Unterkunft €/Tag</th>
                <th>Hose €/Stück</th>
                <th>Jacke €/Stück</th>
                <th>Stiefel €/Stück</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {vtSaetze.map((s) => (
                <tr key={s.saison_jahr}>
                  <td>{s.saison_jahr}</td>
                  {[s.verpflegung, s.wohnen, s.kleidung_hose, s.kleidung_jacke, s.kleidung_stiefel].map((w, i) => (
                    <td key={i}>{w != null ? formatMenge(Number(w), 2) : "— (wie oben)"}</td>
                  ))}
                  {isAdmin && (
                    <td>
                      <button
                        className="btn-secondary"
                        onClick={() =>
                          setVtForm({
                            saison_jahr: s.saison_jahr.toString(),
                            verpflegung: s.verpflegung?.toString() ?? "",
                            wohnen: s.wohnen?.toString() ?? "",
                            kleidung_hose: s.kleidung_hose?.toString() ?? "",
                            kleidung_jacke: s.kleidung_jacke?.toString() ?? "",
                            kleidung_stiefel: s.kleidung_stiefel?.toString() ?? "",
                          })
                        }
                      >
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
