"use client";

// Für Handy optimierter Kamera-Workflow für die Anreiseliste (Nutzer-Vorgabe
// 2026-10-26: die Kamera-Buttons direkt in jeder Tabellenzeile waren "zu
// umständlich"). Drei Schritte, rein im Komponentenzustand (keine
// Unterrouten nötig):
//
// 1. "typ": zwei große Kacheln - Personalausweis oder Führerschein.
// 2. "liste": alle Personen aktuell auf der Anreiseliste als Kacheln,
//    3 je Zeile. Wer für den gewählten Dokumenttyp schon ein Dokument hat
//    (laut personal_kandidaten_checkliste ODER weil in dieser Sitzung schon
//    aufgenommen), ist ausgegraut/nicht anklickbar.
// 3. "kamera": DokumentKameraAufnahme für die angetippte Person. Nach
//    Fertigstellen/Abbrechen geht es automatisch zurück zu Schritt 2 -
//    die gerade aufgenommene Person ist dort jetzt nicht mehr anwählbar.
//
// Schritt zurück zu "typ" jederzeit über den Zurück-Pfeil in Schritt 2.

import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { DokumentKategorie } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import DokumentKameraAufnahme from "@/components/DokumentKameraAufnahme";
import { ArrowLeft, Check, IdCard, Car } from "lucide-react";

interface Person {
  employeeId: string;
  name: string;
  vorname: string;
  ausweisErledigt: boolean;
  fuehrerscheinErledigt: boolean;
}

type DokTyp = {
  modus: "ausweis" | "dokument";
  dokumentKategorie: DokumentKategorie;
};

const PERSONALAUSWEIS: DokTyp = { modus: "ausweis", dokumentKategorie: "Ausweiskopie" };
const FUEHRERSCHEIN: DokTyp = { modus: "dokument", dokumentKategorie: "Führerschein Kopie" };

type Schritt =
  | { stufe: "typ" }
  | { stufe: "liste"; typ: DokTyp }
  | { stufe: "kamera"; typ: DokTyp; person: Person };

