"use client";

// Kamera-gestützte Dokumentenaufnahme - deckt zwei Fälle ab (Nutzer-Vorgabe
// 2026-10-26, löst components/MitarbeiterFotoAufnahme.tsx ab):
//
// - modus="ausweis": zeigt zusätzlich einen gelben Rahmen für den
//   Kopf-Ausschnitt (Passfoto auf dem Personalausweis), der separat
//   zugeschnitten und als employees.foto_pfad gespeichert wird (für den
//   Mitarbeiterausweis, siehe app/erntewirtschaft/ausweise). GLEICHZEITIG
//   wird das VOLLE Kamerabild als Dokument "Ausweiskopie" gespeichert -
//   erfüllt automatisch den entsprechenden Punkt der
//   personal_kandidaten_checkliste (siehe app/personal-anreiseliste).
//   Vorher gab es zwei getrennte Wege (Kopf-Ausschnitt hier, Ausweiskopie
//   separat manuell über /personal-dokumente hochladen) - jetzt
//   zusammengeführt, beide Funktionen bleiben erhalten.
// - modus="dokument": kein Rahmen, das volle Kamerabild wird direkt als
//   Dokument der angegebenen Kategorie gespeichert (z.B. "Führerschein
//   Kopie") - kein employees.foto_pfad-Bezug.
//
// Aufnahmeformat ist IMMER Querformat (Nutzer-Vorgabe 2026-10-26, passt zum
// Querformat von Personalausweis/Führerschein - vorher Hochformat).
//
// Verwendet von app/personalplanung/page.tsx (Anreise, modus="ausweis",
// sequenzielle Warteschlange über mehrere neu angelegte Mitarbeiter),
// app/erntewirtschaft/ausweise/page.tsx (modus="ausweis", nachträglich
// einzeln) und app/personal-anreiseliste/page.tsx (modus="ausweis" ODER
// "dokument", per "Dokument hinzufügen"-Auswahl je Person, nie automatisch
// geöffnet).

import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import type { DokumentKategorie } from "@/lib/types";

const FOTO_BUCKET = "mitarbeiter-fotos";
const DOKUMENTE_BUCKET = "mitarbeiter-dokumente";

// Ausgabegröße des Kopf-Ausschnitts (nur modus="ausweis") - Portrait,
// passend zum Platzhalter auf der Ausweis-Karte.
const KOPF_AUSGABE_W = 300;
const KOPF_AUSGABE_H = 400;

// Ausgabegröße des vollen Dokument-Fotos - Lesbarkeit reicht, keine
// Sensor-Vollauflösung nötig (kleinere Datei im Storage).
const DOKUMENT_AUSGABE_W = 1000;

// Kamera-Vorschau QUERFORMAT (Nutzer-Vorgabe 2026-10-26) - der gelbe Rahmen
// sitzt links, wo das Passfoto auf einem deutschen Personalausweis liegt.
const BOX_W = 420;
const BOX_H = 280;
const RAHMEN_W = 110;
const RAHMEN_H = 145;
const RAHMEN_X = 30;
const RAHMEN_Y = (BOX_H - RAHMEN_H) / 2;

interface Props {
  employeeId: string;
  name: string;
  vorname: string;
  modus: "ausweis" | "dokument";
  dokumentKategorie: DokumentKategorie;
  // Foto gespeichert ODER bewusst übersprungen - weiter (bzw. schließen).
  onFertig: () => void;
  // Vorgang abbrechen (z.B. Kamera funktioniert gerade nicht).
  onAbbrechen: () => void;
}

