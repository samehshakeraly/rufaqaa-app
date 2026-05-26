import { useThemeStore } from "@/store/theme";

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="toggle theme"
      className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700"
    >
      {theme === "light" ? "🌙" : "☀️"}
    </button>
  );
}
