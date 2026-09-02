"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  KULTUREN,
  KULTUR_LABELS,
  type Arbeitsgruppe,
  type FirmenBankdaten,
  type Herkunft,
  type VerpflegungsSatz,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

const emptyGruppenForm = {
  gruppe_nr: "",
  bezeichnung: "",
  reihenfolge: "0",
  kultur: "",
};
const emptyHerkunftForm = { wert: "", reihenfolge: "0" };

export default function EinstellungenPage() {
  const { profile } = useProfile();
  const [saetze, setSaetze] = useState<VerpflegungsSatz[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    saison_jahr: CURRENT_YEAR.toString(),
    verpflegung: "10.00",
    wohnen: "10.00",
    mindestlohn: "",
    kleidung_hose: "",
    kleidung_jacke: "",
    kleidung_stiefel: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [gruppenForm, setGruppenForm] = useState(emptyGruppenForm);
  const [editingGruppeNr, setEditingGruppeNr] = useState<string | null>(null);
  const [gruppenSaving, setGruppenSaving] = useState(false);
  const [gruppenError, setGruppenError] = useState<string | null>(null);

  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [herkunftForm, setHerkunftForm] = useState(emptyHerkunftForm);
  const [editingHerkunftWert, setEditingHerkunftWert] = useState<
    string | null
  >(null);
  const [herkunftSaving, setHerkunftSaving] = useState(false);
  const [herkunftError, setHerkunftError] = useState<string | null>(null);

  const isAdmin = profile?.role === "admin";

  // Firmen-Bankdaten (Nutzer-Vorgabe 2026-08-25): Auftraggeber-Konto für
  // den SEPA-Überweisungs-Export bei Vorschüssen - Singleton-Zeile.
  const [bankdaten, setBankdaten] = useState<FirmenBankdaten | null>(null);
  const [bankdatenForm, setBankdatenForm] = useState({
    name: "",
    iban: "",
    bic: "",
  });
  const [bankdatenSaving, setBankdatenSaving] = useState(false);
  const [bankdatenError, setBankdatenError] = useState<string | null>(null);
  const [bankdatenGespeichert, setBankdatenGespeichert] = useState(false);

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [
      { data, error },
      { data: gruppenData },
      { data: herkunftData },
      { data: bankdatenData },
    ] = await Promise.all([
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false }),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      supabase.from("firmen_bankdaten").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (!error) setSaetze((data as VerpflegungsSatz[]) ?? []);
    setGruppen((gruppenData as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((herkunftData as Herkunft[]) ?? []);
    const bd = (bankdatenData as FirmenBankdaten) ?? null;
    setBankdaten(bd);
    setBankdatenForm({
      name: bd?.name ?? "",
      iban: bd?.iban ?? "",
      bic: bd?.bic ?? "",
    });
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleBankdatenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBankdatenSaving(true);
    setBankdatenError(null);
    setBankdatenGespeichert(false);
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("firmen_bankdaten")
      .update({
        name: bankdatenForm.name,
        iban: bankdatenForm.iban || null,
        bic: bankdatenForm.bic || null,
      })
      .eq("id", 1);
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
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("verpflegungssaetze").upsert({
      saison_jahr: Number(form.saison_jahr),
      verpflegung: Number(form.verpflegung),
      wohnen: Number(form.wohnen),
      mindestlohn: form.mindestlohn ? Number(form.mindestlohn) : null,
      kleidung_hose: form.kleidung_hose ? Number(form.kleidung_hose) : null,
      kleidung_jacke: form.kleidung_jacke ? Number(form.kleidung_jacke) : null,
      kleidung_stiefel: form.kleidung_stiefel
        ? Number(form.kleidung_stiefel)
        : null,
    });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  function editGruppe(g: Arbeitsgruppe) {
    setEditingGruppeNr(g.gruppe_nr);
    setGruppenForm({
      gruppe_nr: g.gruppe_nr,
      bezeichnung: g.bezeichnung,
      reihenfolge: g.reihenfolge.toString(),
      kultur: g.kultur ?? "",
    });
  }

  function resetGruppenForm() {
    setEditingGruppeNr(null);
    setGruppenForm(emptyGruppenForm);
  }

  async function handleGruppenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGruppenSaving(true);
    setGruppenError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("arbeitsgruppen").upsert({
      gruppe_nr: gruppenForm.gruppe_nr,
      bezeichnung: gruppenForm.bezeichnung,
      reihenfolge: Number(gruppenForm.reihenfolge) || 0,
      kultur: gruppenForm.kultur || null,
    });
    setGruppenSaving(false);
    if (error) {
      setGruppenError(error.message);
      return;
    }
    resetGruppenForm();
    load();
  }

  function editHerkunft(h: Herkunft) {
    setEditingHerkunftWert(h.wert);
    setHerkunftForm({ wert: h.wert, reihenfolge: h.reihenfolge.toString() });
  }

  function resetHerkunftForm() {
    setEditingHerkunftWert(null);
    setHerkunftForm(emptyHerkunftForm);
  }

  async function handleHerkunftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setHerkunftSaving(true);
    setHerkunftError(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("herkuenfte").upsert({
      wert: herkunftForm.wert,
      reihenfolge: Number(herkunftForm.reihenfolge) || 0,
    });
    setHerkunftSaving(false);
    if (error) {
      setHerkunftError(error.message);
      return;
    }
    resetHerkunftForm();
    load();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Einstellungen
        </h1>
        <p className="text-sm text-neutral-500">
          Verpflegungs- und Unterkunft-Abzüge pro Anwesenheitstag sowie der
          gesetzliche Mindestlohn, je Saisonjahr. Änderungen wirken sich nur
          auf das jeweilige Saisonjahr aus (ADR-007: versionierte Sätze) -
          bereits berechnete andere Jahre bleiben unverändert. Der
          Mindestlohn wird beim Neuanlegen einer Person (Personalstamm oder
          Personalplanung) automatisch als Stundenlohn vorbelegt, bleibt dort
          aber frei änderbar.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Firmen-Bankdaten
        </h2>
        <p className="text-sm text-neutral-500">
          Auftraggeber-Konto für den SEPA-Überweisungs-Export bei
          Vorschüssen (Zahlungsart Banküberweisung) - wird einmal
          hinterlegt und für jede erzeugte SEPA-Datei verwendet. Nur
          admin/kasse können diese Daten überhaupt lesen.
        </p>
      </div>

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
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={bankdatenSaving}>
              Speichern
            </button>
            {bankdatenGespeichert && (
              <span className="text-sm text-emerald-700">Gespeichert.</span>
            )}
            {bankdatenError && (
              <span className="text-sm text-red-600">{bankdatenError}</span>
            )}
          </div>
        </form>
      ) : (
        <p className="text-sm text-neutral-500">
          {bankdaten?.iban
            ? "Firmen-Bankdaten sind hinterlegt."
            : "Keine Firmen-Bankdaten hinterlegt."}{" "}
          Nur admin kann sie ändern.
        </p>
      )}

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Verpflegung/Unterkunft/Mindestlohn/Arbeitskleidung
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
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={saving}>
              Speichern
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
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
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {saetze.map((s) => (
              <tr key={s.saison_jahr}>
                <td>{s.saison_jahr}</td>
                <td>{Number(s.verpflegung).toFixed(2)}</td>
                <td>{Number(s.wohnen).toFixed(2)}</td>
                <td>{s.mindestlohn != null ? Number(s.mindestlohn).toFixed(2) : "—"}</td>
                <td>{s.kleidung_hose != null ? Number(s.kleidung_hose).toFixed(2) : "—"}</td>
                <td>{s.kleidung_jacke != null ? Number(s.kleidung_jacke).toFixed(2) : "—"}</td>
                <td>{s.kleidung_stiefel != null ? Number(s.kleidung_stiefel).toFixed(2) : "—"}</td>
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
      )}

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Arbeitsgruppen
        </h2>
        <p className="text-sm text-neutral-500">
          Gruppen (z.B. Sortierer, Träger, Schälmannschaft) für die
          übersichtliche Gruppierung auf der Stundenerfassung und die
          gedruckten Gruppenstundenzettel. Die Reihenfolge bestimmt die
          Anzeige-/Druckreihenfolge der Gruppen. Die optionale Kultur
          ordnet die in dieser Gruppe erfassten Stunden einer Kultur zu -
          auf der jeweiligen Statistik-Seite werden diese Stunden ×
          Mindestlohn zusätzlich auf die an diesem Tag geerntete Menge
          umgelegt (ergänzend zu den Prämien-Stunden der tatsächlich in der
          Prämien-Erfassung stehenden Personen).
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={handleGruppenSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-5"
        >
          <input
            placeholder="Gruppen-Nr."
            required
            disabled={editingGruppeNr !== null}
            value={gruppenForm.gruppe_nr}
            onChange={(e) =>
              setGruppenForm({ ...gruppenForm, gruppe_nr: e.target.value })
            }
          />
          <input
            placeholder="Bezeichnung (z.B. Sortierer)"
            required
            value={gruppenForm.bezeichnung}
            onChange={(e) =>
              setGruppenForm({ ...gruppenForm, bezeichnung: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Reihenfolge"
            value={gruppenForm.reihenfolge}
            onChange={(e) =>
              setGruppenForm({ ...gruppenForm, reihenfolge: e.target.value })
            }
          />
          <select
            value={gruppenForm.kultur}
            onChange={(e) =>
              setGruppenForm({ ...gruppenForm, kultur: e.target.value })
            }
          >
            <option value="">Kultur: keine</option>
            {KULTUREN.map((k) => (
              <option key={k} value={k}>
                {KULTUR_LABELS[k]}
              </option>
            ))}
          </select>
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={gruppenSaving}>
              {editingGruppeNr ? "Speichern" : "Anlegen"}
            </button>
            {editingGruppeNr && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetGruppenForm}
              >
                Abbrechen
              </button>
            )}
            {gruppenError && (
              <span className="text-sm text-red-600">{gruppenError}</span>
            )}
          </div>
        </form>
      )}

      {!loading && (
        <table>
          <thead>
            <tr>
              <th>Gruppen-Nr.</th>
              <th>Bezeichnung</th>
              <th>Reihenfolge</th>
              <th>Kultur</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {gruppen.map((g) => (
              <tr key={g.gruppe_nr}>
                <td>{g.gruppe_nr}</td>
                <td>{g.bezeichnung}</td>
                <td>{g.reihenfolge}</td>
                <td>{g.kultur ? KULTUR_LABELS[g.kultur] : "—"}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => editGruppe(g)}
                    >
                      Bearbeiten
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Herkünfte
        </h2>
        <p className="text-sm text-neutral-500">
          Feste Liste der Herkünfte für den Personalstamm - damit sich
          Vorschüsse zuverlässig nach Herkunft auswählen lassen (keine
          Tippfehler-Varianten).
        </p>
      </div>

      {isAdmin && (
        <form
          onSubmit={handleHerkunftSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-linie bg-white p-4 sm:grid-cols-4"
        >
          <input
            placeholder="Herkunft (z.B. Kroatien)"
            required
            disabled={editingHerkunftWert !== null}
            value={herkunftForm.wert}
            onChange={(e) =>
              setHerkunftForm({ ...herkunftForm, wert: e.target.value })
            }
          />
          <input
            type="number"
            placeholder="Reihenfolge"
            value={herkunftForm.reihenfolge}
            onChange={(e) =>
              setHerkunftForm({
                ...herkunftForm,
                reihenfolge: e.target.value,
              })
            }
          />
          <div className="col-span-full flex items-center gap-2">
            <button type="submit" className="btn" disabled={herkunftSaving}>
              {editingHerkunftWert ? "Speichern" : "Anlegen"}
            </button>
            {editingHerkunftWert && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetHerkunftForm}
              >
                Abbrechen
              </button>
            )}
            {herkunftError && (
              <span className="text-sm text-red-600">{herkunftError}</span>
            )}
          </div>
        </form>
      )}

      {!loading && (
        <table>
          <thead>
            <tr>
              <th>Herkunft</th>
              <th>Reihenfolge</th>
              {isAdmin && <th></th>}
            </tr>
          </thead>
          <tbody>
            {herkuenfte.map((h) => (
              <tr key={h.wert}>
                <td>{h.wert}</td>
                <td>{h.reihenfolge}</td>
                {isAdmin && (
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => editHerkunft(h)}
                    >
                      Bearbeiten
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
