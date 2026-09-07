"use client";

// Nutzer- & Rollenverwaltung (nur admin). Ersetzt das bisherige
// Von-Hand-Pflegen im Supabase-Table-Editor. Der Login selbst (E-Mail +
// Passwort) wird weiterhin im Supabase-Dashboard angelegt - hier werden
// Name, Rolle und Aktiv-Status gepflegt. Absicherung: RLS-Policy
// profiles_admin_all + Trigger trg_profiles_schutz (role/aktiv nur durch
// admin) + Audit-Trigger trg_audit_profiles.

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import { ROLLEN, rolleLabel } from "@/lib/rollen";
import type { UserRole } from "@/lib/types";

interface Nutzer {
  id: string;
  full_name: string;
  role: UserRole;
  aktiv: boolean;
  created_at: string;
}

export default function NutzerVerwaltungPage() {
  const { profile } = useProfile();
  const istAdmin = profile?.role === "admin";

  const [nutzer, setNutzer] = useState<Nutzer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [neuId, setNeuId] = useState("");
  const [neuName, setNeuName] = useState("");
  const [neuRolle, setNeuRolle] = useState<UserRole>("zeiterfassung");
  const [anlegen, setAnlegen] = useState(false);

  const laden = useCallback(async () => {
    if (!istAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await getSupabaseClient()
      .from("profiles")
      .select("id, full_name, role, aktiv, created_at")
      .order("full_name");
    if (error) setFehler(error.message);
    setNutzer((data as Nutzer[]) ?? []);
    setLoading(false);
  }, [istAdmin]);

  useEffect(() => {
    laden();
  }, [laden]);

  async function patch(id: string, feld: Partial<Nutzer>) {
    setFehler(null);
    // Lokal optimistisch, damit die Auswahl sofort steht.
    setNutzer((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...feld } : n))
    );
    const { error } = await getSupabaseClient()
      .from("profiles")
      .update(feld)
      .eq("id", id);
    if (error) {
      setFehler(error.message);
      laden(); // zurück auf den echten Stand
    }
  }

  async function rolleSetzen(n: Nutzer, rolle: UserRole) {
    if (
      n.id === profile?.id &&
      n.role === "admin" &&
      rolle !== "admin" &&
      !window.confirm(
        "Du entziehst dir selbst die Administrator-Rolle. Danach kommst du nicht mehr in diese Verwaltung. Fortfahren?"
      )
    ) {
      return;
    }
    patch(n.id, { role: rolle });
  }

  async function aktivSetzen(n: Nutzer, aktiv: boolean) {
    if (
      n.id === profile?.id &&
      !aktiv &&
      !window.confirm("Du deaktivierst dein eigenes Konto. Fortfahren?")
    ) {
      return;
    }
    patch(n.id, { aktiv });
  }

  async function nutzerAnlegen(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    const id = neuId.trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      setFehler("Bitte eine gültige Auth-UID eingeben (aus Supabase → Authentication → Users).");
      return;
    }
    if (!neuName.trim()) {
      setFehler("Name ist ein Pflichtfeld.");
      return;
    }
    setAnlegen(true);
    const { error } = await getSupabaseClient()
      .from("profiles")
      .insert({ id, full_name: neuName.trim(), role: neuRolle });
    setAnlegen(false);
    if (error) {
      setFehler(
        error.message.includes("foreign key")
          ? "Zu dieser UID gibt es keinen Login. Erst in Supabase → Authentication → Users anlegen, dann hier die UID eintragen."
          : error.message
      );
      return;
    }
    setNeuId("");
    setNeuName("");
    setNeuRolle("zeiterfassung");
    laden();
  }

  if (!istAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-emerald-800">
          Nutzer &amp; Rollen
        </h1>
        <p className="text-sm text-neutral-500">
          Nur Administratoren dürfen die Nutzerverwaltung öffnen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-emerald-800">
          Nutzer &amp; Rollen
        </h1>
        <p className="text-sm text-neutral-500">
          Name, Rolle und Aktiv-Status je Nutzer. Der Login (E-Mail/Passwort)
          wird in Supabase → Authentication → Users angelegt; hier wird
          anschließend das Profil gepflegt. Rollenwechsel landen im
          Änderungsprotokoll.
        </p>
      </div>

      {fehler && <p className="text-sm text-red-600">⚠ {fehler}</p>}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Rolle</th>
                  <th>Aktiv</th>
                  <th>Angelegt</th>
                  <th>Auth-UID</th>
                </tr>
              </thead>
              <tbody>
                {nutzer.map((n) => (
                  <tr key={n.id} className={n.aktiv ? "" : "opacity-50"}>
                    <td>
                      <input
                        className="w-48"
                        defaultValue={n.full_name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== n.full_name)
                            patch(n.id, { full_name: v });
                        }}
                      />
                    </td>
                    <td>
                      <select
                        value={n.role}
                        onChange={(e) =>
                          rolleSetzen(n, e.target.value as UserRole)
                        }
                      >
                        {ROLLEN.map((r) => (
                          <option key={r.wert} value={r.wert}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={n.aktiv}
                        onChange={(e) => aktivSetzen(n, e.target.checked)}
                      />
                    </td>
                    <td className="text-sm text-neutral-500">
                      {formatDatumDE(n.created_at)}
                    </td>
                    <td className="font-mono text-xs text-neutral-400">
                      {n.id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card flex flex-col gap-3">
            <h2 className="text-base font-semibold text-emerald-800">
              Nutzer hinzufügen
            </h2>
            <p className="text-xs text-neutral-500">
              Zuerst in Supabase → Authentication → Users „Add user" (E-Mail +
              Passwort), dann die dort angezeigte User-UID hier eintragen.
            </p>
            <form
              onSubmit={nutzerAnlegen}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="text-sm">
                Auth-UID
                <input
                  className="mt-1 block w-80 font-mono text-xs"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  value={neuId}
                  onChange={(e) => setNeuId(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Name
                <input
                  className="mt-1 block w-48"
                  value={neuName}
                  onChange={(e) => setNeuName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Rolle
                <select
                  className="mt-1 block"
                  value={neuRolle}
                  onChange={(e) => setNeuRolle(e.target.value as UserRole)}
                >
                  {ROLLEN.map((r) => (
                    <option key={r.wert} value={r.wert}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn" disabled={anlegen}>
                {anlegen ? "Legt an…" : "Anlegen"}
              </button>
            </form>
          </div>

          <div>
            <h2 className="mb-2 text-base font-semibold text-emerald-800">
              Was die Rollen dürfen
            </h2>
            <dl className="grid gap-2 sm:grid-cols-2">
              {ROLLEN.map((r) => (
                <div key={r.wert} className="rounded border border-linie p-3">
                  <dt className="font-medium text-emerald-900">
                    {r.label}{" "}
                    <span className="font-mono text-xs text-neutral-400">
                      {r.wert}
                    </span>
                  </dt>
                  <dd className="text-sm text-neutral-600">{r.kurz}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-neutral-400">
              Rolle {rolleLabel(profile?.role)} · angemeldet als{" "}
              {profile?.full_name}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