export default function DokumentKameraAufnahme({
  employeeId,
  name,
  vorname,
  modus,
  dokumentKategorie,
  onFertig,
  onAbbrechen,
}: Props) {
  const { profile } = useProfile();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  // Neue Kamera-Sitzung je Aufruf (einfacher/robuster als einen Stream über
  // mehrere Personen/Dokumente hinweg am Leben zu halten) - der
  // Elternkomponente gibt per key={employeeId+modus+kategorie} ohnehin
  // einen kompletten Remount vor.
  useEffect(() => {
    let abgebrochen = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // Ohne Auflösungs-Hinweis wählen manche Handys eine
          // Vorschau-Pipeline mit nur einmaligem Fokus beim Start statt
          // laufendem Autofokus - fürs Dokument-aus-der-Nähe-Halten (anders
          // als ein normales Foto) entscheidend.
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then((stream) => {
        if (abgebrochen) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        // Laufenden Autofokus erzwingen (Nicht-Standard-Erweiterung, v.a.
        // Chrome/Android) - wo nicht unterstützt, schlägt das einfach
        // folgenlos fehl.
        const [track] = stream.getVideoTracks();
        track
          ?.applyConstraints({
            advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
          })
          .catch(() => {});
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setBereit(true);
      })
      .catch((e) => {
        setFehler(e instanceof Error ? e.message : "Kamera-Zugriff nicht möglich.");
      });
    return () => {
      abgebrochen = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function schneideZu(
    video: HTMLVideoElement,
    nativeX: number,
    nativeY: number,
    nativeW: number,
    nativeH: number,
    ausgabeW: number,
    ausgabeH: number
  ): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = ausgabeW;
    canvas.height = ausgabeH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(video, nativeX, nativeY, nativeW, nativeH, 0, 0, ausgabeW, ausgabeH);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  }

  async function aufnehmen() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // object-fit: cover - das Video wird gleichmäßig skaliert, bis es die
    // Box füllt, Überschuss wird mittig abgeschnitten. Koordinaten (in
    // Box-Pixeln) zurück in native Video-Pixel umrechnen.
    const scale = Math.max(BOX_W / vw, BOX_H / vh);
    const offsetX = (vw * scale - BOX_W) / 2;
    const offsetY = (vh * scale - BOX_H) / 2;

    setSpeichert(true);
    setFehler(null);

    try {
      const dokAusgabeH = Math.round((DOKUMENT_AUSGABE_W * BOX_H) / BOX_W);
      const dokBlob = await schneideZu(
        video,
        offsetX / scale,
        offsetY / scale,
        BOX_W / scale,
        BOX_H / scale,
        DOKUMENT_AUSGABE_W,
        dokAusgabeH
      );
      if (!dokBlob) throw new Error("Aufnahme fehlgeschlagen - bitte erneut versuchen.");

      const supabase = getSupabaseClient();

      // Volles Bild IMMER als Dokument speichern (beide Modi).
      const dateiname = `${dokumentKategorie}_${new Date().toISOString().slice(0, 10)}.jpg`;
      const pfad = `${employeeId}/${Date.now()}_${dateiname}`;
      const { error: uploadError } = await supabase.storage
        .from(DOKUMENTE_BUCKET)
        .upload(pfad, dokBlob, { contentType: "image/jpeg" });
      if (uploadError) throw new Error(uploadError.message);

      const { error: insertError } = await supabase.from("employee_documents").insert({
        employee_id: employeeId,
        kategorie: dokumentKategorie,
        dateiname,
        storage_path: pfad,
        hochgeladen_von: profile?.id ?? null,
      });
      if (insertError) throw new Error(insertError.message);

      // Bei "ausweis" zusätzlich den Kopf-Ausschnitt zuschneiden und als
      // employees.foto_pfad speichern (für den Mitarbeiterausweis).
      if (modus === "ausweis") {
        const kopfBlob = await schneideZu(
          video,
          (RAHMEN_X + offsetX) / scale,
          (RAHMEN_Y + offsetY) / scale,
          RAHMEN_W / scale,
          RAHMEN_H / scale,
          KOPF_AUSGABE_W,
          KOPF_AUSGABE_H
        );
        if (!kopfBlob) throw new Error("Kopf-Ausschnitt fehlgeschlagen.");
        const { error: fotoUploadError } = await supabase.storage
          .from(FOTO_BUCKET)
          .upload(employeeId, kopfBlob, { upsert: true, contentType: "image/jpeg" });
        if (fotoUploadError) throw new Error(fotoUploadError.message);
        const { error: fotoUpdateError } = await supabase
          .from("employees")
          .update({ foto_pfad: employeeId })
          .eq("id", employeeId);
        if (fotoUpdateError) throw new Error(fotoUpdateError.message);
      }

      setSpeichert(false);
      onFertig();
    } catch (e) {
      setSpeichert(false);
      setFehler(e instanceof Error ? e.message : "Unbekannter Fehler.");
    }
  }

  const titel = modus === "ausweis" ? "Personalausweis" : dokumentKategorie;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-4 print:hidden">
      <p className="max-w-sm text-center text-sm text-white">
        {titel} von {name}, {vorname}
        <br />
        {modus === "ausweis"
          ? "Personalausweis quer vor die Kamera halten - das Passfoto muss in den gelben Rahmen passen."
          : `${dokumentKategorie} quer vor die Kamera halten, komplett im Bild.`}
      </p>
      <div
        className="relative overflow-hidden rounded bg-black"
        style={{ width: BOX_W, height: BOX_H }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {modus === "ausweis" && (
          <div
            className="pointer-events-none absolute border-4 border-yellow-400"
            style={{ left: RAHMEN_X, top: RAHMEN_Y, width: RAHMEN_W, height: RAHMEN_H }}
          />
        )}
      </div>
      {fehler && <p className="max-w-xs text-center text-sm text-red-300">{fehler}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="btn"
          disabled={!bereit || speichert}
          onClick={aufnehmen}
        >
          Foto aufnehmen
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={speichert}
          onClick={onFertig}
        >
          Überspringen
        </button>
        <button
          type="button"
          className="text-xs text-white/70 underline"
          disabled={speichert}
          onClick={onAbbrechen}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
