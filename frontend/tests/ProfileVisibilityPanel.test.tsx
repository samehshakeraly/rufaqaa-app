import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileVisibilityPanel } from "@/components/ProfileVisibilityPanel";
import i18n from "@/i18n";

// Mock only the two network helpers; PROFILE_ELEMENTS (and the types) stay real
// so the component renders the canonical eight-element set.
vi.mock("@/lib/profileVisibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/profileVisibility")>();
  return {
    ...actual,
    getProfileVisibility: vi.fn(),
    setProfileVisibility: vi.fn(),
  };
});

import {
  getProfileVisibility,
  PROFILE_ELEMENTS,
  setProfileVisibility,
  type ProfileElement,
  type ProfileVisibilityRegistry,
} from "@/lib/profileVisibility";

const getMock = vi.mocked(getProfileVisibility);
const setMock = vi.mocked(setProfileVisibility);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

// Arabic labels (the suite pins Arabic). Each switch's accessible name embeds
// its element label, so we locate switches by name regardless of on/off state.
const LABELS: Partial<Record<ProfileElement, string>> = {
  dream: "الحلم",
  her_world: "عالمه الخاص",
  milestones: "إنجازاته",
};
const SAVE = "حفظ التغييرات";

const dreamSwitch = () => screen.getByRole("switch", { name: new RegExp(LABELS.dream!) });
const herWorldSwitch = () => screen.getByRole("switch", { name: new RegExp(LABELS.her_world!) });

/** Build a registry from a map of hidden keys (everything else visible). */
function registryFrom(hidden: Partial<Record<ProfileElement, boolean>>): ProfileVisibilityRegistry {
  return {
    elements: PROFILE_ELEMENTS.map((key) => ({ key, visible: !hidden[key] })),
    stored: Object.fromEntries(
      Object.entries(hidden)
        .filter(([, v]) => v)
        .map(([k]) => [k, false]),
    ),
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <ProfileVisibilityPanel orphanId={ORPHAN_ID} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  getMock.mockReset();
  setMock.mockReset();
});

describe("ProfileVisibilityPanel — structure", () => {
  it("renders the eight element switches reflecting registry.visible, plus the locked identity row", async () => {
    // her_world starts hidden; the rest visible.
    getMock.mockResolvedValue(registryFrom({ her_world: true }));
    renderPanel();

    // Eight toggles, one per ProfileElement (identity is NOT a switch).
    const switches = await screen.findAllByRole("switch");
    expect(switches).toHaveLength(PROFILE_ELEMENTS.length);

    // Each switch reflects the registry: visible → checked, hidden → unchecked.
    expect(dreamSwitch()).toHaveAttribute("aria-checked", "true");
    expect(herWorldSwitch()).toHaveAttribute("aria-checked", "false");

    // The identity row is locked (rendered, but carries no switch).
    expect(screen.getByText("الهوية والبيانات الأساسية")).toBeInTheDocument();
    expect(screen.getAllByText("يظهر دائماً").length).toBeGreaterThan(0);
  });

  it("shows a live counter and a donor preview split into visible vs hidden", async () => {
    getMock.mockResolvedValue(registryFrom({ her_world: true }));
    renderPanel();
    await screen.findAllByRole("switch");

    // 7 visible · 1 hidden.
    expect(screen.getByText("7 ظاهر · 1 مخفيّ")).toBeInTheDocument();

    // Preview: hidden column lists the hidden element, visible column the rest.
    const hiddenCol = screen.getByText(/مخفية عن الكافل/).closest("div")!;
    expect(within(hiddenCol).getByText(LABELS.her_world!)).toBeInTheDocument();
    const visibleCol = screen.getByText(/سيراها الكافل/).closest("div")!;
    expect(within(visibleCol).getByText(LABELS.dream!)).toBeInTheDocument();
    expect(within(visibleCol).getByText(LABELS.milestones!)).toBeInTheDocument();
  });
});

describe("ProfileVisibilityPanel — save", () => {
  it("PUTs the full eight-key map with the toggled booleans", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(registryFrom({}));
    setMock.mockResolvedValue(registryFrom({ dream: true }));
    renderPanel();
    await screen.findAllByRole("switch");

    // Hide the Dream element, then save.
    await user.click(dreamSwitch());
    expect(dreamSwitch()).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(setMock).toHaveBeenCalledTimes(1));
    const [orphanId, visibility] = setMock.mock.calls[0]!;
    expect(orphanId).toBe(ORPHAN_ID);

    // Replace semantics: every one of the eight keys is sent explicitly…
    expect(Object.keys(visibility).sort()).toEqual([...PROFILE_ELEMENTS].sort());
    // …with only Dream flipped to false.
    expect(visibility.dream).toBe(false);
    for (const key of PROFILE_ELEMENTS) {
      if (key !== "dream") expect(visibility[key]).toBe(true);
    }

    // Saved state surfaces.
    expect(await screen.findByText("تم الحفظ")).toBeInTheDocument();
  });

  it("rolls the toggle back and shows an error when the PUT fails", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(registryFrom({}));
    setMock.mockRejectedValue(new Error("boom"));
    renderPanel();
    await screen.findAllByRole("switch");

    await user.click(dreamSwitch());
    expect(dreamSwitch()).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("button", { name: SAVE }));

    // Error surfaces and the optimistic toggle reverts to the server state.
    expect(await screen.findByText("تعذّر الحفظ. حاول مرة أخرى.")).toBeInTheDocument();
    await waitFor(() => expect(dreamSwitch()).toHaveAttribute("aria-checked", "true"));
  });
});
