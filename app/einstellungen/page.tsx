"use client";

// Einstellungen → Allgemein: Firmen-Bankdaten (SEPA-Auftraggeber) und die je
// Saisonjahr versionierten Sätze für Verpflegung/Unterkunft/Mindestlohn/
// Arbeitskleidung. Arbeitsgruppen, Herkünfte und Nutzer & Rollen sind eigene
// Unterseiten (components/EinstellungenTabs.tsx).

import { useEffect, useState } from "react";
import { formatMenge } from "@/lib/format";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import type { FirmenBankdaten, VerpflegungsSatz } from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

export default function EinstellungenAllgemeinPage() {
  const { profile } = useProfile();
  const isAdmin = profile?.role === "admin";

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
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const [{ data, error }, { data: bankdatenData }] = await Promise.all([
      supabase
        .from("verpflegungssaetze")
        .select("*")
        .order("saison_jahr", { ascending: false }),
      supabase.from("firmen_bankdaten").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (!error) setSaetze((data as VerpflegungsSatz[]) ?? []);
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
    const { error } = await getSupabaseClient()
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
        <h1 className="text-lg font-semibold text-emerald-800">
          Einstellungen – Allgemein
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Firmen-Bankdaten für den SEPA-Export sowie die je Saisonjahr
          versionierten Sätze (ADR-007) für Verpflegung, Unterkunft,
          Mindestlohn und Arbeitskleidung. Änderungen wirken nur auf das
          jeweilige Saisonjahr; bereits berechnete Jahre bleiben unverändert.
          Der Mindestlohn wird beim Neuanlegen einer Person als Stundenlohn
          vorbelegt, bleibt dort aber änderbar.
        </p>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-emerald-800">
          Firmen-Bankdaten
        </h2>
        <p className="text-sm text-neutral-500">
          Auftraggeber-Konto für den SEPA-Überweisungs-Export bei Vorschüssen
          (Zahlungsart Banküberweisung). Nur admin/kasse können diese Daten
          lesen.
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
    </div>
  );
}
