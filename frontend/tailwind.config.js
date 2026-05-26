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
          "'Noto Sans Arabic'",
          "'Inter'",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
