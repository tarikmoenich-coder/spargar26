"use client";

// Kompakte Tabellen-Zelle für GENAU EINE Dokument-Kategorie einer Person:
// zeigt die vorhandenen Dateien als Download-Link und erlaubt Hochladen/
// Löschen direkt an Ort und Stelle.
//
// Hintergrund (Nutzer-Vorgabe 2026-08-11): die gescannten Papierformulare
// "Doppelte Haushaltsführung" und "Formular zur Feststellung der
// Versicherungspflicht" standen bisher auf der allgemeinen Dokumente-Seite,
// fachlich gehören sie aber neben die zugehörigen Angaben auf "Personal →
// Lohnsteuer" bzw. "Personal → Sozialversicherung". Diese Komponente
// vermeidet dafür doppelten Upload-Code auf beiden Seiten.

import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatDatumDE } from "@/lib/format";
import type { DokumentKategorie, EmployeeDocument } from "@/lib/types";

const DOKUMENTE_BUCKET = "mitarbeiter-dokumente";

export default function FormularDokumentZelle({
  employeeId,
  kategorie,
  dokumente,
  canEdit,
  onGeaendert,
}: {
  employeeId: string;
  kategorie: DokumentKategorie;
  // Bereits geladene Dokumente dieser Person (die Seite lädt sie ohnehin
  // gesammelt - hier wird bewusst nicht je Zelle nachgeladen).
  dokumente: EmployeeDocument[];
  canEdit: boolean;
  onGeaendert: () => void;
}) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [dateiSchluessel, setDateiSchluessel] = useState(0);

  const treffer = dokumente.filter((d) => d.kategorie === kategorie);

  async function hochladen(datei: File) {
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const pfad = `${employeeId}/${Date.now()}_${datei.name}`;
    const { error: uploadError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .upload(pfad, datei);
    if (uploadError) {
      setFehler(uploadError.message);
      setLaeuft(false);
      return;
    }
    const { error: insertError } = await supabase
      .from("employee_documents")
      .insert({
        employee_id: employeeId,
        kategorie,
        dateiname: datei.name,
        storage_path: pfad,
      });
    if (insertError) {
      setFehler(insertError.message);
      // Verwaiste Datei ohne Datenbank-Eintrag wieder entfernen.
      await supabase.storage.from(DOKUMENTE_BUCKET).remove([pfad]);
      setLaeuft(false);
      return;
    }
    setDateiSchluessel((k) => k + 1);
    setLaeuft(false);
    onGeaendert();
  }

  async function herunterladen(doc: EmployeeDocument) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data) {
      window.alert(
        `Download fehlgeschlagen: ${error?.message ?? "unbekannter Fehler"}`
      );
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  async function loeschen(doc: EmployeeDocument) {
    if (!window.confirm(`"${doc.dateiname}" wirklich löschen?`)) return;
    const supabase = getSupabaseClient();
    const { error: storageError } = await supabase.storage
      .from(DOKUMENTE_BUCKET)
      .remove([doc.storage_path]);
    if (storageError) {
      window.alert(`Löschen fehlgeschlagen: ${storageError.message}`);
      return;
    }
    await supabase.from("employee_documents").delete().eq("id", doc.id);
    onGeaendert();
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      {treffer.length === 0 ? (
        <span className="text-neutral-300">—</span>
      ) : (
        treffer.map((d) => (
          <div key={d.id} className="flex items-center gap-1">
            <button
              type="button"
              className="text-left text-emerald-700 underline"
              onClick={() => herunterladen(d)}
              title={`Hochgeladen am ${formatDatumDE(d.hochgeladen_am)}`}
            >
              {d.dateiname}
            </button>
            {canEdit && (
              <button
                type="button"
                className="text-neutral-400 hover:text-red-600"
                onClick={() => loeschen(d)}
                title="Löschen"
              >
                ✕
              </button>
            )}
          </div>
        ))
      )}
      {canEdit && (
        <>
          <input
            key={dateiSchluessel}
            type="file"
            className="text-xs"
            disabled={laeuft}
            onChange={(e) => {
              const datei = e.target.files?.[0];
              if (datei) hochladen(datei);
            }}
          />
          {fehler && <span className="text-red-600">{fehler}</span>}
        </>
      )}
    </div>
  );
}
