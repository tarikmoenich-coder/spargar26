"use client";

// Kamera-gestützte Ausweisfoto-Aufnahme: zeigt einen gelben Rahmen im
// Kamerabild, in den genau das Passfoto des (physischen) Personalausweises
// gehalten werden soll - beim Auslösen wird NUR dieser Rahmen-Ausschnitt
// zugeschnitten und gespeichert, nie das volle Kamerabild (bewusst: so
// landet nie eine vollständige Ausweiskopie mit Nummer/Geburtsdatum/etc. im
// Foto-Storage, nur der Kopf-Ausschnitt).
//
// Wiederverwendet von app/personalplanung/page.tsx (Nutzer-Vorgabe
// 2026-10-22: Foto muss schon beim Anlegen der Person während der Anreise
// entstehen - sequenzielle Warteschlange über mehrere neu angelegte
// Mitarbeiter) und app/erntewirtschaft/ausweise/page.tsx (nachträglich
// einzeln, falls bei der Anreise übersprungen oder für ältere Mitarbeiter
// ohne Foto).
//
// Speichert direkt in den privaten Storage-Bucket "mitarbeiter-fotos" unter
// dem Pfad "<employee_id>" (ohne Dateiendung, Content-Type separat gesetzt -
// ein erneuter Upload überschreibt denselben Pfad, siehe
// migration_2026-10-22_mitarbeiter_foto.sql) und trägt employees.foto_pfad
// nach.

import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";

const FOTO_BUCKET = "mitarbeiter-fotos";

// Feste Ausgabegröße des zugeschnittenen Fotos (Portrait-Format, passend
// zum Platzhalter auf der Ausweis-Karte, app/erntewirtschaft/ausweise).
const AUSGABE_W = 300;
const AUSGABE_H = 400;

// Größe der Kamera-Vorschau und des gelben Rahmens darin (CSS-Pixel) -
// Seitenverhältnis ~3:4 wie ein typisches Passfoto.
const BOX_W = 320;
const BOX_H = 420;
const RAHMEN_W = 150;
const RAHMEN_H = 200;
const RAHMEN_X = (BOX_W - RAHMEN_W) / 2;
const RAHMEN_Y = (BOX_H - RAHMEN_H) / 2;

interface Props {
  employeeId: string;
  name: string;
  vorname: string;
  // Foto gespeichert ODER bewusst übersprungen - weiter zur nächsten Person
  // (bzw. schließen, wenn es die letzte war).
  onFertig: () => void;
  // Ganze Warteschlange verwerfen (z.B. Kamera funktioniert gerade nicht).
  onAbbrechen: () => void;
}

export default function MitarbeiterFotoAufnahme({
  employeeId,
  name,
  vorname,
  onFertig,
  onAbbrechen,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [speichert, setSpeichert] = useState(false);

  // Neue Kamera-Sitzung je Person (einfacher/robuster als einen Stream über
  // mehrere Personen hinweg am Leben zu halten) - der Elternkomponente gibt
  // per key={employeeId} ohnehin einen kompletten Remount vor.
  useEffect(() => {
    let abgebrochen = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((stream) => {
        if (abgebrochen) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
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

  async function aufnehmen() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    // object-fit: cover - das Video wird gleichmäßig skaliert, bis es die
    // Box füllt, Überschuss wird mittig abgeschnitten. Rahmen-Koordinaten
    // (in Box-Pixeln) zurück in native Video-Pixel umrechnen.
    const scale = Math.max(BOX_W / vw, BOX_H / vh);
    const offsetX = (vw * scale - BOX_W) / 2;
    const offsetY = (vh * scale - BOX_H) / 2;
    const nativeX = (RAHMEN_X + offsetX) / scale;
    const nativeY = (RAHMEN_Y + offsetY) / scale;
    const nativeW = RAHMEN_W / scale;
    const nativeH = RAHMEN_H / scale;

    const canvas = document.createElement("canvas");
    canvas.width = AUSGABE_W;
    canvas.height = AUSGABE_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, nativeX, nativeY, nativeW, nativeH, 0, 0, AUSGABE_W, AUSGABE_H);

    setSpeichert(true);
    setFehler(null);
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setSpeichert(false);
          setFehler("Aufnahme fehlgeschlagen - bitte erneut versuchen.");
          return;
        }
        const supabase = getSupabaseClient();
        const { error: uploadError } = await supabase.storage
          .from(FOTO_BUCKET)
          .upload(employeeId, blob, { upsert: true, contentType: "image/jpeg" });
        if (uploadError) {
          setSpeichert(false);
          setFehler(uploadError.message);
          return;
        }
        const { error: updateError } = await supabase
          .from("employees")
          .update({ foto_pfad: employeeId })
          .eq("id", employeeId);
        setSpeichert(false);
        if (updateError) {
          setFehler(updateError.message);
          return;
        }
        onFertig();
      },
      "image/jpeg",
      0.9
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-4 print:hidden">
      <p className="max-w-xs text-center text-sm text-white">
        Ausweisfoto von {name}, {vorname}
        <br />
        Personalausweis vor die Kamera halten - das Passfoto muss in den
        gelben Rahmen passen.
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
        <div
          className="pointer-events-none absolute border-4 border-yellow-400"
          style={{ left: RAHMEN_X, top: RAHMEN_Y, width: RAHMEN_W, height: RAHMEN_H }}
        />
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
          Ohne Foto weiter
        </button>
        <button
          type="button"
          className="text-xs text-white/70 underline"
          disabled={speichert}
          onClick={onAbbrechen}
        >
          Vorgang abbrechen
        </button>
      </div>
    </div>
  );
}
