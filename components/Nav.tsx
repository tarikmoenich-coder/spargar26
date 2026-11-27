"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  Gauge,
  History,
  Lightbulb,
  LayoutDashboard,
  LogOut,
  Menu,
  Notebook,
  Search,
  Settings,
  SlidersHorizontal,
  Sprout,
  Store,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/useProfile";
import { SPRACHEN, type Sprache } from "@/lib/i18n";
import { rollenVon, rolleLabel, nurHausmeisterSicht, MENUE_RECHTE, darfMenue } from "@/lib/rollen";
import { useBereiche } from "@/lib/useBereiche";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  // Weitere Pfade, die diesen Menüpunkt ebenfalls als aktiv markieren sollen
  // (z.B. Unterseiten wie Personalnummern/Import unter "Personal").
  auchAktivBei?: string[];
  // Nur sichtbar, wenn der Nutzer diesen Geschäftsbereich sieht (die
  // Datenbank filtert ohnehin - so bleibt das Menü bei LW-Nutzern leer).
  bereich?: string;
}

const items: NavItem[] = [
  {
    href: "/dashboard",
    label: "Start",
    icon: LayoutDashboard,
  },
  {
    href: "/mitarbeiter",
    label: "Personal",
    icon: Users,
    auchAktivBei: [
      "/personalnummern",
      "/personal-import",
      "/personal-import-historie",
      "/personal-import-hsc",
      "/personal-import-hsc-lw",
      "/personal-zusammenfuehren",
      "/personal-dokumente",
      "/personalplanung",
      "/personal-anreiseliste",
      "/personal-sozialversicherung",
      "/personal-firmenhandys",
      "/personal-lohnsteuer",
      "/personalstammkarte",
    ],
  },
  {
    href: "/unterkunft",
    label: "Unterkunft",
    icon: Building2,
    // hausmeister sieht ausschliesslich dieses Modul (Immobilien, Auszüge,
    // Mängel, Reparaturen - lib/rollen.ts nurHausmeisterSicht). erntewirtschaft
    // nur lesend (Durchsetzung via RLS).
  },
  {
    href: "/fahrzeuge",
    label: "Fahrzeuge",
    icon: Truck,
    // GPS-Flotte (Traccar). Stufe 1: admin/hr pflegen, management liest.
  },
  {
    href: "/erfassung",
    label: "Stundenerfassung",
    icon: Clock,
    auchAktivBei: ["/erfassung-import", "/arbeitskleidung", "/lager"],
  },
  {
    href: "/suche",
    label: "Suche",
    icon: Search,
    // Alle ausser hausmeister und waage (MENUE_RECHTE).
  },
  {
    href: "/uebersicht",
    label: "Lohn",
    icon: Wallet,
    auchAktivBei: ["/vorschuesse", "/auszahlungen"],
  },
  {
    // Prämien + Anbau + Statistik unter einem Menüpunkt (Nutzer-Vorgabe) -
    // die Unterreiter kommen aus components/ErntewirtschaftTabs.tsx.
    href: "/erntewirtschaft",
    label: "Erntewirtschaft",
    icon: Sprout,
    auchAktivBei: ["/praemien", "/anbau", "/statistik", "/qualitaet"],
  },
  {
    // Vertriebsplanung (docs/vertriebsplanung-plan.md): Stände, Touren,
    // Verfügbarkeit, Grundplan.
    href: "/vertrieb",
    label: "Vertrieb",
    icon: Store,
    bereich: "VT",
  },
  {
    href: "/kasse",
    label: "Kassenbuch",
    icon: Notebook,
    auchAktivBei: ["/kasse-pruefung"],
  },
  {
    href: "/management",
    label: "Controlling",
    icon: Gauge,
  },
  {
    href: "/aenderungsprotokoll",
    label: "Protokoll",
    icon: History,
  },
  {
    // Glühbirnen-Vorschläge aller Nutzer (nur Admin), Nutzer 2026-11-26
    href: "/vorschlaege",
    label: "Vorschläge",
    icon: Lightbulb,
  },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    icon: Settings,
    auchAktivBei: [
      "/einstellungen/arbeitsgruppen",
      "/einstellungen/herkuenfte",
      "/einstellungen/einsatzbereiche",
      "/einstellungen/nutzer",
    ],
  },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();
  const bereiche = useBereiche(profile);
  // Unter `lg` (Telefon/kleines Tablet) sind die Bereichs-Links + Name/Rolle
  // + Sprache + Abmelden in eine Schublade ausgelagert - vorher lagen alle
  // ~13 Links plus der Rolle-Block in einer festen 56px-Zeile und
  // überlappten am Telefon (Nutzer-Vorgabe 2026-09-01).
  const [menuOffen, setMenuOffen] = useState(false);
  // Selbst ausgeblendete Menüpunkte (Nutzer-Vorgabe 2026-11-27: "sehen
  // DÜRFEN heißt nicht, es ständig sehen WOLLEN"). Reine Anzeige: über
  // "Mehr" bzw. "Ausgeblendet" bleibt jeder Punkt mit einem Klick erreichbar.
  const [ausgeblendet, setAusgeblendet] = useState<string[]>([]);
  const [mehrOffen, setMehrOffen] = useState(false);
  const [anpassenOffen, setAnpassenOffen] = useState(false);
  const [ausgeblendetAufgeklappt, setAusgeblendetAufgeklappt] = useState(false);

  useEffect(() => {
    setAusgeblendet(profile?.menue_ausgeblendet ?? []);
  }, [profile?.menue_ausgeblendet]);

  // Beim Seitenwechsel die Schublade schließen.
  useEffect(() => {
    setMenuOffen(false);
    setMehrOffen(false);
  }, [pathname]);

  // Body-Scroll sperren, solange die Schublade offen ist.
  useEffect(() => {
    if (!menuOffen) return;
    const vorher = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = vorher;
    };
  }, [menuOffen]);

  // Verhindert, dass das Mausrad den Wert eines fokussierten Zahlenfelds
  // ändert (Browser-Standardverhalten bei input[type=number]) - führt sonst
  // dazu, dass z.B. beim Scrollen über die Stundenerfassung unbemerkt
  // Werte verändert werden. App-weit statt nur auf einer Seite, da dasselbe
  // Risiko auch bei anderen Zahlenfeldern (Beträge, Sätze) besteht. Der
  // Listener defokussiert nur - die normale Seiten-Scrollbewegung bleibt
  // unangetastet.
  useEffect(() => {
    function onWheel() {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number") {
        el.blur();
      }
    }
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  if (pathname === "/login") return null;

  async function logout() {
    await getSupabaseClient().auth.signOut();
    router.push("/login");
  }

  // Je Nutzer (nicht je Rolle) gespeichert, siehe profiles.sprache -
  // betrifft nur die Bedienoberfläche, keine Dokumente/Formulare
  // (Nutzer-Vorgabe 2026-08-08). Voller Reload nach dem Ändern, da
  // useProfile() auf jeder Seite unabhängig lädt (kein geteilter Kontext)
  // - so sehen Navigation UND aktuelle Seite garantiert konsistent die
  // neue Sprache.
  async function spracheAendern(neueSprache: Sprache) {
    if (!profile) return;
    const { error } = await getSupabaseClient()
      .from("profiles")
      .update({ sprache: neueSprache })
      .eq("id", profile.id);
    if (error) {
      alert(`Konnte nicht gespeichert werden: ${error.message}`);
      return;
    }
    window.location.reload();
  }

  // Umschalter Geschäftsbereich (Stufe 2): nur für Nutzer mit mehreren
  // Bereichen. Speichert die Ansicht im eigenen Profil - die Datenbank
  // filtert dann jede Seite automatisch.
  async function bereichAendern(neu: string) {
    if (!profile) return;
    const { error } = await getSupabaseClient()
      .from("profiles")
      .update({ bereich_ansicht: neu || null })
      .eq("id", profile.id);
    if (error) {
      alert(`Konnte nicht gespeichert werden: ${error.message}`);
      return;
    }
    window.location.reload();
  }
  const bereichWahl = profile && bereiche.mehrere && (
    <select
      value={bereiche.ansicht ?? ""}
      onChange={(e) => bereichAendern(e.target.value)}
      title="Welcher Bereich wird angezeigt (Landwirtschaft / Vertrieb)"
      className={`text-xs ${bereiche.ansicht ? "border-amber-400 bg-amber-50" : ""}`}
    >
      <option value="">Alle Bereiche</option>
      {bereiche.alle
        .filter((b) => bereiche.erlaubt.includes(b.kuerzel))
        .map((b) => (
          <option key={b.kuerzel} value={b.kuerzel}>
            {b.bezeichnung}
          </option>
        ))}
    </select>
  );

  const sichtbareItems = items.filter(
    (item) =>
      darfMenue(profile, item.href) &&
      (!item.bereich ||
        (bereiche.erlaubt.includes(item.bereich) &&
          (!bereiche.ansicht || bereiche.ansicht === item.bereich)))
  );
  // Ausblendbar ist alles außer der Startseite.
  const ausblendbar = (item: NavItem) => item.href !== "/dashboard";
  const istAusgeblendet = (item: NavItem) => ausblendbar(item) && ausgeblendet.includes(item.href);

  async function sichtbarkeitUmschalten(href: string) {
    if (!profile) return;
    const vorher = ausgeblendet;
    const neu = vorher.includes(href) ? vorher.filter((h) => h !== href) : [...vorher, href];
    setAusgeblendet(neu);
    const { error } = await getSupabaseClient()
      .from("profiles")
      .update({ menue_ausgeblendet: neu })
      .eq("id", profile.id);
    if (error) {
      setAusgeblendet(vorher);
      alert(`Konnte nicht gespeichert werden: ${error.message}`);
    }
  }

  const istAktiv = (item: NavItem) =>
    !!(
      pathname?.startsWith(item.href) ||
      item.auchAktivBei?.some((p) => pathname?.startsWith(p))
    );
  const aktuellerBereich = sichtbareItems.find(istAktiv);
  // Die gerade geöffnete Seite bleibt im Menü, auch wenn sie ausgeblendet ist.
  const menueItems = sichtbareItems.filter((i) => !istAusgeblendet(i) || istAktiv(i));
  const versteckteItems = sichtbareItems.filter((i) => istAusgeblendet(i) && !istAktiv(i));

  const sprachWahl = profile && (
    <select
      value={profile.sprache}
      onChange={(e) => spracheAendern(e.target.value as Sprache)}
      title="Sprache der Bedienoberfläche (nur für dich, betrifft keine Dokumente)"
      className="text-xs"
    >
      {SPRACHEN.map((s) => (
        <option key={s.wert} value={s.wert}>
          {s.label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <nav className="sticky top-0 z-50 h-14 border-b border-linie bg-white print:hidden">
        <div className="mx-auto flex h-full max-w-[1800px] items-center gap-4 px-4">
          <span className="flex shrink-0 items-center gap-1.5 font-bold text-emerald-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" className="h-7 w-7" />
            Spargar
          </span>

          {/* Ab lg: alle Links inline */}
          <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
            <div className="flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:thin]">
              {menueItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm ${
                      istAktiv(item)
                        ? "font-semibold text-emerald-800"
                        : "text-neutral-600 hover:text-emerald-800"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            {versteckteItems.length > 0 && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMehrOffen((v) => !v)}
                  aria-expanded={mehrOffen}
                  title="Ausgeblendete Menüpunkte"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-1 text-sm text-neutral-500 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  Mehr
                  <span className="rounded-full bg-neutral-100 px-1.5 text-xs tabular-nums text-neutral-600">
                    {versteckteItems.length}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {mehrOffen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMehrOffen(false)} />
                    <div className="absolute left-0 top-full z-20 mt-2 w-56 rounded-lg border border-linie bg-white p-1 shadow-lg">
                      {versteckteItems.map((item) => {
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-emerald-50"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-neutral-400" />
                            {item.label}
                          </Link>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setMehrOffen(false);
                          setAnpassenOffen(true);
                        }}
                        className="mt-1 flex w-full items-center gap-2.5 rounded-md border-t border-linie px-2 py-1.5 text-left text-sm text-emerald-700 hover:bg-emerald-50"
                      >
                        <SlidersHorizontal className="h-4 w-4 shrink-0" />
                        Menü anpassen
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-3 text-sm text-neutral-600 lg:flex">
            {profile && (
              <>
                <span>
                  {profile.full_name} ·{" "}
                  <span className="italic">{rollenVon(profile).map(rolleLabel).join(", ")}</span>
                </span>
                {bereichWahl}
                {sprachWahl}
                <button
                  type="button"
                  onClick={() => setAnpassenOffen(true)}
                  title="Menü anpassen: Menüpunkte ein- und ausblenden"
                  aria-label="Menü anpassen"
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-emerald-50 hover:text-emerald-800"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </>
            )}
            <button className="btn-secondary" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Abmelden
            </button>
          </div>

          {/* Unter lg: aktueller Bereich + Menü-Knopf */}
          <div className="flex flex-1 items-center justify-end gap-3 lg:hidden">
            {aktuellerBereich &&
              (() => {
                const BereichIcon = aktuellerBereich.icon;
                return (
                  <span className="inline-flex items-center gap-1.5 truncate text-sm font-semibold text-emerald-800">
                    <BereichIcon className="h-4 w-4 shrink-0" />
                    {aktuellerBereich.label}
                  </span>
                );
              })()}
            <button
              type="button"
              aria-label="Menü"
              aria-expanded={menuOffen}
              className="shrink-0 rounded-md border border-linie p-1.5 text-neutral-700"
              onClick={() => setMenuOffen((v) => !v)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </nav>

      {menuOffen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMenuOffen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold text-emerald-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon-192.png" alt="" className="h-7 w-7" />
                Spargar
              </span>
              <button
                type="button"
                aria-label="Menü schließen"
                className="text-neutral-500"
                onClick={() => setMenuOffen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {menueItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm ${
                      istAktiv(item)
                        ? "bg-emerald-50 font-semibold text-emerald-800"
                        : "text-neutral-700 hover:bg-emerald-50"
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            {versteckteItems.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setAusgeblendetAufgeklappt((v) => !v)}
                  aria-expanded={ausgeblendetAufgeklappt}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-sm text-neutral-500 hover:bg-emerald-50"
                >
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 transition ${ausgeblendetAufgeklappt ? "" : "-rotate-90"}`}
                  />
                  Ausgeblendet ({versteckteItems.length})
                </button>
                {ausgeblendetAufgeklappt && (
                  <div className="flex flex-col gap-1">
                    {versteckteItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm text-neutral-500 hover:bg-emerald-50"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {profile && (
              <div className="mt-4 border-t border-linie pt-4 text-sm text-neutral-600">
                <div className="mb-3">
                  {profile.full_name} ·{" "}
                  <span className="italic">{rollenVon(profile).map(rolleLabel).join(", ")}</span>
                </div>
                {bereichWahl && (
                  <label className="mb-3 flex items-center gap-2">
                    Bereich
                    {bereichWahl}
                  </label>
                )}
                <label className="mb-3 flex items-center gap-2">
                  Sprache
                  {sprachWahl}
                </label>
                <button
                  type="button"
                  className="btn-secondary mb-2 w-full"
                  onClick={() => {
                    setMenuOffen(false);
                    setAnpassenOffen(true);
                  }}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Menü anpassen
                </button>
                <button className="btn-secondary w-full" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                  Abmelden
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {anpassenOffen && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16 print:hidden">
          <div className="fixed inset-0" onClick={() => setAnpassenOffen(false)} />
          <div
            role="dialog"
            aria-label="Menü anpassen"
            className="relative w-full max-w-sm rounded-xl border border-linie bg-white p-5 shadow-xl"
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-semibold text-neutral-900">Menü anpassen</h2>
              <button
                type="button"
                aria-label="Schließen"
                className="text-neutral-500"
                onClick={() => setAnpassenOffen(false)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-sm text-neutral-500">
              Blende aus, was du selten brauchst. Ausgeblendetes bleibt unter „Mehr“ erreichbar.
            </p>
            <ul className="divide-y divide-linie">
              {sichtbareItems.map((item) => {
                const Icon = item.icon;
                const aus = istAusgeblendet(item);
                return (
                  <li key={item.href} className="flex items-center gap-2.5 py-2 text-sm">
                    <Icon className={`h-4 w-4 shrink-0 ${aus ? "text-neutral-300" : "text-neutral-500"}`} />
                    <span className={aus ? "text-neutral-400" : "text-neutral-800"}>{item.label}</span>
                    {ausblendbar(item) ? (
                      <button
                        type="button"
                        onClick={() => sichtbarkeitUmschalten(item.href)}
                        aria-pressed={!aus}
                        className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition ${
                          aus
                            ? "border-linie text-neutral-500 hover:bg-neutral-50"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        }`}
                      >
                        {aus ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {aus ? "Ausgeblendet" : "Sichtbar"}
                      </button>
                    ) : (
                      <span className="ml-auto text-xs text-neutral-400">immer sichtbar</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
