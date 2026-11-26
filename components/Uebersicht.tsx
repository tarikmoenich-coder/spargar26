// Bausteine für Übersichts-/Startseiten im Stil der QM-App (Nutzer
// 2026-11-26: "Das Design von der QM-Seite gefällt uns sehr gut"):
// große Begrüßung mit Datum, kleine Abschnitts-Überschriften in
// Großbuchstaben, Karten mit farbigem Symbol, großer Zahl rechts, den
// wichtigsten Einträgen als Liste und einem "Alle …"-Link unten.

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export type Ton = "rot" | "gelb" | "gruen" | "grau";

const TON_TEXT: Record<Ton, string> = {
  rot: "text-beere-700",
  gelb: "text-amber-700",
  gruen: "text-emerald-700",
  grau: "text-neutral-400",
};

// Farbe des Symbol-Kästchens je Bereich (wie QM: emerald/amber/sky/...).
export const SYMBOL_FARBE = {
  gruen: "bg-emerald-50 text-emerald-700",
  gelb: "bg-amber-50 text-amber-700",
  blau: "bg-sky-50 text-sky-700",
  orange: "bg-orange-50 text-orange-700",
  lila: "bg-violet-50 text-violet-700",
  rot: "bg-beere-50 text-beere-700",
  grau: "bg-neutral-100 text-neutral-600",
} as const;
export type SymbolFarbe = keyof typeof SYMBOL_FARBE;

export function Begruessung({
  datum,
  titel,
  hinweise,
}: {
  datum: string;
  titel: string;
  hinweise?: { href: string; text: string; icon: LucideIcon }[];
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-emerald-700">{datum}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 sm:text-3xl">{titel}</h1>
      </div>
      {hinweise && hinweise.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {hinweise.map(({ href, text, icon: Icon }) => (
            <Link
              key={href + text}
              href={href}
              className="inline-flex items-center gap-2 rounded-lg border border-beere-200 bg-beere-50 px-3 py-2 text-sm font-medium text-beere-800 transition hover:bg-beere-100"
            >
              <Icon className="h-4 w-4" />
              {text}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Abschnitt({
  titel,
  rechts,
  children,
}: {
  titel: string;
  rechts?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{titel}</h2>
        {rechts && <div className="text-xs text-neutral-500">{rechts}</div>}
      </div>
      {children}
    </section>
  );
}

export function KarteRahmen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-xl border border-linie bg-white p-5 shadow-card ${className}`}>{children}</div>;
}

export type Eintrag = {
  key: string | number;
  text: React.ReactNode;
  href?: string;
  rechts?: React.ReactNode;
  ton?: Ton;
  fett?: boolean;
};

// Karte mit Symbol, Titel, großer Zahl rechts, optionaler Unterzeile, bis zu
// `max` Einträgen und einem Link unten. Bei `fehler` erscheint statt einer
// (falschen) Null ein Strich und der Hinweis.
export function ListenKarte({
  icon: Icon,
  farbe = "gruen",
  titel,
  zahl,
  zahlTon,
  unter,
  eintraege = [],
  max = 5,
  leer,
  link,
  fehler,
  laedt,
  children,
}: {
  icon: LucideIcon;
  farbe?: SymbolFarbe;
  titel: string;
  zahl?: number | string | null;
  zahlTon?: Ton;
  unter?: React.ReactNode;
  eintraege?: Eintrag[];
  max?: number;
  leer?: React.ReactNode;
  link?: { href: string; text: string };
  fehler?: string | null;
  laedt?: boolean;
  children?: React.ReactNode;
}) {
  const zahlKlasse = zahlTon && zahlTon !== "grau" ? TON_TEXT[zahlTon] : "text-neutral-900";
  return (
    <KarteRahmen className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <span className={`rounded-lg p-2 ${SYMBOL_FARBE[farbe]}`}>
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="font-semibold text-neutral-900">{titel}</h2>
        {zahl !== undefined && zahl !== null && (
          <span className={`ml-auto text-2xl font-semibold tabular-nums ${laedt || fehler ? "text-neutral-300" : zahlKlasse}`}>
            {laedt ? "…" : fehler ? "—" : zahl}
          </span>
        )}
      </div>
      {fehler ? (
        <p className="mt-2 text-sm text-beere-700" title={fehler}>
          Konnte nicht geladen werden.
        </p>
      ) : (
        <>
          {unter && <div className="mt-2 text-sm text-neutral-500">{unter}</div>}
          {!laedt && eintraege.length > 0 && (
            <ul className="mt-3 divide-y divide-linie text-sm">
              {eintraege.slice(0, max).map((e) => {
                const inhalt = (
                  <span className={`truncate ${e.fett ? "font-medium" : ""}`}>{e.text}</span>
                );
                return (
                  <li key={e.key} className="flex items-center justify-between gap-3 py-1.5">
                    {e.href ? (
                      <Link href={e.href} className="min-w-0 truncate hover:text-emerald-800 hover:underline">
                        {inhalt}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate">{inhalt}</span>
                    )}
                    {e.rechts !== undefined && (
                      <span className={`shrink-0 tabular-nums ${TON_TEXT[e.ton ?? "grau"]} ${e.ton && e.ton !== "grau" ? "font-medium" : ""}`}>
                        {e.rechts}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!laedt && eintraege.length === 0 && leer && <p className="mt-3 text-sm text-neutral-500">{leer}</p>}
          {children}
        </>
      )}
      {link && (
        <div className="mt-auto pt-3">
          <Link href={link.href} className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline">
            {link.text} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </KarteRahmen>
  );
}

// Kleine Kennzahl-Kachel (Zahl groß, Beschriftung klein) für "Heute"-Zeilen.
export function Kennzahl({
  icon: Icon,
  titel,
  wert,
  unter,
  ton,
  href,
  title,
}: {
  icon?: LucideIcon;
  titel: string;
  wert: React.ReactNode;
  unter?: React.ReactNode;
  ton?: Ton;
  href?: string;
  title?: string;
}) {
  const inhalt = (
    <>
      <div className="flex items-center gap-1.5 text-sm text-neutral-500">
        {Icon && <Icon className="h-4 w-4 text-neutral-400" />}
        {titel}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${ton && ton !== "grau" ? TON_TEXT[ton] : "text-neutral-900"}`}>{wert}</div>
      {unter && <div className="mt-0.5 text-xs text-neutral-500">{unter}</div>}
    </>
  );
  const k = "block rounded-xl border border-linie bg-white px-4 py-3 shadow-card";
  return href ? (
    <Link href={href} title={title} className={`${k} transition hover:border-emerald-300 hover:shadow-md`}>
      {inhalt}
    </Link>
  ) : (
    <div className={k} title={title}>
      {inhalt}
    </div>
  );
}

// Fortschrittsring wie in der QM-Übersicht.
export function Ring({ prozent, groesse = 64 }: { prozent: number; groesse?: number }) {
  const r = 26;
  const u = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, prozent));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: groesse, height: groesse }}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="#ebe6d8" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={p >= 90 ? "#338a22" : p >= 60 ? "#61c246" : "#f59e0b"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * u} ${u}`}
        />
      </svg>
      <span className="relative text-sm font-semibold text-neutral-800">{Math.round(p)}%</span>
    </span>
  );
}
