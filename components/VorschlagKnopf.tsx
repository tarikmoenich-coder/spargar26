"use client";

// "Änderung vorschlagen" - Glühbirne auf jeder Seite (Nutzer 2026-11-26).
// Gelber runder Knopf mit schwarzem Rand unten rechts. Klick: Bildschirmfoto
// der aktuellen Ansicht (ohne den Knopf), dann ein Fenster mit Textfeld und
// dem Foto, auf dem man malen und Text setzen kann. Gespeichert wird in
// verbesserungsvorschlag (Seite automatisch, wer/wann über die Datenbank);
// lesen kann das nur Admin unter /vorschlaege.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Bug, Eraser, Lightbulb, Pencil, PencilLine, Sparkles, Type, Undo2, X, type LucideIcon } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { hatRolle } from "@/lib/rollen";

type Strich = { typ: "linie"; farbe: string; punkte: [number, number][] } | { typ: "text"; farbe: string; x: number; y: number; text: string };
const FARBEN = ["#dc2626", "#2563eb", "#111827"];
const MAX_BREITE = 1600;
// Art des Vorschlags (Nutzer 2026-11-26) - einfache Worte statt Fachbegriffe
export const ARTEN: { wert: "fehler" | "aenderung" | "neu"; Icon: LucideIcon; label: string; hinweis: string }[] = [
  { wert: "fehler", Icon: Bug, label: "Etwas geht nicht", hinweis: "Fehler, falsche Anzeige, Knopf geht nicht" },
  { wert: "aenderung", Icon: PencilLine, label: "Bitte ändern", hinweis: "Etwas Vorhandenes soll anders sein" },
  { wert: "neu", Icon: Sparkles, label: "Neue Idee", hinweis: "Das gibt es noch gar nicht" },
];

function seitenTitel(): string {
  const h1 = document.querySelector("main h1");
  return (h1?.textContent || document.title || "").trim().slice(0, 200);
}

