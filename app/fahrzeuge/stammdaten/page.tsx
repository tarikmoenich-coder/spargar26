"use client";

import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import type { Fahrzeug, FahrzeugTracker } from "@/lib/types";
import FahrzeugeTabs from "@/components/FahrzeugeTabs";
import PageHeader from "@/components/PageHeader";

const TYPEN = ["pkw", "transporter", "traktor", "anhaenger", "sonstiges"];

type EmpOpt = {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
};

interface FahrzeugForm {
  bezeichnung: string;
  kennzeichen: string;
  typ: string;
  fahrer_employee_id: string;
  km_stand: string;
  km_stand_am: string;
  hu_faellig: string;
  vin: string;
  baujahr: string;
  notiz: string;
  aktiv: boolean;
}

function leereForm(): FahrzeugForm {
  return {
    bezeichnung: "",
    kennzeichen: "",
    typ: "",
    fahrer_employee_id: "",
    km_stand: "",
    km_stand_am: "",
    hu_faellig: "",
    vin: "",
    baujahr: "",
    notiz: "",
    aktiv: true,
  };
}

function ausFahrzeug(f: Fahrzeug): FahrzeugForm {
  return {
    bezeichnung: f.bezeichnung,
    kennzeichen: f.kennzeichen ?? "",
    typ: f.typ ?? "",
    fahrer_employee_id: f.fahrer_employee_id ?? "",
    km_stand: f.km_stand?.toString() ?? "",
    km_stand_am: f.km_stand_am ?? "",
    hu_faellig: f.hu_faellig ?? "",
    vin: f.vin ?? "",
    baujahr: f.baujahr?.toString() ?? "",
    notiz: f.notiz ?? "",
    aktiv: f.aktiv,
  };
}

export default function FahrzeugeStammdatenPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [fahrzeuge, setFahrzeuge] = useState<Fahrzeug[]>([]);
  const [tracker, setTracker] = useState<FahrzeugTracker[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<EmpOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [bearbeiten, setBearbeiten] = useState<Fahrzeug | "neu" | null>(null);
  const [form, setForm] = useState<FahrzeugForm>(leereForm());
  const [speichert, setSpeichert] = useState(false);

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    const [f, t, m] = await Promise.all([
      supabase.from("fahrzeug").select("*").order("bezeichnung"),
      supabase
        .from("fahrzeug_tracker")
        .select("*")
        .order("zuletzt_gesehen", { ascending: false, nullsFirst: false }),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname")
        .eq("aktiv", true)
        .order("name"),
    ]);
    setFahrzeuge((f.data as Fahrzeug[]) ?? []);
    setTracker((t.data as FahrzeugTracker[]) ?? []);
    setMitarbeiter((m.data as EmpOpt[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  function starteBearbeiten(f: Fahrzeug | "neu") {
    setBearbeiten(f);
    setForm(f === "neu" ? leereForm() : ausFahrzeug(f));
    setFehler(null);
  }

  async function speichern() {
    if (!form.bezeichnung.trim()) {
      setFehler("Bezeichnung ist ein Pflichtfeld.");
      return;
    }
    setSpeichert(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const daten = {
      bezeichnung: form.bezeichnung.trim(),
      kennzeichen: form.kennzeichen.trim() || null,
      typ: form.typ || null,
      fahrer_employee_id: form.fahrer_employee_id || null,
      km_stand: form.km_stand === "" ? null : Number(form.km_stand),
      km_stand_am: form.km_stand_am || null,
      hu_faellig: form.hu_faellig || null,
      vin: form.vin.trim() || null,
      baujahr: form.baujahr === "" ? null : Number(form.baujahr),
      notiz: form.notiz.trim() || null,
      aktiv: form.aktiv,
    };
    const { error } =
      bearbeiten === "neu"
        ? await supabase.from("fahrzeug").insert(daten)
        : await supabase
            .from("fahrzeug")
            .update(daten)
            .eq("id", (bearbeiten as Fahrzeug).id);
    setSpeichert(false);
    if (error) {
      setFehler(error.message);
      return;
    }
    setBearbeiten(null);
    laden();
  }

  async function trackerZuordnen(t: FahrzeugTracker, fahrzeugId: string) {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("fahrzeug_tracker")
      .update({ fahrzeug_id: fahrzeugId === "" ? null : Number(fahrzeugId) })
      .eq("traccar_unique_id", t.traccar_unique_id);
    if (error) {
      setFehler(
        error.message.includes("idx_fahrzeug_tracker_fahrzeug")
          ? "Dieses Fahrzeug hat bereits einen Tracker."
          : error.message
      );
      return;
    }
    setFehler(null);
    laden();
  }

  const belegt = new Set(
    tracker.filter((t) => t.fahrzeug_id != null).map((t) => t.fahrzeug_id)
  );

  return (
    <div className="flex flex-col gap-4">
      <FahrzeugeTabs />
      <PageHeader
        icon={Truck}
        titel="Fahrzeuge – Stammdaten"
        beschreibung="Fahrzeuge anlegen, Fahrer / Kennzeichen / km-Stand / nächste HU pflegen und GPS-Tracker zuordnen."
      />

      {fehler && (
        <p className="text-sm font-medium text-red-600">⚠ {fehler}</p>
      )}
      {!canEdit && (
        <p className="text-xs text-amber-700">
          Deine Rolle darf Stammdaten nur ansehen.
        </p>
      )}

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <>
          {/* ---- Fahrzeuge ---- */}
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-emerald-800">
              Fahrzeuge ({fahrzeuge.length})
            </h2>
            {canEdit && bearbeiten === null && (
              <button
                type="button"
                className="btn"
                onClick={() => starteBearbeiten("neu")}
              >
                + Neues Fahrzeug
              </button>
            )}
          </div>

          {bearbeiten !== null && (
            <div className="card flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Bezeichnung*
                  <input
                    className="mt-1 w-full"
                    value={form.bezeichnung}
                    onChange={(e) =>
                      setForm({ ...form, bezeichnung: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Kennzeichen
                  <input
                    className="mt-1 w-full"
                    value={form.kennzeichen}
                    onChange={(e) =>
                      setForm({ ...form, kennzeichen: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Typ
                  <select
                    className="mt-1 w-full"
                    value={form.typ}
                    onChange={(e) => setForm({ ...form, typ: e.target.value })}
                  >
                    <option value="">—</option>
                    {TYPEN.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  Fahrer
                  <select
                    className="mt-1 w-full"
                    value={form.fahrer_employee_id}
                    onChange={(e) =>
                      setForm({ ...form, fahrer_employee_id: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {mitarbeiter.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}, {m.vorname} ({m.personal_nr})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  km-Stand
                  <input
                    type="number"
                    className="mt-1 w-full"
                    value={form.km_stand}
                    onChange={(e) =>
                      setForm({ ...form, km_stand: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  km-Stand am
                  <input
                    type="date"
                    className="mt-1 w-full"
                    value={form.km_stand_am}
                    onChange={(e) =>
                      setForm({ ...form, km_stand_am: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Nächste HU
                  <input
                    type="date"
                    className="mt-1 w-full"
                    value={form.hu_faellig}
                    onChange={(e) =>
                      setForm({ ...form, hu_faellig: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm">
                  Baujahr
                  <input
                    type="number"
                    className="mt-1 w-full"
                    value={form.baujahr}
                    onChange={(e) =>
                      setForm({ ...form, baujahr: e.target.value })
                    }
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  VIN / Fahrgestellnummer
                  <input
                    className="mt-1 w-full"
                    value={form.vin}
                    onChange={(e) => setForm({ ...form, vin: e.target.value })}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  Notiz
                  <textarea
                    className="mt-1 w-full"
                    rows={2}
                    value={form.notiz}
                    onChange={(e) =>
                      setForm({ ...form, notiz: e.target.value })
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.aktiv}
                    onChange={(e) =>
                      setForm({ ...form, aktiv: e.target.checked })
                    }
                  />
                  aktiv
                </label>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={speichert || !canEdit}
                  onClick={speichern}
                >
                  {speichert ? "Speichert …" : "Speichern"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setBearbeiten(null)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Bezeichnung</th>
                  <th>Kennzeichen</th>
                  <th>Typ</th>
                  <th>Fahrer</th>
                  <th>km</th>
                  <th>Nächste HU</th>
                  <th>Tracker</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fahrzeuge.map((f) => {
                  const t = tracker.find((x) => x.fahrzeug_id === f.id);
                  const fahrer = mitarbeiter.find(
                    (m) => m.id === f.fahrer_employee_id
                  );
                  return (
                    <tr key={f.id} className={f.aktiv ? "" : "opacity-50"}>
                      <td>{f.bezeichnung}</td>
                      <td>{f.kennzeichen ?? "—"}</td>
                      <td>{f.typ ?? "—"}</td>
                      <td>
                        {fahrer ? `${fahrer.name}, ${fahrer.vorname}` : "—"}
                      </td>
                      <td>
                        {f.km_stand != null
                          ? f.km_stand.toLocaleString("de-DE")
                          : "—"}
                      </td>
                      <td>
                        {f.hu_faellig ? formatDatumDE(f.hu_faellig) : "—"}
                      </td>
                      <td className="text-sm">
                        {t
                          ? `${t.traccar_unique_id}${
                              t.geraetetyp ? ` (${t.geraetetyp})` : ""
                            }`
                          : "—"}
                      </td>
                      <td>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn-secondary text-xs"
                            onClick={() => starteBearbeiten(f)}
                          >
                            Bearbeiten
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {fahrzeuge.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-neutral-500">
                      Noch keine Fahrzeuge.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ---- Tracker ---- */}
          <h2 className="mt-4 text-base font-semibold text-emerald-800">
            GPS-Tracker ({tracker.length})
          </h2>
          <p className="text-sm text-neutral-500">
            Tracker erscheinen automatisch, sobald sie Daten an Traccar senden.
            Hier einem Fahrzeug zuordnen.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Traccar-ID</th>
                  <th>Bezeichnung</th>
                  <th>Typ</th>
                  <th>Status</th>
                  <th>Zuletzt gesehen</th>
                  <th>Fahrzeug</th>
                </tr>
              </thead>
              <tbody>
                {tracker.map((t) => (
                  <tr key={t.traccar_unique_id}>
                    <td className="font-mono text-xs">
                      {t.traccar_unique_id}
                    </td>
                    <td>{t.bezeichnung ?? "—"}</td>
                    <td>{t.geraetetyp ?? "—"}</td>
                    <td
                      className={
                        t.status === "online"
                          ? "text-emerald-700"
                          : "text-neutral-500"
                      }
                    >
                      {t.status ?? "—"}
                    </td>
                    <td className="text-sm">
                      {t.zuletzt_gesehen
                        ? new Date(t.zuletzt_gesehen).toLocaleString("de-DE")
                        : "—"}
                    </td>
                    <td>
                      <select
                        value={t.fahrzeug_id?.toString() ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => trackerZuordnen(t, e.target.value)}
                      >
                        <option value="">— nicht zugeordnet —</option>
                        {fahrzeuge.map((f) => (
                          <option
                            key={f.id}
                            value={f.id}
                            disabled={
                              belegt.has(f.id) && t.fahrzeug_id !== f.id
                            }
                          >
                            {f.bezeichnung}
                            {f.kennzeichen ? ` (${f.kennzeichen})` : ""}
                            {belegt.has(f.id) && t.fahrzeug_id !== f.id
                              ? " – hat Tracker"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {tracker.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-neutral-500">
                      Noch keine Tracker gemeldet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
