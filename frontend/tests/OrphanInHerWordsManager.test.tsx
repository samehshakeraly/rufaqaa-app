import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanInHerWordsManager } from "@/components/OrphanInHerWordsManager";
import i18n from "@/i18n";

// Mock only the network helpers; the limit constants stay real so the
// component's client validation matches the canonical backend contract.
vi.mock("@/lib/inHerWords", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inHerWords")>();
  return {
    ...actual,
    getInHerWords: vi.fn(),
    setInHerWords: vi.fn(),
  };
});

import {
  getInHerWords,
  IN_HER_WORDS_MAX_LEN,
  setInHerWords,
  type InHerWordsList,
} from "@/lib/inHerWords";

const getMock = vi.mocked(getInHerWords);
const setMock = vi.mocked(setInHerWords);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

const SAVE = "حفظ التغييرات";
const ADD = "إضافة العبارة";

function listOf(items: InHerWordsList["items"]): InHerWordsList {
  return { items };
}

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <OrphanInHerWordsManager orphanId={ORPHAN_ID} />
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

describe("OrphanInHerWordsManager", () => {
  it("lists existing phrases with their dates", async () => {
    getMock.mockResolvedValue(
      listOf([
        { id: "p1", text: "أحبّ القراءة", said_on: "2026-02-10" },
        { id: "p2", text: "أريد أن أصبح طبيبة", said_on: null },
      ]),
    );
    renderManager();

    expect(await screen.findByText("أحبّ القراءة")).toBeInTheDocument();
    expect(screen.getByText("أريد أن أصبح طبيبة")).toBeInTheDocument();
  });

  it("adds a phrase and PUTs the full array on save", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(listOf([{ id: "p1", text: "عبارة قائمة", said_on: null }]));
    setMock.mockResolvedValue(
      listOf([
        { id: "p1", text: "عبارة قائمة", said_on: null },
        { id: "new", text: "عبارة جديدة", said_on: null },
      ]),
    );
    renderManager();

    await screen.findByText("عبارة قائمة");

    // Type a new phrase into the add form and add it to the draft.
    const textarea = screen.getByLabelText("العبارة");
    await user.type(textarea, "عبارة جديدة");
    await user.click(screen.getByRole("button", { name: ADD }));

    // It shows in the draft list before saving.
    expect(screen.getByText("عبارة جديدة")).toBeInTheDocument();

    // Save PUTs the WHOLE array (existing + new), re-using the existing id.
    await user.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(setMock).toHaveBeenCalledTimes(1));
    const [orphanId, items] = setMock.mock.calls[0]!;
    expect(orphanId).toBe(ORPHAN_ID);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "p1", text: "عبارة قائمة" });
    expect(items[1]).toMatchObject({ text: "عبارة جديدة" });
    expect(items[1]!.id).toBeUndefined();

    expect(await screen.findByText("تم الحفظ")).toBeInTheDocument();
  });

  it("edits a phrase in place and persists the change through PUT", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(listOf([{ id: "p1", text: "النص الأصلي", said_on: null }]));
    setMock.mockResolvedValue(listOf([{ id: "p1", text: "النص المعدّل", said_on: null }]));
    renderManager();

    await screen.findByText("النص الأصلي");

    // Enter edit mode and change the text.
    await user.click(screen.getByRole("button", { name: "تعديل" }));
    const editArea = screen.getByLabelText("تعديل العبارة");
    await user.clear(editArea);
    await user.type(editArea, "النص المعدّل");
    await user.click(screen.getByRole("button", { name: "تمّ" }));

    await user.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(setMock).toHaveBeenCalledTimes(1));
    const [, items] = setMock.mock.calls[0]!;
    expect(items).toEqual([{ id: "p1", text: "النص المعدّل", said_on: null }]);
  });

  it("deletes a phrase and PUTs the remaining array", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(
      listOf([
        { id: "p1", text: "تبقى", said_on: null },
        { id: "p2", text: "تُحذف", said_on: null },
      ]),
    );
    setMock.mockResolvedValue(listOf([{ id: "p1", text: "تبقى", said_on: null }]));
    renderManager();

    await screen.findByText("تُحذف");

    // Delete the second phrase via its accessible row action.
    const row = screen.getByText("تُحذف").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "حذف هذه العبارة" }));
    expect(screen.queryByText("تُحذف")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(setMock).toHaveBeenCalledTimes(1));
    const [, items] = setMock.mock.calls[0]!;
    expect(items).toEqual([{ id: "p1", text: "تبقى", said_on: null }]);
  });

  it("rejects an empty phrase client-side without adding it", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(listOf([]));
    renderManager();

    await screen.findByText(/لا توجد عبارات بعد/);

    // Clicking add with blank text surfaces the empty error, no row added.
    await user.click(screen.getByRole("button", { name: ADD }));
    expect(screen.getByText("لا يمكن أن تكون العبارة فارغة.")).toBeInTheDocument();
    expect(setMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long phrase client-side", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue(listOf([]));
    renderManager();
    await screen.findByText(/لا توجد عبارات بعد/);

    // The textarea maxLength blocks typing past the cap, so paste over it.
    const textarea = screen.getByLabelText("العبارة") as HTMLTextAreaElement;
    textarea.removeAttribute("maxlength");
    await user.click(textarea);
    await user.paste("x".repeat(IN_HER_WORDS_MAX_LEN + 1));
    await user.click(screen.getByRole("button", { name: ADD }));

    expect(screen.getByText(/اجعلها أقل من/)).toBeInTheDocument();
    expect(setMock).not.toHaveBeenCalled();
  });
});