export default function AnreiselisteKameraPage() {
  const { profile, loading: profilLaedt } = useProfile();
  const canEdit = profile?.role === "admin" || profile?.role === "hr";

  const [personen, setPersonen] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [schritt, setSchritt] = useState<Schritt>({ stufe: "typ" });
  // Zusätzlich zur DB-Checkliste: in dieser Sitzung gerade erledigte
  // Personen sofort ausgrauen, ohne auf den Reload zu warten.
  const [geradeErledigt, setGeradeErledigt] = useState<Set<string>>(new Set());

  const laden = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const [{ data: kData, error: kErr }, { data: cData, error: cErr }] = await Promise.all([
      supabase
        .from("personal_kandidaten")
        .select("name, vorname, aktivierter_employee_id")
        .eq("status", "anreiseliste")
        .order("name"),
      supabase
        .from("personal_kandidaten_checkliste")
        .select("employee_id, ausweiskopie_vorhanden, fuehrerschein_erfuellt"),
    ]);
    if (kErr || cErr) {
      setFehler(kErr?.message ?? cErr?.message ?? "Unbekannter Fehler.");
      setLoading(false);
      return;
    }
    const checklisteVonId = new Map(
      (cData ?? [])
        .filter((c) => c.employee_id)
        .map((c) => [c.employee_id as string, c])
    );
    setPersonen(
      (kData ?? [])
        .filter((k) => k.aktivierter_employee_id)
        .map((k) => {
          const employeeId = k.aktivierter_employee_id as string;
          const c = checklisteVonId.get(employeeId);
          return {
            employeeId,
            name: k.name as string,
            vorname: k.vorname as string,
            ausweisErledigt: c?.ausweiskopie_vorhanden ?? false,
            fuehrerscheinErledigt: c?.fuehrerschein_erfuellt ?? false,
          };
        })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    laden();
  }, [laden]);

  if (profilLaedt) {
    return <p className="p-4 text-sm text-neutral-500">Lädt…</p>;
  }
  if (!canEdit) {
    return (
      <p className="p-4 text-sm text-neutral-500">
        Die Kamera-Funktion ist nur für Admin/HR.
      </p>
    );
  }

  function istErledigt(p: Person, typ: DokTyp): boolean {
    if (geradeErledigt.has(`${p.employeeId}-${typ.dokumentKategorie}`)) return true;
    return typ.modus === "ausweis" ? p.ausweisErledigt : p.fuehrerscheinErledigt;
  }

  if (schritt.stufe === "kamera") {
    return (
      <DokumentKameraAufnahme
        key={`${schritt.person.employeeId}-${schritt.typ.dokumentKategorie}`}
        employeeId={schritt.person.employeeId}
        name={schritt.person.name}
        vorname={schritt.person.vorname}
        modus={schritt.typ.modus}
        dokumentKategorie={schritt.typ.dokumentKategorie}
        onFertig={() => {
          setGeradeErledigt((prev) => {
            const next = new Set(prev);
            next.add(`${schritt.person.employeeId}-${schritt.typ.dokumentKategorie}`);
            return next;
          });
          setSchritt({ stufe: "liste", typ: schritt.typ });
          laden();
        }}
        onAbbrechen={() => setSchritt({ stufe: "liste", typ: schritt.typ })}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-3">
      <PageHeader titel="Dokument per Kamera aufnehmen" />

      {fehler && <p className="text-sm text-beere-700">Konnte nicht laden: {fehler}</p>}

      {schritt.stufe === "typ" && (
        <>
          <p className="text-sm text-neutral-600">Welches Dokument?</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              className="flex flex-col items-center gap-2 rounded-lg border border-linie bg-white py-8 text-lg font-semibold text-emerald-800 shadow-sm active:bg-sand"
              onClick={() => setSchritt({ stufe: "liste", typ: PERSONALAUSWEIS })}
            >
              <IdCard className="h-10 w-10" />
              Personalausweis
            </button>
            <button
              type="button"
              className="flex flex-col items-center gap-2 rounded-lg border border-linie bg-white py-8 text-lg font-semibold text-emerald-800 shadow-sm active:bg-sand"
              onClick={() => setSchritt({ stufe: "liste", typ: FUEHRERSCHEIN })}
            >
              <Car className="h-10 w-10" />
              Führerschein
            </button>
          </div>
        </>
      )}

      {schritt.stufe === "liste" && (
        <>
          <button
            type="button"
            className="flex w-fit items-center gap-1 text-sm text-emerald-700"
            onClick={() => setSchritt({ stufe: "typ" })}
          >
            <ArrowLeft className="h-4 w-4" />
            Dokumentart wechseln
          </button>
          <p className="text-sm text-neutral-600">
            {schritt.typ.modus === "ausweis" ? "Personalausweis" : "Führerschein"} - Person
            antippen, deren Dokument aufgenommen werden soll.
          </p>

          {loading ? (
            <p className="text-neutral-500">Lädt…</p>
          ) : personen.length === 0 ? (
            <p className="text-neutral-500">Niemand aktuell auf der Anreiseliste.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {personen.map((p) => {
                const erledigt = istErledigt(p, schritt.typ);
                return (
                  <button
                    key={p.employeeId}
                    type="button"
                    disabled={erledigt}
                    className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center text-xs font-medium shadow-sm ${
                      erledigt
                        ? "border-linie bg-sand text-neutral-400"
                        : "border-linie bg-white text-emerald-900 active:bg-sand"
                    }`}
                    onClick={() =>
                      !erledigt && setSchritt({ stufe: "kamera", typ: schritt.typ, person: p })
                    }
                  >
                    {erledigt && <Check className="h-4 w-4 text-emerald-600" />}
                    <span>
                      {p.name}
                      <br />
                      {p.vorname}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
