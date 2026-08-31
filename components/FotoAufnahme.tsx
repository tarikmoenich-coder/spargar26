"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  UNTERKUNFT_FOTOS_BUCKET,
  bildVerkleinern,
  fotoStoragePfad,
} from "@/lib/unterkunft";
import type { UnterkunftFoto } from "@/lib/types";

interface Props {
  zimmerId: number;
  // Genau eines von beiden: Fotos hängen an einem Vorgang (ggf. an einem
  // Checklisten-Bereich) ODER an einem Mangel.
  vorgangId?: string;
  mangelId?: number;
  // Nur bei vorgangId: an eine Checklisten-Position gebunden.
  bereich?: string | null;
  // Fotos eines abgeschlossenen Vorgangs sind serverseitig gesperrt (Trigger),
  // hier zusätzlich die UI abschalten.
  disabled?: boolean;
  onChange?: () => void;
}

interface FotoMitUrl extends UnterkunftFoto {
  signierteUrl: string | null;
}

export default function FotoAufnahme({
  zimmerId,
  vorgangId,
  mangelId,
  bereich = null,
  disabled = false,
  onChange,
}: Props) {
  const [fotos, setFotos] = useState<FotoMitUrl[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const anMangel = mangelId != null;

  const laden = useCallback(async () => {
    const supabase = getSupabaseClient();
    let query = supabase
      .from("unterkunft_foto")
      .select("*")
      .order("hochgeladen_am", { ascending: true });
    if (anMangel) {
      query = query.eq("mangel_id", mangelId);
    } else {
      query = query.eq("vorgang_id", vorgangId ?? "");
      query = bereich === null ? query.is("bereich", null) : query.eq("bereich", bereich);
    }
    const { data, error } = await query;
    if (error) {
      setFehler(error.message);
      return;
    }
    const zeilen = (data as UnterkunftFoto[]) ?? [];
    const pfade = zeilen.map((z) => z.storage_path);
    const urls: Record<string, string> = {};
    if (pfade.length > 0) {
      const { data: signed } = await supabase.storage
        .from(UNTERKUNFT_FOTOS_BUCKET)
        .createSignedUrls(pfade, 600);
      (signed ?? []).forEach((s) => {
        if (s.signedUrl && s.path) urls[s.path] = s.signedUrl;
      });
    }
    setFotos(
      zeilen.map((z) => ({ ...z, signierteUrl: urls[z.storage_path] ?? null }))
    );
  }, [anMangel, mangelId, vorgangId, bereich]);

  useEffect(() => {
    laden();
  }, [laden]);

  async function dateienWaehlen(e: React.ChangeEvent<HTMLInputElement>) {
    const dateien = Array.from(e.target.files ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (dateien.length === 0) return;

    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const pfadSchluessel = anMangel ? `mangel-${mangelId}` : vorgangId ?? "unbekannt";
    try {
      for (const datei of dateien) {
        const { blob, breite, hoehe, aufgenommen_am } = await bildVerkleinern(datei);
        const pfad = fotoStoragePfad(zimmerId, pfadSchluessel);
        const { error: uploadError } = await supabase.storage
          .from(UNTERKUNFT_FOTOS_BUCKET)
          .upload(pfad, blob, { contentType: "image/jpeg" });
        if (uploadError) throw new Error(uploadError.message);

        const { error: insertError } = await supabase.from("unterkunft_foto").insert({
          vorgang_id: anMangel ? null : vorgangId,
          mangel_id: anMangel ? mangelId : null,
          bereich: anMangel ? null : bereich,
          storage_path: pfad,
          dateiname: datei.name || "foto.jpg",
          breite,
          hoehe,
          aufgenommen_am,
        });
        if (insertError) {
          await supabase.storage.from(UNTERKUNFT_FOTOS_BUCKET).remove([pfad]);
          throw new Error(insertError.message);
        }
      }
      await laden();
      onChange?.();
    } catch (err) {
      setFehler(err instanceof Error ? err.message : "Foto-Upload fehlgeschlagen.");
    } finally {
      setLaeuft(false);
    }
  }

  async function loeschen(foto: FotoMitUrl) {
    if (!window.confirm("Dieses Foto löschen?")) return;
    setLaeuft(true);
    setFehler(null);
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("unterkunft_foto").delete().eq("id", foto.id);
    if (error) {
      setFehler(error.message);
      setLaeuft(false);
      return;
    }
    await supabase.storage.from(UNTERKUNFT_FOTOS_BUCKET).remove([foto.storage_path]);
    await laden();
    onChange?.();
    setLaeuft(false);
  }

  return (
    <div className="space-y-2">
      {fotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fotos.map((foto) => {
            // Im Mangel-Kontext: Fotos, die zusätzlich an einem Vorgang hängen,
            // stammen aus einer Übergabe/Kontrolle. Sie werden hier nur gezeigt
            // (löschen ginge nur im - abgeschlossenen - Vorgang).
            const geerbt = anMangel && foto.vorgang_id != null;
            const zeitpunkt = foto.aufgenommen_am ?? foto.hochgeladen_am;
            const stempel = zeitpunkt
              ? new Date(zeitpunkt).toLocaleString("de-DE", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null;
            return (
              <div
                key={foto.id}
                className="flex flex-col items-center gap-0.5"
              >
                <div className="relative">
                {foto.signierteUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a href={foto.signierteUrl} target="_blank" rel="noreferrer">
                    <img
                      src={foto.signierteUrl}
                      alt={foto.dateiname}
                      className="h-24 w-24 rounded border border-neutral-300 object-cover"
                    />
                  </a>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded border border-neutral-300 text-xs text-neutral-400">
                    ?
                  </div>
                )}
                {geerbt && (
                  <span className="absolute bottom-0 left-0 right-0 rounded-b bg-black/55 px-1 py-0.5 text-center text-[10px] leading-tight text-white">
                    aus Kontrolle
                  </span>
                )}
                {!disabled && !geerbt && (
                  <button
                    type="button"
                    onClick={() => loeschen(foto)}
                    disabled={laeuft}
                    title="Foto löschen"
                    className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-red-600 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    ×
                  </button>
                )}
                </div>
                <span className="text-[10px] leading-tight text-neutral-500">
                  {stempel ?? "—"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!disabled && (
        <label className="btn-secondary inline-block cursor-pointer">
          {laeuft ? "Lädt …" : "Foto hinzufügen"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={laeuft}
            onChange={dateienWaehlen}
          />
        </label>
      )}

      {fehler && <p className="text-sm text-red-600">{fehler}</p>}
    </div>
  );
}
