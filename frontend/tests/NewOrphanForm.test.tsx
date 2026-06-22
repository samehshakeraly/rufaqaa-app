import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import i18n from "@/i18n";

// The form fetches the country list (and, once a country is picked, that
// country's requirements). Stub both so the test is hermetic — the
// home-address visibility logic under test depends on neither.
vi.mock("@/lib/countries", () => ({
  listCountries: vi.fn(() => Promise.resolve([])),
  getCountryRequirements: vi.fn(() => Promise.resolve(null)),
}));

function renderForm(props?: Partial<ComponentProps<typeof NewOrphanForm>>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          {/* partners={[]} disables the partner fetch; onCreated is required. */}
          <NewOrphanForm audience="staff" partners={[]} onCreated={() => {}} {...props} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

// i18n is a shared singleton; pin Arabic so the label assertions are stable
// regardless of suite order or the jsdom navigator language.
beforeEach(async () => {
  await i18n.changeLanguage("ar");
});

const SECTION = "عنوان السكن"; // orphans.homeAddress.section
const CITY = "المدينة"; // orphans.homeAddress.city
const LIVES_WITH = "يعيش مع"; // orphans.livesWith

describe("NewOrphanForm — conditional home address (staff path)", () => {
  it("hides the section until lives_with is a family-residence value", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText(SECTION)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(LIVES_WITH), "mother");

    expect(await screen.findByText(SECTION)).toBeInTheDocument();
    expect(screen.getByLabelText(CITY)).toBeInTheDocument();
  });

  it("shows for 'relative' too and hides again when lives_with leaves the set", async () => {
    const user = userEvent.setup();
    renderForm();
    const livesWith = screen.getByLabelText(LIVES_WITH);

    await user.selectOptions(livesWith, "relative");
    expect(await screen.findByText(SECTION)).toBeInTheDocument();

    await user.selectOptions(livesWith, "orphanage");
    expect(screen.queryByText(SECTION)).not.toBeInTheDocument();
  });

  it("never shows on the guardian path (no partner picker)", async () => {
    const user = userEvent.setup();
    renderForm({ audience: "guardian", showPartnerSelect: false });

    await user.selectOptions(screen.getByLabelText(LIVES_WITH), "mother");

    expect(screen.queryByText(SECTION)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(CITY)).not.toBeInTheDocument();
  });
});
