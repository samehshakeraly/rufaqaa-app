import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import ar from "./ar.json";
import en from "./en.json";

export const SUPPORTED_LANGS = ["ar", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: { translation: ar },
      en: { translation: en },
    },
    fallbackLng: "ar",
    supportedLngs: SUPPORTED_LANGS,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "rufaqaa.lang",
      caches: ["localStorage"],
    },
  });

function applyDirection(lng: string) {
  const dir = lng === "ar" ? "rtl" : "ltr";
  document.documentElement.setAttribute("lang", lng);
  document.documentElement.setAttribute("dir", dir);
}

applyDirection(i18n.language);
i18n.on("languageChanged", applyDirection);

export default i18n;
