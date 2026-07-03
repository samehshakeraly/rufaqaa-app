import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanSkillsManager } from "@/components/OrphanSkillsManager";
import i18n from "@/i18n";

// Mock only the network helpers; the coded vocabularies + name cap stay real
// so the component's options and client validation match the backend contract.
vi.mock("@/lib/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills")>();
  return {
    ...actual,
    listSkills: vi.fn(),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    deleteSkill: vi.fn(),
  };
});

import {
  createSkill,
  deleteSkill,
  listSkills,
  updateSkill,
  type SkillRead,
} from "@/lib/skills";

const listMock = vi.mocked(listSkills);
const createMock = vi.mocked(createSkill);
const updateMock = vi.mocked(updateSkill);
const deleteMock = vi.mocked(deleteSkill);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

function skillOf(partial: Partial<SkillRead> & { id: string; name: string }): SkillRead {
  return {
    orphan_id: ORPHAN_ID,
    category: null,
    level: null,
    note: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <OrphanSkillsManager orphanId={ORPHAN_ID} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  listMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

describe("OrphanSkillsManager", () => {
  it("lists existing skills with localized category/level chips and the staff note", async () => {
    listMock.mockResolvedValue([
      skillOf({ id: "s1", name: "حفظ القرآن", category: "quran", level: "advanced" }),
      skillOf({ id: "s2", name: "الرسم", note: "تحب الألوان المائية" }),
    ]);
    renderManager();

    // Scope to the row — the add-form selects carry the same option labels.
    const first = (await screen.findByText("حفظ القرآن")).closest("li")!;
    expect(within(first).getByText("القرآن الكريم")).toBeInTheDocument();
    expect(within(first).getByText("متقدمة")).toBeInTheDocument();
    const second = screen.getByText("الرسم").closest("li")!;
    expect(within(second).getByText(/تحب الألوان المائية/)).toBeInTheDocument();
  });

  it("adds a skill through POST with the coded category/level and the note", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(
      skillOf({ id: "new", name: "السباحة", category: "sports", level: "beginner" }),
    );
    renderManager();

    await screen.findByText(/لا توجد مهارات بعد/);

    await user.type(screen.getByLabelText("المهارة"), "السباحة");
    await user.selectOptions(screen.getByLabelText("التصنيف"), "sports");
    await user.selectOptions(screen.getByLabelText("المستوى"), "beginner");
    await user.type(screen.getByLabelText("ملاحظة الفريق (اختيارية)"), "تدرّبت في النادي");
    await user.click(screen.getByRole("button", { name: "إضافة المهارة" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith(ORPHAN_ID, {
      name: "السباحة",
      category: "sports",
      level: "beginner",
      note: "تدرّبت في النادي",
    });
  });

  it("edits a skill in place and PATCHes only that row", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([skillOf({ id: "s1", name: "الخط", category: "arts" })]);
    updateMock.mockResolvedValue(
      skillOf({ id: "s1", name: "الخط العربي", category: "arts", level: "intermediate" }),
    );
    renderManager();

    await screen.findByText("الخط");

    await user.click(screen.getByRole("button", { name: "تعديل" }));
    const nameInput = screen.getByLabelText("تعديل اسم المهارة");
    await user.clear(nameInput);
    await user.type(nameInput, "الخط العربي");
    await user.selectOptions(screen.getByLabelText("تعديل المستوى"), "intermediate");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith("s1", {
      name: "الخط العربي",
      category: "arts",
      level: "intermediate",
      note: null,
    });
  });

  it("deletes a skill via its accessible row action", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([
      skillOf({ id: "s1", name: "تبقى" }),
      skillOf({ id: "s2", name: "تُحذف" }),
    ]);
    deleteMock.mockResolvedValue(undefined);
    renderManager();

    await screen.findByText("تُحذف");

    const row = screen.getByText("تُحذف").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "حذف هذه المهارة" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith("s2");
  });

  it("rejects an empty name client-side without posting", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    renderManager();

    await screen.findByText(/لا توجد مهارات بعد/);

    await user.click(screen.getByRole("button", { name: "إضافة المهارة" }));
    expect(screen.getByText("لا يمكن أن يكون اسم المهارة فارغًا.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
