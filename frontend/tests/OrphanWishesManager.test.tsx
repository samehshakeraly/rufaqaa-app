import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanWishesManager } from "@/components/OrphanWishesManager";
import i18n from "@/i18n";

// Mock only the network helpers; the coded vocabulary + title cap stay real
// so the component's options and client validation match the backend contract.
vi.mock("@/lib/wishes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wishes")>();
  return {
    ...actual,
    listWishes: vi.fn(),
    createWish: vi.fn(),
    updateWish: vi.fn(),
    deleteWish: vi.fn(),
  };
});

import {
  createWish,
  deleteWish,
  listWishes,
  updateWish,
  type WishRead,
} from "@/lib/wishes";

const listMock = vi.mocked(listWishes);
const createMock = vi.mocked(createWish);
const updateMock = vi.mocked(updateWish);
const deleteMock = vi.mocked(deleteWish);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

function wishOf(partial: Partial<WishRead> & { id: string; title: string }): WishRead {
  return {
    orphan_id: ORPHAN_ID,
    description: null,
    internal_note: null,
    target_amount: "45.00",
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
        <OrphanWishesManager orphanId={ORPHAN_ID} />
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

describe("OrphanWishesManager", () => {
  it("lists existing wishes with the localized status chip, the read-only raised progress and the staff note", async () => {
    listMock.mockResolvedValue([
      wishOf({
        id: "w1",
        title: "دراجة هوائية",
        raised_amount: "18.00",
        description: "تحلم بدراجة.",
        internal_note: "تنسيق التسليم مع الأخصائية",
      }),
      wishOf({ id: "w2", title: "مصحف مجوّد", status: "fulfilled" }),
    ]);
    renderManager();

    const first = (await screen.findByText("دراجة هوائية")).closest("li")!;
    expect(within(first).getByText("مفتوحة")).toBeInTheDocument();
    // System-managed money trail is displayed read-only (with the progress %).
    expect(within(first).getByText("جُمع 18.00 من 45.00 KWD")).toBeInTheDocument();
    expect(within(first).getByText("40%")).toBeInTheDocument();
    expect(within(first).getByText(/تنسيق التسليم مع الأخصائية/)).toBeInTheDocument();
    const second = screen.getByText("مصحف مجوّد").closest("li")!;
    expect(within(second).getByText("تحقّقت")).toBeInTheDocument();
  });

  it("adds a wish through POST without any raised_amount or status key", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(wishOf({ id: "new", title: "طقم ألوان" }));
    renderManager();

    await screen.findByText(/لا توجد أمنيات بعد/);

    await user.type(screen.getByLabelText("الأمنية"), "طقم ألوان");
    await user.type(screen.getByLabelText("المبلغ المستهدف"), "20");
    await user.type(screen.getByLabelText("العملة"), "kwd");
    await user.type(screen.getByLabelText("نبذة للكافل (اختيارية)"), "موهوبة في الرسم");
    await user.type(screen.getByLabelText("ملاحظة الفريق (اختيارية)"), "قبل مايو");
    await user.click(screen.getByRole("button", { name: "إضافة الأمنية" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    // raised_amount / status are NOT members of the payload — system-managed.
    expect(createMock).toHaveBeenCalledWith(ORPHAN_ID, {
      title: "طقم ألوان",
      description: "موهوبة في الرسم",
      internal_note: "قبل مايو",
      target_amount: "20",
      currency: "KWD",
    });
  });

  it("edits a wish in place and PATCHes only that row (status via the controlled select)", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([wishOf({ id: "w1", title: "دراجة" })]);
    updateMock.mockResolvedValue(wishOf({ id: "w1", title: "دراجة", status: "fulfilled" }));
    renderManager();

    await screen.findByText("دراجة");

    await user.click(screen.getByRole("button", { name: "تعديل" }));
    await user.selectOptions(screen.getByLabelText("تعديل الحالة"), "fulfilled");
    await user.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith("w1", {
      title: "دراجة",
      description: null,
      internal_note: null,
      target_amount: "45.00",
      currency: "KWD",
      status: "fulfilled",
    });
  });

  it("deletes a wish via its accessible row action", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([
      wishOf({ id: "w1", title: "تبقى" }),
      wishOf({ id: "w2", title: "تُحذف" }),
    ]);
    deleteMock.mockResolvedValue(undefined);
    renderManager();

    await screen.findByText("تُحذف");

    const row = screen.getByText("تُحذف").closest("li")!;
    await user.click(within(row).getByRole("button", { name: "حذف هذه الأمنية" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));
    expect(deleteMock).toHaveBeenCalledWith("w2");
  });

  it("rejects an empty title, a non-positive amount and a bad currency client-side without posting", async () => {
    const user = userEvent.setup();
    listMock.mockResolvedValue([]);
    renderManager();

    await screen.findByText(/لا توجد أمنيات بعد/);

    await user.click(screen.getByRole("button", { name: "إضافة الأمنية" }));
    expect(screen.getByText("لا يمكن أن يكون عنوان الأمنية فارغًا.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("الأمنية"), "أمنية");
    await user.click(screen.getByRole("button", { name: "إضافة الأمنية" }));
    expect(screen.getByText("أدخل مبلغًا مستهدفًا أكبر من صفر.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("المبلغ المستهدف"), "20");
    await user.type(screen.getByLabelText("العملة"), "K1");
    await user.click(screen.getByRole("button", { name: "إضافة الأمنية" }));
    expect(screen.getByText("أدخل رمز عملة من ثلاثة أحرف (مثل KWD).")).toBeInTheDocument();

    expect(createMock).not.toHaveBeenCalled();
  });
});