function Knopf() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { profile } = useProfile();
  const istAdmin = hatRolle(profile, "admin");
  const [offen, setOffen] = useState(false);
  const [foto, setFoto] = useState<HTMLImageElement | null>(null);
  const [fotoLaeuft, setFotoLaeuft] = useState(false);
  const [mitFoto, setMitFoto] = useState(true);
  const [text, setText] = useState("");
  const [art, setArt] = useState<"fehler" | "aenderung" | "neu" | null>(null);
  const [striche, setStriche] = useState<Strich[]>([]);
  const [werkzeug, setWerkzeug] = useState<"stift" | "text">("stift");
  const [farbe, setFarbe] = useState(FARBEN[0]);
  const [senden, setSenden] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [anzahlOffen, setAnzahlOffen] = useState(0);
  const [seite, setSeite] = useState({ pfad: "", titel: "" });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const malt = useRef(false);

  // Admin: Zahl offener Vorschläge am Knopf
  useEffect(() => {
    if (!istAdmin) return;
    getSupabaseClient()
      .from("verbesserungsvorschlag")
      .select("id", { count: "exact", head: true })
      .eq("status", "offen")
      .then(({ count }) => setAnzahlOffen(count ?? 0));
  }, [istAdmin, pathname, meldung]);

  const zeichnen = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !foto) return;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(foto, 0, 0, c.width, c.height);
    const dicke = Math.max(3, c.width / 300);
    for (const s of striche) {
      ctx.strokeStyle = s.farbe;
      ctx.fillStyle = s.farbe;
      if (s.typ === "linie") {
        ctx.lineWidth = dicke;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        s.punkte.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      } else {
        const gr = Math.max(18, c.width / 55);
        ctx.font = `bold ${gr}px sans-serif`;
        const w = ctx.measureText(s.text).width;
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(s.x - 4, s.y - gr, w + 8, gr * 1.3);
        ctx.fillStyle = s.farbe;
        ctx.fillText(s.text, s.x, s.y);
      }
    }
  }, [foto, striche]);
  useEffect(() => {
    zeichnen();
  }, [zeichnen]);

  async function oeffnen() {
    setMeldung(null);
    setFehler(null);
    setText("");
    setArt(null);
    setStriche([]);
    setSeite({ pfad: `${pathname}${params.toString() ? `?${params.toString()}` : ""}`, titel: seitenTitel() });
    setFotoLaeuft(true);
    setOffen(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const skala = Math.min(1, MAX_BREITE / window.innerWidth);
      const bild = await html2canvas(document.body, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        scale: skala * (window.devicePixelRatio > 1 ? 1 : 1),
        useCORS: true,
        logging: false,
        ignoreElements: (el) => el.hasAttribute?.("data-vorschlag-ignorieren"),
      });
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        if (c) {
          c.width = img.width;
          c.height = img.height;
        }
        setFoto(img);
        setMitFoto(true);
        setFotoLaeuft(false);
      };
      img.src = bild.toDataURL("image/png");
    } catch {
      setFoto(null);
      setMitFoto(false);
      setFotoLaeuft(false);
    }
  }

  function punkt(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  }
  function runter(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = punkt(e);
    if (werkzeug === "text") {
      const t = window.prompt("Text an dieser Stelle:");
      if (t && t.trim()) setStriche((s) => [...s, { typ: "text", farbe, x: p[0], y: p[1], text: t.trim() }]);
      return;
    }
    malt.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setStriche((s) => [...s, { typ: "linie", farbe, punkte: [p] }]);
  }
  function bewegen(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!malt.current) return;
    const p = punkt(e);
    setStriche((s) => {
      const letzte = s[s.length - 1];
      if (!letzte || letzte.typ !== "linie") return s;
      return [...s.slice(0, -1), { ...letzte, punkte: [...letzte.punkte, p] }];
    });
  }
  function hoch() {
    malt.current = false;
  }

  async function absenden() {
    if (!art) return setFehler("Bitte oben auswählen: Etwas geht nicht / Bitte ändern / Neue Idee.");
    if (!text.trim()) return setFehler("Bitte kurz beschreiben, was geändert werden soll.");
    setSenden(true);
    setFehler(null);
    let screenshot: string | null = null;
    if (mitFoto && foto && canvasRef.current) {
      const c = canvasRef.current;
      const f = Math.min(1, MAX_BREITE / c.width);
      const aus = document.createElement("canvas");
      aus.width = Math.round(c.width * f);
      aus.height = Math.round(c.height * f);
      aus.getContext("2d")!.drawImage(c, 0, 0, aus.width, aus.height);
      screenshot = aus.toDataURL("image/jpeg", 0.72);
    }
    // ohne .select(): Nutzer dürfen ihren Vorschlag danach nicht lesen (nur Admin)
    const { error } = await getSupabaseClient()
      .from("verbesserungsvorschlag")
      .insert({ seite: seite.pfad, seite_titel: seite.titel || null, art, text: text.trim(), screenshot });
    setSenden(false);
    if (error) return setFehler(error.message);
    setOffen(false);
    setMeldung("Danke! Dein Vorschlag ist angekommen.");
    setTimeout(() => setMeldung(null), 4000);
  }

  if (!profile || pathname === "/login") return null;

  return (
    <>
      <div className="fixed bottom-5 right-5 z-[70] print:hidden" data-vorschlag-ignorieren="">
        {meldung && <div className="absolute bottom-16 right-0 w-64 rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 shadow">{meldung}</div>}
        <button
          onClick={oeffnen}
          className="group relative flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-black bg-yellow-300 shadow-lg transition hover:scale-105 hover:bg-yellow-200"
          aria-label="Änderung vorschlagen"
        >
          <Lightbulb className="h-7 w-7 text-black" strokeWidth={2.4} />
          <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded bg-black px-2 py-1 text-sm font-medium text-white opacity-0 transition group-hover:opacity-100">
            Änderung vorschlagen
          </span>
          {istAdmin && anzahlOffen > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-beere-600 px-1 text-[11px] font-bold text-white">
              {anzahlOffen}
            </span>
          )}
        </button>
      </div>

      {offen && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-3 print:hidden" data-vorschlag-ignorieren="">
          <div className="mt-4 flex w-full max-w-4xl flex-col gap-3 rounded-lg border-2 border-black bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-black bg-yellow-300">
                  <Lightbulb className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-semibold">Änderung vorschlagen</h2>
                  <p className="text-xs text-neutral-500">
                    Seite: <span className="font-mono">{seite.pfad}</span>
                    {seite.titel && ` · ${seite.titel}`}
                  </p>
                </div>
              </div>
              <button className="rounded p-1 hover:bg-neutral-100" onClick={() => setOffen(false)} title="schließen">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ARTEN.map((a) => (
                <button
                  key={a.wert}
                  onClick={() => setArt(a.wert)}
                  className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-left ${
                    art === a.wert ? "border-black bg-yellow-200" : "border-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  <a.Icon className="h-7 w-7 shrink-0" />
                  <span>
                    <span className="block font-semibold">{a.label}</span>
                    <span className="block text-xs text-neutral-600">{a.hinweis}</span>
                  </span>
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Was soll geändert werden?
              <textarea
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="z.B. Hier fehlt eine Spalte für …, dieser Knopf ist schwer zu finden, …"
              />
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={mitFoto} disabled={!foto} onChange={(e) => setMitFoto(e.target.checked)} />
                  Bildschirmfoto mitschicken
                </label>
                {foto && mitFoto && (
                  <>
                    <span className="ml-2 text-neutral-400">|</span>
                    <button
                      className={`flex items-center gap-1 rounded border px-2 py-0.5 ${werkzeug === "stift" ? "border-black bg-yellow-100" : "border-linie"}`}
                      onClick={() => setWerkzeug("stift")}
                      title="Malen / einkreisen"
                    >
                      <Pencil className="h-4 w-4" /> malen
                    </button>
                    <button
                      className={`flex items-center gap-1 rounded border px-2 py-0.5 ${werkzeug === "text" ? "border-black bg-yellow-100" : "border-linie"}`}
                      onClick={() => setWerkzeug("text")}
                      title="Ins Bild klicken, um Text zu setzen"
                    >
                      <Type className="h-4 w-4" /> Text
                    </button>
                    {FARBEN.map((f) => (
                      <button
                        key={f}
                        className={`h-6 w-6 rounded-full border-2 ${farbe === f ? "border-black" : "border-white ring-1 ring-neutral-300"}`}
                        style={{ background: f }}
                        onClick={() => setFarbe(f)}
                        title="Farbe"
                      />
                    ))}
                    <button className="flex items-center gap-1 rounded border border-linie px-2 py-0.5" onClick={() => setStriche((s) => s.slice(0, -1))} disabled={!striche.length}>
                      <Undo2 className="h-4 w-4" /> zurück
                    </button>
                    <button className="flex items-center gap-1 rounded border border-linie px-2 py-0.5" onClick={() => setStriche([])} disabled={!striche.length}>
                      <Eraser className="h-4 w-4" /> alles weg
                    </button>
                  </>
                )}
              </div>
              {fotoLaeuft && <p className="text-sm text-neutral-500">Bildschirmfoto wird erstellt …</p>}
              {!fotoLaeuft && !foto && <p className="text-sm text-neutral-500">Kein Bildschirmfoto möglich - der Text reicht auch.</p>}
              <canvas
                ref={canvasRef}
                className={`w-full touch-none rounded border border-neutral-300 ${foto && mitFoto ? "" : "hidden"} ${werkzeug === "text" ? "cursor-text" : "cursor-crosshair"}`}
                onPointerDown={runter}
                onPointerMove={bewegen}
                onPointerUp={hoch}
                onPointerLeave={hoch}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" onClick={absenden} disabled={senden || fotoLaeuft}>
                {senden ? "Sendet …" : "Vorschlag abschicken"}
              </button>
              <button className="btn-secondary" onClick={() => setOffen(false)}>
                Abbrechen
              </button>
              <span className="text-xs text-neutral-500">Dein Name, die Seite und die Uhrzeit werden automatisch mitgeschickt. Lesen kann das nur der Admin.</span>
              {fehler && <span className="text-sm text-beere-600">{fehler}</span>}
              {istAdmin && (
                <Link href="/vorschlaege" className="ml-auto text-sm text-emerald-700 underline" onClick={() => setOffen(false)}>
                  alle Vorschläge ansehen
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function VorschlagKnopf() {
  return (
    <Suspense fallback={null}>
      <Knopf />
    </Suspense>
  );
}
