"use client";

import { useEffect, useState } from "react";
import { Palmtree } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { EmployeeUrlaubstage } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import ControllingTabs from "@/components/ControllingTabs";

const CURRENT_YEAR = new Date().getFullYear();

export default function ControllingUrlaubPage() {
  const [jahr, setJahr] = useState(CURRENT_YEAR);
  const [urlaubUeberzogen, setUrlaubUeberzogen] = useState<
    EmployeeUrlaubstage[]
  >([]);
  const [loadingUrlaub, setLoadingUrlaub] = useState(true);
  const [resturlaub, setResturlaub] = useState<EmployeeUrlaubstage[]>([]);
  const [loadingResturlaub, setLoadingResturlaub] = useState(true);

  useEffect(() => {
    async function loadUrlaub() {
      setLoadingUrlaub(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_urlaubstage")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("ueberzogen", true)
        .order("u_tage", { ascending: false });
      if (!error) setUrlaubUeberzogen((data as EmployeeUrlaubstage[]) ?? []);
      setLoadingUrlaub(false);
    }
    loadUrlaub();
  }, [jahr]);

  useEffect(() => {
    async function loadResturlaub() {
      setLoadingResturlaub(true);
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("employee_urlaubstage")
        .select("*")
        .eq("saison_jahr", jahr)
        .eq("zu_wenig_genommen", true)
        .order("resturlaub_tage", { ascending: false });
      if (!error) setResturlaub((data as EmployeeUrlaubstage[]) ?? []);
      setLoadingResturlaub(false);
    }
    loadResturlaub();
  }, [jahr]);

  return (
    <div className="flex flex-col gap-4">
      <ControllingTabs />
      <PageHeader
        icon={Palmtree}
        titel="Urlaub"
        beschreibung="Anspruch: 2 Urlaubstage je vollem Kalendermonat der Beschäftigung (1. bis letzter Tag mit Stunden oder Markierung). Überzogene „U“-Tage und offener Resturlaub – bei Inaktiven eine Abgeltungspflicht."
      />

      <p className="text-sm text-neutral-600">
        {loadingUrlaub || loadingResturlaub ? (
          "…"
        ) : (
          <>
            <span className="font-medium text-red-600">
              {urlaubUeberzogen.length}
            </span>{" "}
            überzogen ·{" "}
            <span className="font-medium text-amber-600">
              {resturlaub.length}
            </span>{" "}
            Resturlaub offen
          </>
        )}
      </p>

      <label className="sticky top-[calc(3.5rem+var(--subtabs-h,2.5rem))] z-30 block bg-sand py-2 text-sm">
        Saison-Jahr{" "}
        <input
          type="number"
          value={jahr}
          onChange={(e) => setJahr(Number(e.target.value))}
          className="w-24"
        />
      </label>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-emerald-800">
          Urlaubstage überzogen
        </h3>
        <p className="mb-2 text-sm text-neutral-500">
          Personen, bei denen mehr Tage mit Markierung „U“ erfasst wurden als
          der Anspruch (2 Tage je vollem Kalendermonat) hergibt.
        </p>
        {loadingUrlaub ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : urlaubUeberzogen.length === 0 ? (
          <p className="text-neutral-500">
            Keine überzogenen Urlaubstage für {jahr}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Pers.-Nr.</th>
                  <th>Name</th>
                  <th>1. Eintrag</th>
                  <th>Letzter Eintrag</th>
                  <th>Volle Kalendermonate</th>
                  <th>Anspruch (Tage)</th>
                  <th>Genommen („U“, Tage)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {urlaubUeberzogen.map((u) => (
                  <tr key={u.employee_id}>
                    <td>{u.personal_nr}</td>
                    <td>
                      {u.name}, {u.vorname}
                      {!u.aktiv && (
                        <span className="ml-1 text-xs text-neutral-500">
                          (inaktiv)
                        </span>
                      )}
                    </td>
                    <td>{formatDatumDE(u.erster_eintrag)}</td>
                    <td>{formatDatumDE(u.letzter_eintrag)}</td>
                    <td>{u.volle_kalendermonate}</td>
                    <td>{u.urlaubsanspruch_tage}</td>
                    <td>{u.u_tage}</td>
                    <td className="font-medium text-red-600">
                      ⚠ {u.u_tage - u.urlaubsanspruch_tage} Tag(e) zu viel
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-emerald-800">
          Resturlaub (zu wenig genommen)
        </h3>
        <p className="mb-2 text-sm text-neutral-500">
          Gleicher Anspruch wie oben - hier Personen, bei denen weniger
          „U“-Tage erfasst wurden als der Anspruch hergibt. Bei bereits
          inaktiven Personen bedeutet das in der Regel eine Abgeltungspflicht
          (Auszahlung des Resturlaubs), nicht nur eine Erinnerung.
        </p>
        {loadingResturlaub ? (
          <p className="text-neutral-500">Lädt…</p>
        ) : resturlaub.length === 0 ? (
          <p className="text-neutral-500">Kein offener Resturlaub für {jahr}.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {resturlaub.some((u) => !u.aktiv) && (
              <div className="overflow-x-auto">
                <h4 className="mb-1 text-sm font-semibold text-red-700">
                  ⚠ Inaktiv - Abgeltung fällig
                </h4>
                <table>
                  <thead>
                    <tr>
                      <th>Pers.-Nr.</th>
                      <th>Name</th>
                      <th>1. Eintrag</th>
                      <th>Letzter Eintrag</th>
                      <th>Volle Kalendermonate</th>
                      <th>Anspruch (Tage)</th>
                      <th>Genommen („U“, Tage)</th>
                      <th>Resturlaub</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resturlaub
                      .filter((u) => !u.aktiv)
                      .map((u) => (
                        <tr key={u.employee_id} className="bg-red-50">
                          <td>{u.personal_nr}</td>
                          <td>
                            {u.name}, {u.vorname}
                          </td>
                          <td>{formatDatumDE(u.erster_eintrag)}</td>
                          <td>{formatDatumDE(u.letzter_eintrag)}</td>
                          <td>{u.volle_kalendermonate}</td>
                          <td>{u.urlaubsanspruch_tage}</td>
                          <td>{u.u_tage}</td>
                          <td className="font-medium text-red-600">
                            ⚠ {u.resturlaub_tage} Tag(e) - Abgeltung fällig
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {resturlaub.some((u) => u.aktiv) && (
              <div className="overflow-x-auto">
                <h4 className="mb-1 text-sm font-semibold text-neutral-700">
                  Aktiv - kann noch genommen werden
                </h4>
                <table>
                  <thead>
                    <tr>
                      <th>Pers.-Nr.</th>
                      <th>Name</th>
                      <th>1. Eintrag</th>
                      <th>Letzter Eintrag</th>
                      <th>Volle Kalendermonate</th>
                      <th>Anspruch (Tage)</th>
                      <th>Genommen („U“, Tage)</th>
                      <th>Resturlaub</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resturlaub
                      .filter((u) => u.aktiv)
                      .map((u) => (
                        <tr key={u.employee_id}>
                          <td>{u.personal_nr}</td>
                          <td>
                            {u.name}, {u.vorname}
                          </td>
                          <td>{formatDatumDE(u.erster_eintrag)}</td>
                          <td>{formatDatumDE(u.letzter_eintrag)}</td>
                          <td>{u.volle_kalendermonate}</td>
                          <td>{u.urlaubsanspruch_tage}</td>
                          <td>{u.u_tage}</td>
                          <td className="font-medium text-amber-600">
                            {u.resturlaub_tage} Tag(e) offen
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
