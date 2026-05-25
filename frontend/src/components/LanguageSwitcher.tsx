import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGS, type Lang } from "@/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = (SUPPORTED_LANGS as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : "ar";

  const next: Lang = current === "ar" ? "en" : "ar";

  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(next)}
      className="rounded-lg border border-sky px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
      aria-label="toggle language"
    >
      {next === "ar" ? "العربية" : "English"}
    </button>
  );
}
