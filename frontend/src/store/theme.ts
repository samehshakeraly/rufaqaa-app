import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  set: (t: Theme) => void;
}

function applyToDocument(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "light",
      toggle: () => {
        const next: Theme = get().theme === "light" ? "dark" : "light";
        applyToDocument(next);
        set({ theme: next });
      },
      set: (t) => {
        applyToDocument(t);
        set({ theme: t });
      },
    }),
    {
      name: "rufaqaa.theme",
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyToDocument(state.theme);
      },
    },
  ),
);
