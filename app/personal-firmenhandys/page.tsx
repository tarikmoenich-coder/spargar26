"use client";

// Firmenhandy-Nummernpool (Nutzer-Vorgabe 2026-09-17): ~200 Rufnummern,
// davon ~50 teils private Smartphones der Mitarbeiter, deren Nutzer sich in
// der Saison mehrmals ändert. Wird per CardDAV automatisch in ein selbst
// gehostetes Nextcloud-Adressbuch gespiegelt (app/api/firmenhandy-sync) -
// bewusst nicht über Google (Absprache im Chat). Schlank gehalten: nur
// Nummer + aktueller Inhaber, keine Historie/Geräte-Details.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Smartphone } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import PageHeader from "@/components/PageHeader";
import PersonalTabs from "@/components/PersonalTabs";
import type { Firmenhandy } from "@/lib/types";

type EmpOpt = {
  id: string;
  personal_nr: string;
  name: string;
  vorname: string;
};

function anzeigeName(m: EmpOpt | undefined): string | null {
  return m ? `${m.name}, ${m.vorname}` : null;
}

// Inhaber-Zuweisung direkt in der Liste - freie Suche nach Name/Personalnr.,
// gleiches Muster wie FahrerZelle bei den Fahrzeug-Stammdaten.
function InhaberZelle({
  firmenhandy,
  mitarbeiter,
  canEdit,
  onGesetzt,
}: {
  firmenhandy: Firmenhandy;
  mitarbeiter: EmpOpt[];
  canEdit: boolean;
  onGesetzt: () => void;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState("");
  const [speichert, setSpeichert] = useState(false);

  const aktuell = mitarbeiter.find((m) => m.id === firmenhandy.employee_id);

  const treffer = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const liste = q
      ? mitarbeiter.filter(
          (m) =>
            `${m.name} ${m.vorname}`.toLowerCase().includes(q) ||
            `${m.vorname} ${m.name}`.toLowerCase().includes(q) ||
            (m.personal_nr ?? "").toLowerCase().includes(q)
        )
      : mitarbeiter;
    return liste.slice(0, 8);
  }, [suche, mitarbeiter]);

  async function setze(id: string | null) {
    setSpeichert(true);
    const { error } = await getSupabaseClient()
      .from("firmenhandy")
      .update({ employee_id: id, sync_status: "ausstehend" })
      .eq("id", firmenhandy.id);
    setSpeichert(false);
    if (!error) {
      setOffen(false);
      setSuche("");
      onGesetzt();
    }
  }

  if (!canEdit) {
    return <>{anzeigeName(aktuell) ?? "—"}</>;
  }

  if (!offen) {
    return (
      <button
        type="button"
        className="text-left hover:underline"
        onClick={() => setOffen(true)}
      >
        {anzeigeName(aktuell) ?? <span className="text-emerald-700">+ Inhaber</span>}
      </button>
    );
  }

  return (
    <div className="flex min-w-[13rem] flex-col gap-1">
      <input
        autoFocus
        className="w-full text-sm"
        placeholder="Name oder Personalnr."
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
      />
      <div className="max-h-44 overflow-auto rounded border border-linie bg-white">
        {treffer.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={speichert}
            className="block w-full px-2 py-1 text-left text-sm hover:bg-sand disabled:opacity-50"
            onClick={() => setze(m.id)}
          >
            {m.name}, {m.vorname}{" "}
            <span className="text-neutral-400">({m.personal_nr})</span>
          </button>
        ))}
        {treffer.length === 0 && (
          <p className="px-2 py-1 text-sm text-neutral-400">nichts gefunden</p>
        )}
      </div>
      <div className="flex gap-3 text-xs">
        {firmenhandy.employee_id && (
          <button
            type="button"
            className="text-red-600"
            disabled={speichert}
            onClick={() => setze(null)}
          >
            Inhaber entfernen
          </button>
        )}
        <button
          type="button"
          className="text-neutral-500"
          onClick={() => {
            setOffen(false);
            setSuche("");
          }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

function syncBadge(status: Firmenhandy["sync_status"]) {
  if (status === "ok") return <span className="badge badge-ok">✓ synchron</span>;
  if (status === "fehler") return <span className="badge badge-danger">⚠ Fehler</span>;
  return <span className="badge badge-neutral">ausstehend</span>;
}

export default function FirmenhandyPage() {
  const { profile } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [firmenhandys, setFirmenhandys] = useState<Firmenhandy[]>([]);
  const [mitarbeiter, setMitarbeiter] = useState<EmpOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  const [neueNummer, setNeueNummer] = useState("");
  const [anlegen, setAnlegen] = useState(false);
  const [syncLaeuft, setSyncLaeuft] = useState(false);
  const [syncHinweis, setSyncHinweis] = useState<string | null>(null);
  // Einklappbar wie "Sätze verwalten" bei Prämien Zuckermais - wird nur
  // selten gebraucht (einmal pro Handy), soll die Liste nicht überladen.
  const [anleitungOffen, setAnleitungOffen] = useState(false);

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [f, m] = await Promise.all([
      supabase.from("firmenhandy").select("*").order("nummer"),
      supabase
        .from("employees")
        .select("id, personal_nr, name, vorname")
        .eq("aktiv", true)
        .order("name"),
    ]);
    setFirmenhandys((f.data as Firmenhandy[]) ?? []);
    setMitarbeiter((m.data as EmpOpt[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  const mitarbeiterMap = useMemo(
    () => new Map(mitarbeiter.map((m) => [m.id, m])),
    [mitarbeiter]
  );

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return firmenhandys;
    return firmenhandys.filter((f) => {
      const inhaber = anzeigeName(mitarbeiterMap.get(f.employee_id ?? ""));
      return (
        f.nummer.toLowerCase().includes(q) ||
        (inhaber ?? "").toLowerCase().includes(q) ||
        (f.notiz ?? "").toLowerCase().includes(q)
      );
    });
  }, [firmenhandys, suche, mitarbeiterMap]);

  async function anlegenSpeichern() {
    const nummer = neueNummer.trim();
    if (!nummer) return;
    setAnlegen(true);
    setFehler(null);
    const { error } = await getSupabaseClient()
      .from("firmenhandy")
      .insert({ nummer });
    setAnlegen(false);
    if (error) {
      setFehler(
        error.code === "23505" ? "Diese Nummer ist schon erfasst." : error.message
      );
      return;
    }
    setNeueNummer("");
    laden();
  }

  async function loeschen(f: Firmenhandy) {
    if (!window.confirm(`Nummer ${f.nummer} wirklich aus dem Pool entfernen?`))
      return;
    const { error } = await getSupabaseClient()
      .from("firmenhandy")
      .delete()
      .eq("id", f.id);
    if (error) {
      setFehler(error.message);
      return;
    }
    laden();
  }

  // Ein oder mehrere Einträge per CardDAV synchronisieren (app/api/
  // firmenhandy-sync) und das Ergebnis in Supabase zurückschreiben.
  async function synchronisieren(ziel: Firmenhandy[]) {
    if (ziel.length === 0) return;
    setSyncLaeuft(true);
    setSyncHinweis(null);
    setFehler(null);
    try {
      const res = await fetch("/api/firmenhandy-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eintraege: ziel.map((f) => ({
            nummer: f.nummer,
            name: anzeigeName(mitarbeiterMap.get(f.employee_id ?? "")),
          })),
        }),
      });
      const daten = await res.json();
      if (!res.ok) {
        setFehler(daten?.error ?? "Sync fehlgeschlagen.");
        return;
      }
      const ergebnisse = daten.ergebnisse as {
        nummer: string;
        ok: boolean;
        fehler?: string;
      }[];
      const supabase = getSupabaseClient();
      const jetzt = new Date().toISOString();
      await Promise.all(
        ergebnisse.map((e) => {
          const f = ziel.find((z) => z.nummer === e.nummer);
          if (!f) return null;
          return supabase
            .from("firmenhandy")
            .update({
              sync_status: e.ok ? "ok" : "fehler",
              sync_am: jetzt,
              sync_fehler: e.ok ? null : e.fehler ?? "unbekannter Fehler",
            })
            .eq("id", f.id);
        })
      );
      const fehlgeschlagen = ergebnisse.filter((e) => !e.ok).length;
      setSyncHinweis(
        fehlgeschlagen === 0
          ? `${ergebnisse.length} Nummer(n) synchronisiert.`
          : `${ergebnisse.length - fehlgeschlagen} synchronisiert, ${fehlgeschlagen} fehlgeschlagen.`
      );
      laden();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Sync fehlgeschlagen.");
    } finally {
      setSyncLaeuft(false);
    }
  }

  const ausstehendAnzahl = firmenhandys.filter(
    (f) => f.sync_status !== "ok"
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PersonalTabs />
      <PageHeader
        icon={Smartphone}
        titel="Firmenhandys"
        beschreibung="Rufnummernpool mit aktuellem Inhaber. Wird automatisch per CardDAV in das Nextcloud-Adressbuch 'Firmenhandys' synchronisiert, damit die Firmenhandys der Mitarbeiter (DAVx5) immer den aktuellen Namen zur Nummer zeigen."
      />

      {fehler && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          ⚠ {fehler}
        </p>
      )}

      <div className="rounded border border-linie bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-emerald-800"
          onClick={() => setAnleitungOffen((v) => !v)}
        >
          Einrichtung auf dem Handy (einmalig, ca. 2–3 Minuten)
          <span className="text-neutral-400">{anleitungOffen ? "▲" : "▼"}</span>
        </button>
        {anleitungOffen && (
          <div className="flex flex-col gap-3 border-t border-linie px-3 py-3 text-sm text-neutral-700">
            <p>
              Die App <strong>DAVx⁵</strong> holt sich die aktuellen
              Namen/Nummern automatisch auf das Handy - in ein eigenes,
              zusätzliches Adressbuch, ohne die privaten Kontakte der Person
              zu berühren.
            </p>
            <div>
              <p className="font-medium">1. DAVx⁵ installieren</p>
              <p className="text-neutral-600">
                Kostenlos über{" "}
                <a
                  href="https://f-droid.org/packages/at.bitfire.davdroid/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 underline"
                >
                  F-Droid
                </a>{" "}
                (offizielle Quelle, immer aktuell) oder für ca. 4 € im{" "}
                <a
                  href="https://play.google.com/store/apps/details?id=at.bitfire.davdroid"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 underline"
                >
                  Google Play Store
                </a>
                . Über F-Droid muss zuerst einmalig die F-Droid-App installiert
                werden (Android fragt dabei nach Erlaubnis für „Installation
                aus unbekannten Quellen" - normal, da F-Droid nicht im Play
                Store ist).
              </p>
            </div>
            <div>
              <p className="font-medium">2. Konto hinzufügen</p>
              <p className="text-neutral-600">
                DAVx⁵ öffnen → „+" → „Anmelden mit URL und Benutzername":
              </p>
              <table className="mt-1">
                <tbody>
                  <tr>
                    <td className="pr-3 text-neutral-500">Basis-URL</td>
                    <td className="font-mono">
                      https://kontakte.spargelhof-moenich.de
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-3 text-neutral-500">Benutzername</td>
                    <td className="font-mono">
                      firmenkontakte@spargelhof-moenich.de
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-3 text-neutral-500">Passwort</td>
                    <td>vom Admin erfragen (App-Passwort)</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-1 text-neutral-600">
                Bei „Kontaktgruppen-Methode" die Option{" "}
                <strong>„Als Kategorien"</strong> wählen.
              </p>
            </div>
            <div>
              <p className="font-medium">3. Nur das richtige Adressbuch aktivieren</p>
              <p className="text-neutral-600">
                DAVx⁵ zeigt jetzt mehrere Adressbücher - nur bei{" "}
                <strong>„Firmenhandys"</strong> den Haken setzen, die anderen
                abwählen.
              </p>
            </div>
            <div>
              <p className="font-medium">4. Fertig</p>
              <p className="text-neutral-600">
                Nach kurzer Zeit (oder in DAVx⁵ manuell antippen → „Jetzt
                synchronisieren") erscheinen die Firmenhandy-Kontakte in der
                normalen Telefon-/Kontakte-App, als eigene Gruppe.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Suche: Nummer, Inhaber, Notiz …"
          className="w-64 text-sm"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
        />
        <span className="text-xs text-neutral-500">
          {gefiltert.length} von {firmenhandys.length}
        </span>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={syncLaeuft || firmenhandys.length === 0}
          onClick={() => synchronisieren(firmenhandys)}
        >
          {syncLaeuft
            ? "Synchronisiert…"
            : `Alle synchronisieren${ausstehendAnzahl > 0 ? ` (${ausstehendAnzahl} ausstehend)` : ""}`}
        </button>
        {syncHinweis && (
          <span className="text-xs text-neutral-500">{syncHinweis}</span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 rounded border border-linie bg-white p-3">
          <label className="text-sm">
            Neue Nummer
            <input
              className="mt-1 block w-48"
              placeholder="z. B. 0151 12345678"
              value={neueNummer}
              onChange={(e) => setNeueNummer(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn text-sm"
            disabled={anlegen || !neueNummer.trim()}
            onClick={anlegenSpeichern}
          >
            + Hinzufügen
          </button>
        </div>
      )}

      {loading ? (
        <p className="p-4 text-sm text-neutral-500">Lädt …</p>
      ) : (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Nummer</th>
                <th>Inhaber</th>
                <th>Notiz</th>
                <th>Sync-Status</th>
                <th>zuletzt synchronisiert</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((f) => (
                <tr key={f.id} className={f.aktiv ? "" : "opacity-50"}>
                  <td className="font-medium">{f.nummer}</td>
                  <td className="align-top">
                    <InhaberZelle
                      firmenhandy={f}
                      mitarbeiter={mitarbeiter}
                      canEdit={canEdit}
                      onGesetzt={laden}
                    />
                  </td>
                  <td className="text-sm text-neutral-500">{f.notiz ?? "—"}</td>
                  <td>
                    {syncBadge(f.sync_status)}
                    {f.sync_status === "fehler" && f.sync_fehler && (
                      <span
                        className="ml-1 text-xs text-red-600"
                        title={f.sync_fehler}
                      >
                        ⓘ
                      </span>
                    )}
                  </td>
                  <td className="text-sm text-neutral-500">
                    {f.sync_am
                      ? new Date(f.sync_am).toLocaleString("de-DE")
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      disabled={syncLaeuft}
                      onClick={() => synchronisieren([f])}
                    >
                      Sync
                    </button>{" "}
                    {canEdit && (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => loeschen(f)}
                      >
                        Löschen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {gefiltert.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-neutral-500">
                    {firmenhandys.length === 0
                      ? "Noch keine Nummern erfasst."
                      : "Keine Nummer entspricht der Suche."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
