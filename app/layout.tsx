import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import InaktivitaetsAbmeldung from "@/components/InaktivitaetsAbmeldung";

export const metadata: Metadata = {
  title: "Spargar - Mömmel Agrar",
  description: "Personal-, Zeit- und Kassenverwaltung",
  // Installierbar als „App" auf dem Startbildschirm (PWA). Bewusst OHNE
  // Service Worker - siehe README (Browser-Cache/bfcache-Stale-Data-Bug):
  // ein SW-Cache würde genau diese Fehlerklasse zurückholen. Manifest +
  // Apple-Meta reichen für „Zum Startbildschirm hinzufügen" auf iOS/Android.
  manifest: "/manifest.webmanifest",
  applicationName: "Spargar",
  appleWebApp: {
    capable: true,
    title: "Spargar",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#047857",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <InaktivitaetsAbmeldung />
        <Nav />
        <main className="mx-auto max-w-[1800px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
