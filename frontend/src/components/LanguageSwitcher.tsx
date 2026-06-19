import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGS, type Lang } from "@/i18n";

// A language name is conventionally shown as its own autonym (each in its own
// script), so these labels stay constant regardless of the active UI locale and
// need no translation keys.
const LANG_LABELS: Record<Lang, string> = {
  ar: "العربية",
  en: "English",
  fr: "Français",
};

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current: Lang = (SUPPORTED_LANGS as readonly string[]).includes(i18n.language)
    ? (i18n.language as Lang)
    : "ar";

  // A compact <select> scales to the three supported languages (ar / en / fr)
  // in a single control. Choosing a language persists it via i18next's
  // LanguageDetector cache (the "rufaqaa.lang" localStorage key).
  return (
    <select
      value={current}
      onChange={(e) => void i18n.changeLanguage(e.target.value)}
      className="rounded-lg border border-sky bg-white px-3 py-1 text-sm text-slate-700 hover:bg-tranquil"
      aria-label="Select language"
    >
      {SUPPORTED_LANGS.map((lng) => (
        <option key={lng} value={lng}>
          {LANG_LABELS[lng]}
        </option>
      ))}
    </select>
  );
}
