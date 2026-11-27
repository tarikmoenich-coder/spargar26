"use client";

// Nutzer- & Rollenverwaltung (nur admin). Ersetzt das bisherige
// Von-Hand-Pflegen im Supabase-Table-Editor. Der Login selbst (E-Mail +
// Passwort) wird weiterhin im Supabase-Dashboard angelegt - hier werden
// Name, Rollen und Aktiv-Status gepflegt. Absicherung: RLS-Policy
// profiles_admin_all + Trigger trg_profiles_schutz (role/rollen/aktiv nur
// durch admin) + Audit-Trigger trg_audit_profiles.
//
// Rechte-Umbau (2026-11-28): Rollen sind Datensätze (Einstellungen →
// Rollen), ein Nutzer kann mehrere haben. Rechte und Bereiche kommen aus den
// Rollen - je Rolle in ihren eigenen Bereichen.

import PageHeader from "@/components/PageHeader";
import { UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { formatDatumDE } from "@/lib/format";
import { istAdmin as istAdminProfil } from "@/lib/rollen";
import { useRollen } from "@/lib/useRollen";
import Link from "next/link";
import EinstellungenTabs from "@/components/EinstellungenTabs";
import { useBereiche } from "@/lib/useBereiche";
import type { Rolle, UserRole } from "@/lib/types";

interface Nutzer {
  id: string;
  full_name: string;
  role: UserRole;
  rollen: UserRole[];
  bereiche: string[];
  aktiv: boolean;
  created_at: string;
}

export default function NutzerVerwaltungPage() {
  const { profile } = useProfile();
  const istAdmin = istAdminProfil(profile);
  const bereiche = useBereiche(profile);
  const { rollen: alleRollen } = useRollen(istAdmin);
  // Rollen in Listen-Reihenfolge halten
  const sortiert = (r: UserRole[]) => alleRollen.map((x) => x.id).filter((id) => r.includes(id));
  // Bereiche eines Nutzers = Bereiche seiner Rollen (Administrator: alle)
  const bereicheAus = (r: UserRole[]) => {
    const ro = alleRollen.filter((x) => r.includes(x.id));
    if (ro.some((x) => x.system_admin)) return bereiche.alle.map((b) => b.kuerzel);
    return bereiche.alle.map((b) => b.kuerzel).filter((k) => ro.some((x: Rolle) => x.bereiche.includes(k)));
  };

  const [nutzer, setNutzer] = useState<Nutzer[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const [neuId, setNeuId] = useState("");
  const [neuName, setNeuName] = useState("");
  const [neuRollen, setNeuRollen] = useState<UserRole[]>([]);
  const [anlegen, setAnlegen] = useState(false);

  const laden = useCallback(async () => {
    if (!istAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await getSupabaseClient()
      .from("profiles")
      .select("*")
      .order("full_name");
    if (error) setFehler(error.message);
    setNutzer(
      ((data as Nutzer[]) ?? []).map((n) => ({
        ...n,
        rollen: n.rollen && n.rollen.length > 0 ? n.rollen : [n.role],
        bereiche: n.bereiche ?? ["LW"],
      }))
    );
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

  async function rolleUmschalten(n: Nutzer, rolle: UserRole, an: boolean) {
    const neu = sortiert(an ? [...n.rollen, rolle] : n.rollen.filter((r) => r !== rolle));
    if (neu.length === 0) {
      setFehler("Ein Nutzer braucht mindestens eine Rolle - zum Sperren \"Aktiv\" abwählen.");
      return;
    }
    if (
      n.id === profile?.id &&
      alleRollen.find((x) => x.id === rolle)?.system_admin &&
      !an &&
      !window.confirm(
        "Du entziehst dir selbst die Administrator-Rolle. Danach kommst du nicht mehr in diese Verwaltung. Fortfahren?"
      )
    ) {
      return;
    }
    // Hauptrolle bleibt, solange sie noch gewählt ist - sonst die erste.
    const hauptrolle = neu.includes(n.role) ? n.role : neu[0];
    patch(n.id, { rollen: neu, role: hauptrolle });
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
    if (neuRollen.length === 0) {
      setFehler("Bitte mindestens eine Rolle wählen.");
      return;
    }
    setAnlegen(true);
    const { error } = await getSupabaseClient()
      .from("profiles")
      .insert({
        id,
        full_name: neuName.trim(),
        role: sortiert(neuRollen)[0],
        rollen: sortiert(neuRollen),
      });
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
    setNeuRollen([]);
    laden();
  }

  if (!istAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <EinstellungenTabs />
        <PageHeader icon={UserCog} titel="Nutzer" />
        <p className="text-sm text-neutral-500">
          Nur Administratoren dürfen die Nutzerverwaltung öffnen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <EinstellungenTabs />
      <div>
        <PageHeader icon={UserCog} titel="Nutzer" />
        <p className="text-sm text-neutral-500">
          Name, Rollen und Aktiv-Status je Nutzer. Ein Nutzer kann mehrere
          Rollen haben und darf dann alles, was eine seiner Rollen darf - jeweils
          in den Bereichen dieser Rolle. Was eine Rolle darf und für welche
          Bereiche sie gilt, legst du unter{" "}
          <Link href="/einstellungen/rollen" className="text-emerald-700 underline">
            Rollen
          </Link>{" "}
          fest. Der Login (E-Mail/Passwort) wird in Supabase → Authentication →
          Users angelegt; hier wird anschließend das Profil gepflegt.
          Rollenwechsel landen im Änderungsprotokoll.
        </p>
      </div>

      {fehler && <p className="text-sm text-beere-600">⚠ {fehler}</p>}

      {loading ? (
        <p className="text-neutral-500">Lädt…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Rollen</th>
                  <th>Bereiche</th>
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
                      <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1">
                        {alleRollen.map((r) => (
                          <label
                            key={r.id}
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs"
                          >
                            <input
                              type="checkbox"
                              checked={n.rollen.includes(r.id)}
                              onChange={(e) =>
                                rolleUmschalten(n, r.id, e.target.checked)
                              }
                            />
                            {r.bezeichnung}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-xs text-neutral-600">
                      {bereicheAus(n.rollen).map((k) => bereiche.label(k)).join(", ") || "—"}
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
              <fieldset className="text-sm">
                <legend>Rollen</legend>
                <div className="mt-1 flex max-w-md flex-wrap gap-x-3 gap-y-1">
                  {alleRollen.map((r) => (
                    <label
                      key={r.id}
                      className="inline-flex items-center gap-1 whitespace-nowrap text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={neuRollen.includes(r.id)}
                        onChange={(e) =>
                          setNeuRollen((prev) =>
                            e.target.checked
                              ? [...prev, r.id]
                              : prev.filter((x) => x !== r.id)
                          )
                        }
                      />
                      {r.bezeichnung}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="btn" disabled={anlegen}>
                {anlegen ? "Legt an…" : "Anlegen"}
              </button>
            </form>
          </div>

        </>
      )}
    </div>
  );
}
