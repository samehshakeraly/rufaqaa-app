import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NewOrphanForm } from "@/components/NewOrphanForm";
import i18n from "@/i18n";

// Two countries: GPS-required (SD) and not (EG). getCountryRequirements varies
// its requires_gps by code so we can drive the section's show/hide on a country
// change. national_id is null (permissive baseline) so it never interferes.
function requirementsFor(code: string) {
  return {
    national_id: null,
    fields: {
      requires_gps: code === "SD",
      show_conflict_fields: false,
      show_housing: false,
      show_wash_fields: false,
    },
    required_documents: [],
  };
}

vi.mock("@/lib/countries", () => ({
  listCountries: vi.fn(() =>
    Promise.resolve([
      { code: "SD", name_ar: "السودان", name_en: "Sudan" },
      { code: "EG", name_ar: "مصر", name_en: "Egypt" },
    ]),
  ),
  getCountryRequirements: vi.fn((code: string) => Promise.resolve(requirementsFor(code))),
}));

function renderForm(props?: Partial<ComponentProps<typeof NewOrphanForm>>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <NewOrphanForm audience="staff" partners={[]} onCreated={() => {}} {...props} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

// Pin Arabic so the label/section assertions are stable regardless of suite
// order or the jsdom navigator language.
beforeEach(async () => {
  await i18n.changeLanguage("ar");
});

const GPS_SECTION = "إحداثيات الموقع (GPS)"; // orphans.gps.section
const LATITUDE = "خط العرض"; // orphans.gps.latitude
const LONGITUDE = "خط الطول"; // orphans.gps.longitude
const USE_MY_LOCATION = "استخدام موقعي الحالي"; // orphans.gps.useMyLocation
const COUNTRY = "الدولة"; // orphans.country.label

// The country <select> is disabled until the async countries list resolves, so
// wait for the target option to render before selecting it.
async function selectCountry(
  user: ReturnType<typeof userEvent.setup>,
  code: "SD" | "EG",
) {
  const arabicName = code === "SD" ? "السودان" : "مصر";
  await screen.findByRole("option", { name: arabicName });
  await user.selectOptions(screen.getByLabelText(COUNTRY), code);
}

describe("NewOrphanForm — GPS capture (staff path)", () => {
  it("stays hidden until a requires_gps country is selected", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText(GPS_SECTION)).not.toBeInTheDocument();

    await selectCountry(user, "SD");

    expect(await screen.findByText(GPS_SECTION)).toBeInTheDocument();
    expect(screen.getByLabelText(LATITUDE)).toBeInTheDocument();
    expect(screen.getByLabelText(LONGITUDE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: USE_MY_LOCATION })).toBeInTheDocument();
  });

  it("hides and clears the fields when switching to a non-GPS country", async () => {
    const user = userEvent.setup();
    renderForm();

    await selectCountry(user, "SD");
    const lat = (await screen.findByLabelText(LATITUDE)) as HTMLInputElement;
    await user.type(lat, "15.5");
    expect(lat.value).toBe("15.5");

    // Egypt has no requires_gps → the section disappears…
    await selectCountry(user, "EG");
    await waitFor(() => expect(screen.queryByText(GPS_SECTION)).not.toBeInTheDocument());

    // …and the captured value is reset, so coming back shows an empty field.
    await selectCountry(user, "SD");
    const latAgain = (await screen.findByLabelText(LATITUDE)) as HTMLInputElement;
    expect(latAgain.value).toBe("");
  });

  it("never shows on the guardian path even when the country requires GPS", async () => {
    const user = userEvent.setup();
    renderForm({ audience: "guardian", showPartnerSelect: false });

    await selectCountry(user, "SD");

    // Give the requirements query a tick to resolve; the section must still be absent.
    await waitFor(() => expect(screen.getByLabelText(COUNTRY)).toHaveValue("SD"));
    expect(screen.queryByText(GPS_SECTION)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(LATITUDE)).not.toBeInTheDocument();
  });
});

describe("NewOrphanForm — GPS 'use my location'", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fills latitude/longitude from the browser geolocation", async () => {
    const getCurrentPosition = vi.fn(
      (success: (pos: { coords: { latitude: number; longitude: number } }) => void) => {
        success({ coords: { latitude: 15.6, longitude: 32.5 } });
      },
    );
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });

    const user = userEvent.setup();
    renderForm();
    await selectCountry(user, "SD");

    const button = await screen.findByRole("button", { name: USE_MY_LOCATION });
    await user.click(button);

    await waitFor(() => {
      expect((screen.getByLabelText(LATITUDE) as HTMLInputElement).value).toBe("15.6");
      expect((screen.getByLabelText(LONGITUDE) as HTMLInputElement).value).toBe("32.5");
    });
    expect(getCurrentPosition).toHaveBeenCalledOnce();
  });
});
