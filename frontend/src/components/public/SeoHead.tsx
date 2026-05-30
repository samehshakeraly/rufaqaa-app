import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";

/**
 * Per-page <title> + meta description for the public marketing site.
 * Pass i18n keys (not raw strings) so titles/descriptions stay in
 * ar/en parity. The app name is appended to the title automatically.
 */
export function SeoHead({
  titleKey,
  descriptionKey,
}: {
  titleKey: string;
  descriptionKey: string;
}) {
  const { t, i18n } = useTranslation();
  const title = `${t(titleKey)} · ${t("app.name")}`;
  return (
    <Helmet>
      <html lang={i18n.language} dir={i18n.language === "ar" ? "rtl" : "ltr"} />
      <title>{title}</title>
      <meta name="description" content={t(descriptionKey)} />
    </Helmet>
  );
}
