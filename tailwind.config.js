/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Grün der Wort-/Bildmarke MÖMMEL (siehe public/mommel-banner.png).
        // Überschreibt die Tailwind-Standardskala "emerald" - so erscheinen
        // die hunderten schon im Code verstreuten emerald-*-Klassen ohne
        // Seiten-für-Seite-Umbau sofort in der Markenfarbe (warmes Grasgrün
        // statt kaltem Blaugrün).
        emerald: {
          50: '#f2fbef',
          100: '#ddf4d4',
          200: '#bfe8b0',
          300: '#94d97f',
          400: '#61c246',
          500: '#3f9d2e',
          600: '#338a22',
          700: '#2b711e',
          800: '#255a1c',
          900: '#1f4a19',
        },
        // Erdbeerrot der Marke - sparsam für Akzente / gefährliche Aktionen.
        beere: {
          50: '#fdf2f2',
          100: '#fbe0e1',
          200: '#f5c2c3',
          300: '#ec9294',
          400: '#e05e61',
          500: '#d6262a',
          600: '#bd1f23',
          700: '#9c191d',
          800: '#7f1719',
          900: '#6a1618',
        },
        // Warmes Papier-Off-White + warme Trennlinie statt kaltem Blaugrau.
        sand: {
          DEFAULT: '#faf8f3',
          100: '#f4f1e8',
          200: '#ebe6d8',
        },
        linie: '#e6e1d5',
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(37 90 28 / 0.04), 0 1px 3px 0 rgb(15 23 20 / 0.06)',
      },
    },
  },
  plugins: [],
};
