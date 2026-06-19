import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterAll, describe, expect, it } from "vitest";

import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import i18n from "@/i18n";
import ar from "@/i18n/ar.json";
import en from "@/i18n/en.json";
import fr from "@/i18n/fr.json";

function renderWithI18n(ui: ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

afterAll(async () => {
  // Restore the shared i18n singleton to the platform default for other suites.
  await i18n.changeLanguage("ar");
});

describe("French locale (phased rollout)", () => {
  it("registers fr as a supported language", () => {
    expect(i18n.options.supportedLngs).toContain("fr");
  });

  it("resolves translated keys to French when fr is active", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("common.save")).toBe(fr.common.save);
    expect(i18n.t("orphans.country.label")).toBe(fr.orphans.country.label);
  });

  it("falls back untranslated fr keys to English, not Arabic", async () => {
    await i18n.changeLanguage("fr");
    // `landing.*` is intentionally left out of the phased fr.json, so it must
    // resolve through the fr → en fallback chain — English, never the Arabic
    // default.
    const key = "landing.hero.browse";
    expect(fr).not.toHaveProperty("landing");
    expect(i18n.t(key)).toBe(en.landing.hero.browse);
    expect(i18n.t(key)).not.toBe(ar.landing.hero.browse);
  });

  it("LanguageSwitcher selects French and persists the choice", async () => {
    await i18n.changeLanguage("ar");
    localStorage.removeItem("rufaqaa.lang");
    const user = userEvent.setup();
    renderWithI18n(<LanguageSwitcher />);

    await user.selectOptions(screen.getByRole("combobox"), "fr");

    await waitFor(() => expect(i18n.language).toBe("fr"));
    expect(localStorage.getItem("rufaqaa.lang")).toBe("fr");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("fr");
  });
});
