"use client";

// Druckansicht "Bestätigung für den Nachweis der doppelten Haushaltsführung -
// saisonbeschäftigte Arbeitskräfte", eine Seite je Person eines
// Lohnsteuerabzug-Sammelantrags. Wird aus den auf "Personal → Lohnsteuer"
// erfassten Angaben (Familienstand/Wohnsituation) erzeugt statt hochgeladen -
// konsistent mit der Nutzer-Vorgabe 2026-08-11 ("die erfassten Angaben sind
// der Nachweis"). Das ist die Anlage, die dem Sammelantrag beigelegt wird.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import {
  FAMILIENSTAND_LABELS,
  WOHNSITUATION_LABELS,
  type DoppelteHaushaltsfuehrung,
  type Employee,
  type FirmenBankdaten,
  type Lohnsteuerantrag,
  type LohnsteuerantragPosition,
} from "@/lib/types";

interface Eintrag {
  emp: Employee;
  dhh: DoppelteHaushaltsfuehrung | null;
}

function BescheinigungenInner() {
  const params = useSearchParams();
  const antragId = params.get("antragId");
  const [firma, setFirma] = useState<FirmenBankdaten | null>(null);
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [laedt, setLaedt] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    if (!antragId) {
      setLaedt(false);
      return;
    }
    (async () => {
      const supabase = getSupabaseClient();
      const [{ data: antrag }, { data: firmaData }] = await Promise.all([
        supabase
          .from("lohnsteuerantrag")
          .select("*")
          .eq("id", antragId)
          .maybeSingle(),
        supabase.from("firmen_bankdaten").select("*").eq("id", 1).maybeSingle(),
      ]);
      if (!antrag) {
        setFehler("Antrag nicht gefunden.");
        setLaedt(false);
        return;
      }
      setFirma((firmaData as FirmenBankdaten) ?? null);
      const jahr = (antrag as Lohnsteuerantrag).jahr;
      const { data: posData } = await supabase
        .from("lohnsteuerantrag_position")
        .select("employee_id")
        .eq("antrag_id", antragId)
        .order("id");
      const employeeIds = (
        (posData as Pick<LohnsteuerantragPosition, "employee_id">[]) ?? []
      ).map((p) => p.employee_id);
      if (employeeIds.length === 0) {
        setEintraege([]);
        setLaedt(false);
        return;
      }
      const [{ data: empData }, { data: dhhData }] = await Promise.all([
        supabase.from("employees").select("*").in("id", employeeIds),
        supabase
          .from("doppelte_haushaltsfuehrung")
          .select("*")
          .eq("saison_jahr", jahr)
          .in("employee_id", employeeIds),
      ]);
      const dhhMap: Record<string, DoppelteHaushaltsfuehrung> = {};
      ((dhhData as DoppelteHaushaltsfuehrung[]) ?? []).forEach((d) => {
        dhhMap[d.employee_id] = d;
      });
      const empMap: Record<string, Employee> = {};
      ((empData as Employee[]) ?? []).forEach((e) => {
        empMap[e.id] = e;
      });
      setEintraege(
        employeeIds
          .map((id) => empMap[id])
          .filter((e): e is Employee => !!e)
          .map((emp) => ({ emp, dhh: dhhMap[emp.id] ?? null }))
      );
      setLaedt(false);
    })();
  }, [antragId]);

  if (!antragId) return <p className="p-6">Kein Antrag angegeben.</p>;
  if (laedt) return <p className="p-6">Lädt…</p>;
  if (fehler) return <p className="p-6 text-red-600">{fehler}</p>;

  return (
    <div>
      <div className="print:hidden flex justify-end p-4">
        <button type="button" className="btn" onClick={() => window.print()}>
          Drucken
        </button>
      </div>
      {eintraege.map(({ emp, dhh }, i) => (
        <div
          key={emp.id}
          className={`bescheinigung-druck${i > 0 ? " print-page-break" : ""}`}
        >
          <div className="bd-kopf">
            <div>{firma?.name ?? "Mömmel Agrar GmbH & Co. KG"}</div>
            <div>
              {[firma?.strasse, firma?.hausnummer].filter(Boolean).join(" ")}
            </div>
            <div>{[firma?.plz, firma?.ort].filter(Boolean).join(" ")}</div>
          </div>

          <h1 className="bd-titel">
            Bestätigung für den Nachweis der doppelten Haushaltsführung
          </h1>
          <p className="bd-untertitel">saisonbeschäftigte Arbeitskräfte</p>

          <div className="bd-felder">
            <div>
              <span>Name, Vorname</span>
              <strong>
                {emp.name}, {emp.vorname}
              </strong>
            </div>
            <div>
              <span>Geburtsdatum</span>
              <strong>{formatDatumDE(emp.geburtsdatum)}</strong>
            </div>
            <div>
              <span>Familienstand</span>
              <strong>
                {dhh?.familienstand
                  ? FAMILIENSTAND_LABELS[dhh.familienstand]
                  : "—"}
              </strong>
            </div>
            {dhh?.familienstand && dhh.familienstand !== "verheiratet" && (
              <div>
                <span>Wohnsituation am Heimatort</span>
                <strong>
                  {dhh.wohnsituation
                    ? WOHNSITUATION_LABELS[dhh.wohnsituation]
                    : "—"}
                </strong>
              </div>
            )}
            <div>
              <span>Heimatanschrift</span>
              <strong>
                {[emp.strasse, emp.hausnummer].filter(Boolean).join(" ")},{" "}
                {[emp.plz, emp.ort].filter(Boolean).join(" ")}
                {emp.land ? `, ${emp.land}` : ""}
              </strong>
            </div>
          </div>

          <p className="bd-erklaerung">
            Hiermit wird bestätigt, dass die oben genannte Person an ihrem
            Heimatort einen eigenen Hausstand unterhält, der während der
            saisonalen Beschäftigung in Deutschland weitergeführt wird
            (doppelte Haushaltsführung).
          </p>

          <div className="bd-unterschrift">
            <div>
              <span>Ort, Datum</span>
              <div className="bd-linie">
                {dhh?.ausgefuellt_am ? formatDatumDE(dhh.ausgefuellt_am) : ""}
              </div>
            </div>
            <div>
              <span>Unterschrift Arbeitnehmer/-in</span>
              <div className="bd-linie" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BescheinigungenPage() {
  return (
    <Suspense fallback={<p className="p-6">Lädt…</p>}>
      <BescheinigungenInner />
    </Suspense>
  );
}
