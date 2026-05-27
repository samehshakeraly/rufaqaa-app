/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        snow: "#F7FBFC",
        tranquil: "#D6E6F2",
        sky: "#B9D7EA",
        trust: "#769FCD",
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
