/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Rundum-Check 2026-11-25: Schutz gegen Einbetten in fremde Seiten
  // (Clickjacking) und gegen MIME-Sniffing.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
