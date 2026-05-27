import type { Preview } from "@storybook/react";

// Tailwind + design tokens come in via the same stylesheet the app uses.
import "../src/styles/globals.css";
// i18n bootstrap so any t() calls in components resolve.
import "../src/i18n";

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: {
      default: "snow",
      values: [
        { name: "snow", value: "#f8fafc" },
        { name: "white", value: "#ffffff" },
        { name: "slate", value: "#0f172a" },
      ],
    },
  },
};

export default preview;
