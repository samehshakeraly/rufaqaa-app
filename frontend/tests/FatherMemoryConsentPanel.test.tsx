import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FatherMemoryConsentPanel } from "@/components/FatherMemoryConsentPanel";
import i18n from "@/i18n";

// Mock the consent client (its own helpers) and the visibility read used to
// derive the second gate. PROFILE_ELEMENTS stays real.
vi.mock("@/lib/fatherMemory", () => ({
  getFatherMemoryConsent: vi.fn(),
  setFatherMemoryConsent: vi.fn(),
}));
vi.mock("@/lib/profileVisibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileVisibility")>();
  return { ...actual, getProfileVisibility: vi.fn() };
});

import { getFatherMemoryConsent, setFatherMemoryConsent } from "@/lib/fatherMemory";
import {
  getProfileVisibility,
  PROFILE_ELEMENTS,
  type ProfileVisibilityRegistry,
} from "@/lib/profileVisibility";

const consentGetMock = vi.mocked(getFatherMemoryConsent);
const consentSetMock = vi.mocked(setFatherMemoryConsent);
const visGetMock = vi.mocked(getProfileVisibility);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

/** A registry where `father_memory` is visible (true) or hidden (false);
 * everything else stays visible. */
function registry(fatherMemoryVisible: boolean): ProfileVisibilityRegistry {
  return {
    elements: PROFILE_ELEMENTS.map((key) => ({
      key,
      visible: key === "father_memory" ? fatherMemoryVisible : true,
    })),
    stored: fatherMemoryVisible ? {} : { father_memory: false },
  };
}

const consentSwitch = () =>
  screen.getByRole("switch", {
    name: new RegExp("(تسجيل موافقة الوليّ|سحب موافقة الوليّ)"),
  });

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <FatherMemoryConsentPanel orphanId={ORPHAN_ID} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  consentGetMock.mockReset();
  consentSetMock.mockReset();
  visGetMock.mockReset();
});

describe("FatherMemoryConsentPanel — double gate", () => {
  it("shows 'shown to donor' only when BOTH consent and visibility are on", async () => {
    consentGetMock.mockResolvedValue({ consent: true });
    visGetMock.mockResolvedValue(registry(true));
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(
      screen.getByText("البوّابتان مفعّلتان — تظهر ذكرى الأب للكافل."),
    ).toBeInTheDocument();
  });

  it("shows 'hidden from donor' when consent is on but visibility is off", async () => {
    consentGetMock.mockResolvedValue({ consent: true });
    visGetMock.mockResolvedValue(registry(false));
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByText(/مخفيّة عن الكافل/)).toBeInTheDocument();
  });

  it("shows 'hidden from donor' when visibility is on but consent is off (default)", async () => {
    consentGetMock.mockResolvedValue({ consent: false });
    visGetMock.mockResolvedValue(registry(true));
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText(/مخفيّة عن الكافل/)).toBeInTheDocument();
  });
});

describe("FatherMemoryConsentPanel — consent round-trip", () => {
  it("PATCHes consent=true when the toggle is switched on", async () => {
    const user = userEvent.setup();
    consentGetMock.mockResolvedValue({ consent: false });
    visGetMock.mockResolvedValue(registry(true));
    consentSetMock.mockResolvedValue({ consent: true });
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "false"));
    await user.click(consentSwitch());

    await waitFor(() => expect(consentSetMock).toHaveBeenCalledTimes(1));
    expect(consentSetMock).toHaveBeenCalledWith(ORPHAN_ID, true);

    // After the PATCH resolves, the double gate flips to "shown to donor".
    expect(
      await screen.findByText("البوّابتان مفعّلتان — تظهر ذكرى الأب للكافل."),
    ).toBeInTheDocument();
  });

  it("PATCHes consent=false when the toggle is switched off", async () => {
    const user = userEvent.setup();
    consentGetMock.mockResolvedValue({ consent: true });
    visGetMock.mockResolvedValue(registry(true));
    consentSetMock.mockResolvedValue({ consent: false });
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "true"));
    await user.click(consentSwitch());

    await waitFor(() => expect(consentSetMock).toHaveBeenCalledWith(ORPHAN_ID, false));
  });

  it("surfaces an error when the PATCH fails", async () => {
    const user = userEvent.setup();
    consentGetMock.mockResolvedValue({ consent: false });
    visGetMock.mockResolvedValue(registry(true));
    consentSetMock.mockRejectedValue(new Error("boom"));
    renderPanel();

    await waitFor(() => expect(consentSwitch()).toHaveAttribute("aria-checked", "false"));
    await user.click(consentSwitch());

    expect(await screen.findByText("تعذّر حفظ الموافقة. حاول مرة أخرى.")).toBeInTheDocument();
  });
});
