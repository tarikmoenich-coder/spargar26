"use client";

import { Fragment, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import {
  ABRECHNUNGSART_LABELS,
  DOKUMENT_KATEGORIEN,
  type Abrechnungsart,
  type Arbeitsgruppe,
  type Employee,
  type EmployeeDocument,
  type Herkunft,
  type SvPruefung,
} from "@/lib/types";
import {
  ANZAHL_PERSONALNUMMERN_KREISE,
  kreisBereich,
  naechsteFreieNummer,
  parsePersonalNrNummer,
} from "@/lib/personalnummern";
import { formatDatumDE } from "@/lib/format";
import PersonalTabs from "@/components/PersonalTabs";

const CURRENT_YEAR = new Date().getFullYear();
const DOKUMENTE_BUCKET = "mitarbeiter-dokumente";

const emptyForm = {
  personal_nr: "",
  gruppe_nr: "",
  herkunft: "",
  name: "",
  vorname: "",
  geburtsdatum: "",
  ort: "",
  land: "",
  stundenlohn: "",
  abrechnungsart: "sozialversicherungspflichtig" as Abrechnungsart,
  sozialversicherungsnummer: "",
  steuer_id: "",
  iban: "",
  bic: "",
  zahlungsempfaenger: "",
};

export default function MitarbeiterPage() {
  const { profile } = useProfile();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [gruppen, setGruppen] = useState<Arbeitsgruppe[]>([]);
  const [herkuenfte, setHerkuenfte] = useState<Herkunft[]>([]);
  const [aktivSeit, setAktivSeit] = useState<Record<string, string>>({});
  const [letzteAbrechnung, setLetzteAbrechnung] = useState<
    Record<string, string>
  >({});
  const [svPruefung, setSvPruefung] = useState<Record<string, SvPruefung>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Alle je vergebenen Personalnummern (auch inaktive Mitarbeiter, da deren
  // Nummer nicht neu vergeben wird) - für Dubletten-Warnung + "nächste freie
  // Nummer"-Hilfe.
  const [allePersonalNummern, setAllePersonalNummern] = useState<
    { personal_nr: string; name: string; vorname: string }[]
  >([]);
  const [naechsteKreis, setNaechsteKreis] = useState("1");

  // Dokumenten-Upload je Mitarbeiter (z.B. Hochzeitsurkunde, Ausweiskopie).
  const [dokumenteOffenId, setDokumenteOffenId] = useState<string | null>(
    null
  );
  const [dokumente, setDokumente] = useState<
    Record<string, EmployeeDocument[]>
  >({});
  const [dokumentKategorie, setDokumentKategorie] = useState<string>(
    DOKUMENT_KATEGORIEN[0]
  );
  const [dokumentDatei, setDokumentDatei] = useState<File | null>(null);
  const [dateiEingabeSchluessel, setDateiEingabeSchluessel] = useState(0);
  const [dokumentLaeuft, setDokumentLaeuft] = useState(false);
  const [dokumentFehler, setDokumentFehler] = useState<string | null>(null);

  const canEdit = profile?.role === "admin" || profile?.role === "hr";
  const gruppenLabel: Record<string, string> = Object.fromEntries(
    gruppen.map((g) => [g.gruppe_nr, g.bezeichnung])
  );

  const personalNrKonflikt = (() => {
    const typed = form.personal_nr.trim().toLowerCase();
    if (!typed) return null;
    const eigeneNr = editingId
      ? employees
          .find((e) => e.id === editingId)
          ?.personal_nr.trim()
          .toLowerCase()
      : null;
    if (eigeneNr && typed === eigeneNr) return null; // unverändert beim Bearbeiten
    return (
      allePersonalNummern.find(
        (r) => r.personal_nr.trim().toLowerCase() === typed
      ) ?? null
    );
  })();

  async function load() {
    setLoading(true);
    const supabase = getSupabaseClient();
    let query = supabase.from("employees").select("*").order("name");
    if (!showInactive) query = query.eq("aktiv", true);
    const [
      { data, error },
      { data: ersteTage },
      { data: abrechnungen },
      { data: gruppenData },
      { data: herkunftData },
      { data: alleNrData },
      { data: svData },
    ] = await Promise.all([
      query,
      supabase.from("employee_erster_arbeitstag").select("*"),
      supabase.from("employee_letzte_abrechnung").select("*"),
      supabase.from("arbeitsgruppen").select("*").order("reihenfolge"),
      supabase.from("herkuenfte").select("*").order("reihenfolge"),
      supabase.from("employees").select("personal_nr, name, vorname"),
      supabase
        .from("employee_sv_pruefung")
        .select("*")
        .eq("saison_jahr", CURRENT_YEAR),
    ]);
    if (!error) setEmployees((data as Employee[]) ?? []);
    const map: Record<string, string> = {};
    (ersteTage ?? []).forEach((row: { employee_id: string; erster_arbeitstag: string }) => {
      map[row.employee_id] = row.erster_arbeitstag;
    });
    setAktivSeit(map);
    const abrechnungMap: Record<string, string> = {};
    (abrechnungen ?? []).forEach(
      (row: { employee_id: string; abgerechnet_am: string }) => {
        abrechnungMap[row.employee_id] = row.abgerechnet_am;
      }
    );
    setLetzteAbrechnung(abrechnungMap);
    setGruppen((gruppenData as Arbeitsgruppe[]) ?? []);
    setHerkuenfte((herkunftData as Herkunft[]) ?? []);
    setAllePersonalNummern(alleNrData ?? []);
    const svMap: Record<string, SvPruefung> = {};
    (svData as SvPruefung[] | null ?? []).forEach((row) => {
      svMap[row.employee_id] = row;
    });
    setSvPruefung(svMap);
    setLoading(false);
  }

  function naechsteFreieUebernehmen() {
    const belegt = new Set<number>();
    allePersonalNummern.forEach((r) => {
      const n = parsePersonalNrNummer(r.personal_nr);
      if (n !== null) belegt.add(n);
    });
    const frei = naechsteFreieNummer(belegt, Number(naechsteKreis));
    if (frei !== null) {
      setForm((f) => ({ ...f, personal_nr: frei.toString() }));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInactive]);

  function startEdit(emp: Employee) {
    setEditingId(emp.id);
    setForm({
      personal_nr: emp.personal_nr,
      gruppe_nr: emp.gruppe_nr ?? "",
      herkunft: emp.herkunft ?? "",
      name: emp.name,
      vorname: emp.vorname,
      geburtsdatum: emp.geburtsdatum ?? "",
      ort: emp.ort ?? "",
      land: emp.land ?? "",
      stundenlohn: emp.stundenlohn?.toString() ?? "",
      abrechnungsart: emp.abrechnungsart ?? "sozialversicherungspflichtig",
      sozialversicherungsnummer: emp.sozialversicherungsnummer ?? "",
      steuer_id: emp.steuer_id ?? "",
      iban: emp.iban ?? "",
      bic: emp.bic ?? "",
      zahlungsempfaenger: emp.zahlungsempfaenger ?? "",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const supabase = getSupabaseClient();
    const payload = {
      personal_nr: form.personal_nr,
      gruppe_nr: form.gruppe_nr || null,
      herkunft: form.herkunft || null,
      name: form.name,
      vorname: form.vorname,
      geburtsdatum: form.geburtsdatum || null,
      ort: form.ort || null,
      land: form.land || null,
      stundenlohn: form.stundenlohn ? Number(form.stundenlohn) : null,
      abrechnungsart: form.abrechnungsart,
      sozialversicherungsnummer: form.sozialversicherungsnummer || null,
      steuer_id: form.steuer_id || null,
      iban: form.iban || null,
      bic: form.bic || null,
      zahlungsempfaenger: form.zahlungsempfaenger || null,
    };

    const { error } = editingId
      ? await supabase.from("employees").update(payload).eq("id", editingId)
      : await supabase.from("employees").insert(payload);

    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    resetForm();
    load();
  }

  async function toggleDokumente(emp: Employee) {
    if (dokumenteOffenId === emp.id) {
      setDokumenteOffenId(null);
      return;
    }
    setDokumenteOffenId(emp.id);
    setDokumentFehler(null);
    if (!dokumente[emp.id]) {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_documents")
        .select("*")
        .eq("employee_id", emp.id)
        .order("hochgeladen_am", { ascending: false });
      if (!error) {
        setDokumente((prev) => ({
          ...prev,
          [emp.id]: (data as EmployeeDocument[]) ?? [],
        }));
      }
    }
  }

  async function dokumentHochladen(employeeId: string) {
    if (!dokumentDatei) return;
    setDokumentLaeuft(true);
    setDokumentFehler(null);
    const supabase = getSupabaseClient();
    const pfad = `${employeeId}/${Date.now()}_${dokumentDatei.name}`;
    const { error: uploadError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .upload(pfad, dokumentDatei);
    if (uploadError) {
      setDokumentFehler(uploadError.message);
      setDokumentLaeuft(false);
      return;
    }
    const { error: insertError } = await supabase
      .from("employee_documents")
      .insert({
        employee_id: employeeId,
        kategorie: dokumentKategorie,
        dateiname: dokumentDatei.name,
        storage_path: pfad,
      });
    if (insertError) {
      setDokumentFehler(insertError.message);
      // Bereits hochgeladene Datei wieder entfernen, damit keine
      // verwaiste Datei ohne Datenbank-Eintrag im Bucket liegen bleibt.
      await supabase.storage.from(DOKUMENTE_BUCKET).remove([pfad]);
      setDokumentLaeuft(false);
      return;
    }
    setDokumentDatei(null);
    setDateiEingabeSchluessel((k) => k + 1);
    setDokumentLaeuft(false);
    const { data } = await supabase
      .from("employee_documents")
      .select("*")
      .eq("employee_id", employeeId)
      .order("hochgeladen_am", { ascending: false });
    setDokumente((prev) => ({
      ...prev,
      [employeeId]: (data as EmployeeDocument[]) ?? [],
    }));
  }

  async function dokumentHerunterladen(doc: EmployeeDocument) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data) {
      window.alert(`Download fehlgeschlagen: ${error?.message ?? "unbekannter Fehler"}`);
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function dokumentLoeschen(doc: EmployeeDocument) {
    if (!window.confirm(`"${doc.dateiname}" (${doc.kategorie}) wirklich löschen?`)) {
      return;
    }
    const supabase = getSupabaseClient();
    const { error: storageError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .remove([doc.storage_path]);
    if (storageError) {
      window.alert(`Löschen fehlgeschlagen: ${storageError.message}`);
      return;
    }
    await supabase.from("employee_documents").delete().eq("id", doc.id);
    setDokumente((prev) => ({
      ...prev,
      [doc.employee_id]: (prev[doc.employee_id] ?? []).filter(
        (d) => d.id !== doc.id
      ),
    }));
  }

  async function toggleActive(emp: Employee) {
    // ADR-011: kein Löschen, nur Deaktivieren/Reaktivieren - Historie bleibt.
    const supabase = getSupabaseClient();
    await supabase
      .from("employees")
      .update({ aktiv: !emp.aktiv })
      .eq("id", emp.id);
    load();
  }

  const filtered = employees.filter((e) => {
    const q = search.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.vorname.toLowerCase().includes(q) ||
      e.personal_nr.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex flex-col gap-6">
      <PersonalTabs />
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">Personal</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten der Mitarbeiter. Löschen ist nicht möglich - Personen
          werden bei Bedarf deaktiviert, die Historie bleibt erhalten.
        </p>
      </div>

      {canEdit && (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-2 gap-3 rounded border border-neutral-200 bg-white p-4 sm:grid-cols-4"
        >
          <div className="col-span-2 flex flex-col gap-1">
            <div className="flex gap-2">
              <input
                placeholder="Personalnummer"
                required
                value={form.personal_nr}
                onChange={(e) =>
                  setForm({ ...form, personal_nr: e.target.value })
                }
              />
              {!editingId && (
                <>
                  <select
                    value={naechsteKreis}
                    onChange={(e) => setNaechsteKreis(e.target.value)}
                  >
                    {Array.from(
                      { length: ANZAHL_PERSONALNUMMERN_KREISE },
                      (_, i) => i + 1
                    ).map((k) => {
                      const [von, bis] = kreisBereich(k);
                      return (
                        <option key={k} value={k}>
                          Kreis {k} ({von}-{bis})
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
                Bereits vergeben an {personalNrKonflikt.name},{" "}
                {personalNrKonflikt.vorname}
              </span>
            )}
          </div>
          <select
            value={form.gruppe_nr}
            onChange={(e) => setForm({ ...form, gruppe_nr: e.target.value })}
          >
            <option value="">— keine Gruppe —</option>
            {gruppen.map((g) => (
              <option key={g.gruppe_nr} value={g.gruppe_nr}>
                {g.gruppe_nr} – {g.bezeichnung}
              </option>
            ))}
          </select>
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
          <input
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Vorname"
            required
            value={form.vorname}
            onChange={(e) => setForm({ ...form, vorname: e.target.value })}
          />
          <input
            type="date"
            placeholder="Geburtsdatum"
            value={form.geburtsdatum}
            onChange={(e) =>
              setForm({ ...form, geburtsdatum: e.target.value })
            }
          />
          <input
            placeholder="Ort"
            value={form.ort}
            onChange={(e) => setForm({ ...form, ort: e.target.value })}
          />
          <input
            placeholder="Land"
            value={form.land}
            onChange={(e) => setForm({ ...form, land: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Stundenlohn €"
            value={form.stundenlohn}
            onChange={(e) =>
              setForm({ ...form, stundenlohn: e.target.value })
            }
          />
          <select
            value={form.abrechnungsart}
            onChange={(e) =>
              setForm({
                ...form,
                abrechnungsart: e.target.value as Abrechnungsart,
              })
            }
          >
            {Object.entries(ABRECHNUNGSART_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            placeholder="Sozialversicherungsnummer"
            value={form.sozialversicherungsnummer}
            onChange={(e) =>
              setForm({ ...form, sozialversicherungsnummer: e.target.value })
            }
          />
          <input
            placeholder="Steuer-ID"
            value={form.steuer_id}
            onChange={(e) => setForm({ ...form, steuer_id: e.target.value })}
          />
          <input
            placeholder="IBAN"
            value={form.iban}
            onChange={(e) => setForm({ ...form, iban: e.target.value })}
          />
          <input
            placeholder="BIC"
            value={form.bic}
            onChange={(e) => setForm({ ...form, bic: e.target.value })}
          />
          <input
            placeholder="Zahlungsempfänger"
            value={form.zahlungsempfaenger}
            onChange={(e) =>
              setForm({ ...form, zahlungsempfaenger: e.target.value })
            }
          />
          <div className="col-span-full flex gap-2">
            <button
              type="submit"
              className="btn"
              disabled={saving || !!personalNrKonflikt}
            >
              {editingId ? "Speichern" : "Anlegen"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetForm}
              >
                Abbrechen
              </button>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      )}

      <div className="flex items-center gap-3">
        <input
          placeholder="Suche nach Name oder Personalnummer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          inaktive anzeigen
        </label>
      </div>

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Pers.-Nr.</th>
              <th>Gruppe</th>
              <th>Herkunft</th>
              <th>Name</th>
              <th>Vorname</th>
              <th>Ort</th>
              <th>€/Std.</th>
              <th>Abrechnungsart</th>
              <th>Aktiv seit</th>
              <th>Zuletzt abgerechnet am</th>
              <th>Rest bis 90 Tage</th>
              <th>Austrittsdatum (15 Wo.)</th>
              <th>SV-Status</th>
              <th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((emp) => {
              const sv = svPruefung[emp.id];
              return (
              <Fragment key={emp.id}>
              <tr className={emp.aktiv ? "" : "opacity-50"}>
                <td>{emp.personal_nr}</td>
                <td>
                  {emp.gruppe_nr
                    ? `${emp.gruppe_nr} – ${
                        gruppenLabel[emp.gruppe_nr] ?? "?"
                      }`
                    : "—"}
                </td>
                <td>{emp.herkunft ?? "—"}</td>
                <td>{emp.name}</td>
                <td>{emp.vorname}</td>
                <td>{emp.ort}</td>
                <td>{emp.stundenlohn?.toFixed(2)}</td>
                <td>{ABRECHNUNGSART_LABELS[emp.abrechnungsart]}</td>
                <td>{formatDatumDE(aktivSeit[emp.id])}</td>
                <td>{formatDatumDE(letzteAbrechnung[emp.id])}</td>
                <td>{sv ? sv.rest_bis_90_tage : "—"}</td>
                <td>{sv ? formatDatumDE(sv.austrittsdatum_15_wochen) : "—"}</td>
                <td>
                  {sv ? (
                    sv.kritisch ? (
                      <span className="font-medium text-red-600">
                        ⚠ Überschritten
                      </span>
                    ) : (
                      <span className="text-emerald-700">OK</span>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td>{emp.aktiv ? "aktiv" : "inaktiv"}</td>
                {canEdit && (
                  <td className="flex gap-2">
                    <button
                      className="btn-secondary"
                      onClick={() => startEdit(emp)}
                    >
                      Bearbeiten
                    </button>
                    <button
                      className={emp.aktiv ? "btn-danger" : "btn-secondary"}
                      onClick={() => toggleActive(emp)}
                    >
                      {emp.aktiv ? "Deaktivieren" : "Reaktivieren"}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => toggleDokumente(emp)}
                    >
                      {dokumenteOffenId === emp.id ? "Schließen" : "Dokumente"}
                      {dokumente[emp.id] && dokumente[emp.id].length > 0
                        ? ` (${dokumente[emp.id].length})`
                        : ""}
                    </button>
                  </td>
                )}
              </tr>
              {dokumenteOffenId === emp.id && (
                <tr>
                  <td colSpan={15} className="bg-neutral-50">
                    <div className="flex flex-col gap-3 py-2">
                      <p className="text-xs text-neutral-500">
                        Dokumente zu {emp.name}, {emp.vorname} - nur für
                        admin/hr sichtbar. Downloads laufen über zeitlich
                        begrenzte Links.
                      </p>
                      {!dokumente[emp.id] ? (
                        <p className="text-sm text-neutral-500">Lädt…</p>
                      ) : dokumente[emp.id].length === 0 ? (
                        <p className="text-sm text-neutral-500">
                          Noch keine Dokumente hochgeladen.
                        </p>
                      ) : (
                        <table>
                          <thead>
                            <tr>
                              <th>Kategorie</th>
                              <th>Dateiname</th>
                              <th>Hochgeladen am</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {dokumente[emp.id].map((doc) => (
                              <tr key={doc.id}>
                                <td>{doc.kategorie}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="text-emerald-700 underline"
                                    onClick={() => dokumentHerunterladen(doc)}
                                  >
                                    {doc.dateiname}
                                  </button>
                                </td>
                                <td>{formatDatumDE(doc.hochgeladen_am)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn-danger text-xs"
                                    onClick={() => dokumentLoeschen(doc)}
                                  >
                                    Löschen
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={dokumentKategorie}
                          onChange={(e) => setDokumentKategorie(e.target.value)}
                        >
                          {DOKUMENT_KATEGORIEN.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <input
                          key={dateiEingabeSchluessel}
                          type="file"
                          onChange={(e) =>
                            setDokumentDatei(e.target.files?.[0] ?? null)
                          }
                        />
                        <button
                          type="button"
                          className="btn text-xs"
                          disabled={!dokumentDatei || dokumentLaeuft}
                          onClick={() => dokumentHochladen(emp.id)}
                        >
                          Hochladen
                        </button>
                        {dokumentFehler && (
                          <span className="text-sm text-red-600">
                            {dokumentFehler}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
