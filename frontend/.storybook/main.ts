import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx|mdx)"],
  addons: ["@storybook/addon-essentials"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: { autodocs: "tag" },
  // Hand-pick what gets typechecked so Storybook's own internals don't
  // bog down the build server with strict tsc.
  typescript: {
    check: false,
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
