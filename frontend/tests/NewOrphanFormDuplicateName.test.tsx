import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NewOrphanForm, type CreatedOrphan } from "@/components/NewOrphanForm";
import i18n from "@/i18n";
import {
  findOrphanNameMatches,
  type OrphanCreateInput,
  type OrphanNameMatch,
} from "@/lib/orphans";

// One country so the required Country selector has a pickable option (and the
// national_id field mounts); null requirements = permissive baseline, so
// national_id is optional and we can leave it empty to trigger the advisory.
vi.mock("@/lib/countries", () => ({
  listCountries: vi.fn(() => Promise.resolve([{ code: "KW", name_ar: "الكويت", name_en: "Kuwait" }])),
  getCountryRequirements: vi.fn(() => Promise.resolve(null)),
}));

// Mock the data layer so we can drive the name-matches lookup and observe that
// the create only fires when it should. createOrphan is unused here (every
// render injects a submitFn) but must still be exported for the import to bind.
vi.mock("@/lib/orphans", () => ({
  createOrphan: vi.fn(),
  findOrphanNameMatches: vi.fn(() => Promise.resolve([])),
}));

const mockedFind = vi.mocked(findOrphanNameMatches);
const PARTNER_ID = "11111111-1111-4111-8111-111111111111";

const MATCH: OrphanNameMatch = {
  code: "ORF-EXISTS",
  first_name: "Sara",
  father_name: "Hassan",
  family_name: "Ali",
  date_of_birth: "2014-01-02",
};

const tk = (key: string) => i18n.t(key);

function renderForm(props?: Partial<ComponentProps<typeof NewOrphanForm>>) {
  const submitFn = vi.fn(
    (_payload: OrphanCreateInput): Promise<CreatedOrphan> =>
      Promise.resolve({
        id: "new-id",
        code: "ORF-NEW",
        case_status: "pending_review",
        first_name: "Sara",
        family_name: "Ali",
      }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <NewOrphanForm
            audience="staff"
            partners={[{ id: PARTNER_ID, name_ar: "جهة", name_en: "Partner" }]}
            onCreated={() => {}}
            submitFn={submitFn}
            {...props}
          />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return { submitFn, ...render(ui) };
}

/** Fill every required field. `nationalId` (optional) and `withPartner` (staff
 * only) tailor the two branches the advisory cares about. */
async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { nationalId, withPartner = true }: { nationalId?: string; withPartner?: boolean } = {},
) {
  // The Country selector is disabled until the (mocked) country list resolves;
  // wait for its option so the select is populated and enabled before picking.
  await screen.findByRole("option", { name: "Kuwait" });
  await user.selectOptions(screen.getByLabelText(tk("orphans.country.label")), "KW");
  await user.type(screen.getByLabelText(tk("orphans.firstName")), "Sara");
  await user.type(screen.getByLabelText(tk("orphans.fatherName")), "Hassan");
  await user.type(screen.getByLabelText(tk("orphans.familyName")), "Ali");
  // Date inputs don't play nicely with userEvent.type; set the value directly.
  fireEvent.change(screen.getByLabelText(tk("orphans.dateOfBirth")), {
    target: { value: "2015-06-01" },
  });
  if (withPartner) {
    await user.selectOptions(screen.getByLabelText(tk("orphans.partner")), PARTNER_ID);
  }
  if (nationalId) {
    // The national_id Field nests a hint <p> inside its <label>, so the input's
    // accessible name is "National ID …hint"; match as a substring.
    await user.type(
      await screen.findByLabelText(tk("orphans.nationalId.label"), { exact: false }),
      nationalId,
    );
  }
}

async function clickSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: tk("common.save") }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockedFind.mockResolvedValue([]);
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  // Restore the shared i18n singleton for other suites.
  await i18n.changeLanguage("ar");
});

describe("NewOrphanForm — soft duplicate-name advisory (staff, no national_id)", () => {
  it("opens the advisory dialog and holds the create when same-name orphans exist", async () => {
    const user = userEvent.setup();
    mockedFind.mockResolvedValue([MATCH]);
    const { submitFn } = renderForm();

    await fillForm(user);
    await clickSave(user);

    // Looked up by the entered first + family name...
    await waitFor(() => expect(mockedFind).toHaveBeenCalledWith("Sara", "Ali"));
    // ...and surfaced the dialog instead of creating.
    const dialog = await screen.findByTestId("duplicate-name-dialog");
    expect(submitFn).not.toHaveBeenCalled();

    // The match is listed (full name + code) so staff can eyeball it.
    expect(within(dialog).getByText("Sara Hassan Ali")).toBeInTheDocument();
    expect(within(dialog).getByText(/ORF-EXISTS/)).toBeInTheDocument();
  });

  it("'Proceed anyway' runs the create with the entered payload (no national_id)", async () => {
    const user = userEvent.setup();
    mockedFind.mockResolvedValue([MATCH]);
    const { submitFn } = renderForm();

    await fillForm(user);
    await clickSave(user);
    await screen.findByTestId("duplicate-name-dialog");

    await user.click(screen.getByTestId("duplicate-name-proceed"));

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(submitFn).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: "Sara", family_name: "Ali", father_name: "Hassan" }),
    );
    // No national_id was entered, so it must not ride along in the payload.
    expect(submitFn.mock.lastCall?.[0]).not.toHaveProperty("national_id");
  });

  it("'Cancel / review' closes the dialog and does not create", async () => {
    const user = userEvent.setup();
    mockedFind.mockResolvedValue([MATCH]);
    const { submitFn } = renderForm();

    await fillForm(user);
    await clickSave(user);
    await screen.findByTestId("duplicate-name-dialog");

    await user.click(screen.getByTestId("duplicate-name-cancel"));

    await waitFor(() =>
      expect(screen.queryByTestId("duplicate-name-dialog")).not.toBeInTheDocument(),
    );
    expect(submitFn).not.toHaveBeenCalled();
  });

  it("creates directly (no dialog) when no same-name orphan exists", async () => {
    const user = userEvent.setup();
    mockedFind.mockResolvedValue([]);
    const { submitFn } = renderForm();

    await fillForm(user);
    await clickSave(user);

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(mockedFind).toHaveBeenCalledWith("Sara", "Ali");
    expect(screen.queryByTestId("duplicate-name-dialog")).not.toBeInTheDocument();
  });

  it("skips the lookup entirely when a national_id is provided", async () => {
    const user = userEvent.setup();
    const { submitFn } = renderForm();

    await fillForm(user, { nationalId: "123456" });
    await clickSave(user);

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(mockedFind).not.toHaveBeenCalled();
    expect(screen.queryByTestId("duplicate-name-dialog")).not.toBeInTheDocument();
  });

  it("never runs the advisory on the guardian self path", async () => {
    const user = userEvent.setup();
    mockedFind.mockResolvedValue([MATCH]);
    const { submitFn } = renderForm({ audience: "guardian", showPartnerSelect: false });

    await fillForm(user, { withPartner: false });
    await clickSave(user);

    await waitFor(() => expect(submitFn).toHaveBeenCalledTimes(1));
    expect(mockedFind).not.toHaveBeenCalled();
    expect(screen.queryByTestId("duplicate-name-dialog")).not.toBeInTheDocument();
  });
});
