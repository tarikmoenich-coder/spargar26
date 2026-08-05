import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Spargar - Mömmel Agrar",
  description: "Personal-, Zeit- und Kassenverwaltung",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body>
        <Nav />
        <main className="mx-auto max-w-[1800px] px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
