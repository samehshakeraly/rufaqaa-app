import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { HelmetProvider } from "react-helmet-async";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { AboutPage } from "@/pages/AboutPage";
import { ContactFAQPage } from "@/pages/ContactFAQPage";
import { HowItWorksPage } from "@/pages/HowItWorksPage";
import { LandingPage } from "@/pages/LandingPage";
import { PublicPartnersPage } from "@/pages/PublicPartnersPage";
import { TransparencyPage } from "@/pages/TransparencyPage";

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>{ui}</MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    </HelmetProvider>,
  );
}

const PAGES: [string, ReactNode][] = [
  ["LandingPage", <LandingPage />],
  ["AboutPage", <AboutPage />],
  ["HowItWorksPage", <HowItWorksPage />],
  ["TransparencyPage", <TransparencyPage />],
  ["PublicPartnersPage", <PublicPartnersPage />],
  ["ContactFAQPage", <ContactFAQPage />],
];

// A missing i18n key renders as the literal key, e.g. "public.contact.faq.x"
// or "landing.hero.y". Scan the rendered HTML for that signature.
const UNRESOLVED = /(?:public|landing)\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+/g;

describe("public pages — i18n key resolution", () => {
  for (const lang of ["ar", "en"] as const) {
    for (const [name, ui] of PAGES) {
      it(`${name} resolves all keys in ${lang}`, async () => {
        await i18n.changeLanguage(lang);
        const { container } = renderWithProviders(ui);
        const found = container.innerHTML.match(UNRESOLVED) ?? [];
        expect(found, `Unresolved keys in ${name} (${lang}): ${[...new Set(found)].join(", ")}`).toEqual([]);
      });
    }
  }
});
