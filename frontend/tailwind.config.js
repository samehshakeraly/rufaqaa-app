/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // Brand color ramps mirror the CSS variables in
      // docs/design/screens/rufaqaa-design-system-v0.1.html exactly.
      // Each scale has a DEFAULT key set to the mockups' canonical
      // step (snow=100 page bg, tranquil=200 card bg, sky=200 border,
      // trust=300 primary), so legacy classes like `bg-trust` /
      // `border-sky` keep working while new code can target specific
      // steps (`bg-trust-400` for hover, `text-gray-700` for body
      // copy, `bg-success-100 text-success-700` for badges, etc.).
      colors: {
        snow: {
          DEFAULT: "#F7FBFC",
          50: "#FDFEFE",
          100: "#F7FBFC",
          200: "#EEF5F8",
          300: "#E2EEF3",
        },
        tranquil: {
          DEFAULT: "#D6E6F2",
          100: "#EAF1F7",
          200: "#D6E6F2",
          300: "#C2D8EC",
          400: "#ADCBE5",
        },
        sky: {
          DEFAULT: "#B9D7EA",
          100: "#C9DDED",
          200: "#B9D7EA",
          300: "#9CC3DE",
          400: "#7FAFD1",
        },
        trust: {
          DEFAULT: "#769FCD",
          100: "#B8CFE3",
          200: "#97B7D6",
          300: "#769FCD",
          400: "#5B85B8",
          500: "#426D9F",
          600: "#2D5683",
          700: "#1E4068",
          800: "#142E4D",
          900: "#0B1E33",
        },
        gray: {
          50: "#FAFBFC",
          100: "#F4F6F8",
          200: "#E7EBEF",
          300: "#D2D8DF",
          400: "#A8B2BC",
          500: "#7A8590",
          600: "#5A636E",
          700: "#3F4750",
          800: "#2A3038",
          900: "#161A1F",
        },
        success: {
          50: "#ECFDF5",
          100: "#D1FAE5",
          500: "#10B981",
          600: "#059669",
          700: "#047857",
        },
        warning: {
          50: "#FFFBEB",
          100: "#FEF3C7",
          500: "#F59E0B",
          600: "#D97706",
          700: "#B45309",
        },
        danger: {
          50: "#FEF2F2",
          100: "#FEE2E2",
          500: "#EF4444",
          600: "#DC2626",
          700: "#B91C1C",
        },
        info: {
          50: "#EFF6FF",
          100: "#DBEAFE",
          500: "#3B82F6",
          600: "#2563EB",
          700: "#1D4ED8",
        },
      },
      fontFamily: {
        sans: [
          "'IBM Plex Sans Arabic'",
          "'IBM Plex Sans'",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
