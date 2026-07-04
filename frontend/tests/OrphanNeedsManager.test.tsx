import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanNeedsManager } from "@/components/OrphanNeedsManager";
import i18n from "@/i18n";

// Mock only the network helpers; the coded vocabularies + title cap stay real
// so the component's options and client validation match the backend contract.
vi.mock("@/lib/needs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/needs")>();
  return {
    ...actual,
    listNeeds: vi.fn(),
    createNeed: vi.fn(),
    updateNeed: vi.fn(),
    deleteNeed: vi.fn(),
  };
});

import {
  createNeed,
  deleteNeed,
  listNeeds,
  updateNeed,
  type NeedRead,
} from "@/lib/needs";

const listMock = vi.mocked(listNeeds);
const createMock = vi.mocked(createNeed);
const updateMock = vi.mocked(updateNeed);
const deleteMock = vi.mocked(deleteNeed);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

function needOf(partial: Partial<NeedRead> & { id: string; title: string }): NeedRead {
  return {
    orphan_id: ORPHAN_ID,
    description: null,
    internal_note: null,
    category: null,
    target_amount: "90.00",
    currency: "KWD",
    raised_amount: "0.00",
    status: "open",
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
        <OrphanNeedsManager orphanId={ORPHAN_ID} />
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

describe("OrphanNeedsManager", () => {
  it("lists existing needs with localized category/status chips and the read-only raised progress", async () => {
    listMock.mockResolvedValue([
      needOf({
        id: "n1",
        title: "بدل إيجار",
        category: "rent",
        raised_amount: "30.00",
        internal_note: "التنسيق مع الأخصائية سلمى",
      }),
      needOf({ id: "n2", title: "علاج الربو", category: "medicine", status: "met" }),
    ]);
    renderManager();

    const first = (await screen.findByText("بدل إيجار")).closest("li")!;
    expect(within(first).getByText("إيجار السكن")).toBeInTheDocument();
    expect(within(first).getByText("قائم")).toBeInTheDocument();
    // System-managed money trail is displayed read-only (with the progress %).
    expect(within(first).getByText("جُمع 30.00 من 90.00 KWD")).toBeInTheDocument();
    expect(within(first).getByText("33%")).toBeInTheDocument();
    expect(within(first).getByText(/التنسيق مع الأخصائية سلمى/)).toBeInTheDocument();
    const second = screen.getByText("علاج الربو").closest("li")!;
    expect(within(second).getByText("تمّت تلبيته")).toBeInTheDocument();
  });

  it("adds a need through POST with the coded category and without any raised_amount or status key", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(needOf({ id: "new", title: "قرطاسية", category: "supplies" }));
    renderManager();

    await screen.findByText(/لا توجد احتياجات بعد/);

    await user.type(screen.getByLabelText("الاحتياج"), "قرطاسية");
    await user.selectOptions(screen.getByLabelText("التصنيف"), "supplies");
    await user.type(screen.getByLabelText("المبلغ المستهدف"), "8");
    await user.type(screen.getByLabelText("العملة"), "kwd");
    await user.click(screen.getByRole("button", { name: "إضافة الاحتياج" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // raised_amount / status are NOT members of the payload — system-managed.
    expect(createMock).toHaveBeenCalledWith(ORPHAN_ID, {
      title: "قرطاسية",
      description: null,
      internal_note: null,
      category: "supplies",
      target_amount: "8",
      currency: "KWD",
    });
  });

  it("edits a need in place and PATCHes only that row (status via the controlled select)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([needOf({ id: "n1", title: "علاج", category: "medicine" })]);
    updateMock.mockResolvedValue(
      needOf({ id: "n1", title: "علاج", category: "medicine", status: "met" }),
    );
    renderManager();

    await screen.findByText("علاج");

    await user.click(screen.getByRole("button", { name: "تعديل" }));
    await user.selectOptions(screen.getByLabelText("تعديل الحالة"), "met");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith("n1", {
      title: "علاج",
      description: null,
      internal_note: null,
      category: "medicine",
      target_amount: "90.00",
      currency: "KWD",
      status: "met",
    });
  });

  it("deletes a need via its accessible row action", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([
      needOf({ id: "n1", title: "يبقى" }),
      needOf({ id: "n2", title: "يُحذف" }),
    ]);
    deleteMock.mockResolvedValue(undefined);
    renderManager();

    await screen.findByText("يُحذف");

    const row = screen.getByText("يُحذف").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "حذف هذا الاحتياج" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith("n2");
  });

  it("rejects an empty title client-side without posting", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    renderManager();

    await screen.findByText(/لا توجد احتياجات بعد/);

    await user.click(screen.getByRole("button", { name: "إضافة الاحتياج" }));
    expect(screen.getByText("لا يمكن أن يكون عنوان الاحتياج فارغًا.")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});
