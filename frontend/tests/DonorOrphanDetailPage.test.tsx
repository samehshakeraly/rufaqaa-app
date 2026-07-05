import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { DonorOrphanDetailPage } from "@/pages/DonorOrphanDetailPage";

// The page consumes four donor-scoped clients; mock all so the composed
// profile renders in isolation from a fixed SponsoredOrphanProfile.
vi.mock("@/lib/sponsorships", () => ({ listMySponsorships: vi.fn() }));
vi.mock("@/lib/reports", () => ({ listMyReports: vi.fn() }));
vi.mock("@/lib/payments", () => ({ listMyPayments: vi.fn() }));
vi.mock("@/lib/public", () => ({
  getSponsoredOrphanProfile: vi.fn(),
  getPublicStats: vi.fn(),
  listPublicOrphans: vi.fn(),
}));
// The message archive ("أرشيف رسائلك إليها") fetches independently; mock the
// two clients + the length constant so the section renders in isolation.
vi.mock("@/lib/messages", () => ({
  listSponsorshipMessages: vi.fn(),
  sendSponsorshipMessage: vi.fn(),
  SPONSORSHIP_MESSAGE_MAX_LEN: 2000,
}));

import { listSponsorshipMessages, sendSponsorshipMessage } from "@/lib/messages";
import { listMyPayments } from "@/lib/payments";
import { getPublicStats, getSponsoredOrphanProfile, listPublicOrphans } from "@/lib/public";
import { listMyReports } from "@/lib/reports";
import { listMySponsorships } from "@/lib/sponsorships";

const sponsorshipsMock = vi.mocked(listMySponsorships);
const reportsMock = vi.mocked(listMyReports);
const paymentsMock = vi.mocked(listMyPayments);
const profileMock = vi.mocked(getSponsoredOrphanProfile);
const statsMock = vi.mocked(getPublicStats);
const waitingMock = vi.mocked(listPublicOrphans);
const archiveListMock = vi.mocked(listSponsorshipMessages);
const archiveSendMock = vi.mocked(sendSponsorshipMessage);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

// The seven v4 tabs, by their Arabic titles.
const TAB_ABOUT = "من أنا";
const TAB_EDUCATION = "التعليم والتربية";
const TAB_REPORTS = "التقارير";
const TAB_MEDIA = "الميديا";
const TAB_SPONSORSHIP = "كفالتك";
const TAB_GIFTS = "الهدايا والأمنيات";
const TAB_IMPACT = "أثرك";

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

const SPONSORSHIP = {
  id: "s-1",
  code: "SPN-1",
  donor_id: "d-1",
  orphan_id: ORPHAN_ID,
  monthly_amount: "30",
  currency: "USD",
  start_date: monthsAgo(14),
  end_date: null,
  payment_frequency: "monthly",
  status: "active",
  total_paid: "420",
  payments_count: 14,
  next_payment_date: "2026-07-01",
  created_at: monthsAgo(14),
  donor_code: "DNR-1",
  donor_name: "كفيل",
  orphan_code: "ORF-99",
  orphan_name: "عائشة",
};

// Always-present identity slice (the donor-safe set).
const IDENTITY = {
  first_name: "عائشة",
  age_years: 10,
  gender: "F" as const,
  country: "EG",
  partner_organization_name: "دار الأمل",
  aspiration: "أن تصبح معلمة",
  education_stage: "primary",
  quran_juz_memorized: 5,
  is_hafiz: false,
  tags: ["نشيطة"],
  languages: ["العربية"],
  orphan_status: "father" as const,
};

// A fully-composed profile: every optional block is present.
const FULL_PROFILE = {
  ...IDENTITY,
  dream: { aspiration: "أن تصبح معلمة" },
  her_world: {
    education_stage: "primary",
    is_hafiz: false,
    quran_juz_memorized: 5,
    tags: ["نشيطة", "تحبّ الرسم"],
  },
  quran_growth: {
    series: [
      { period: "2025-01-01", juz_memorized: 2 },
      { period: "2025-06-01", juz_memorized: 5 },
    ],
  },
  multidim_growth: {
    education_stage: { first: "kindergarten", latest: "primary" },
    attendance_percent: { first: 80, latest: 95 },
    social: { first: "improving", latest: "good" },
  },
  milestones: {
    items: [{ label: "أتمّت حفظ جزء عمّ", period: "2025-03-01" }],
  },
  recent_updates: {
    items: [{ period: "2025-06-01", headline: "تحسّن ملحوظ في القراءة" }],
  },
  supervisor_word: {
    text: "عائشة فتاة مجتهدة ومحبوبة بين أقرانها.",
    period: "2025-06-10",
    author_label: "الأستاذة منى",
  },
  since_you_began: {
    start_date: monthsAgo(14),
    juz_gained: 3,
    milestones_count: 1,
    reports_count: 4,
  },
  in_her_words: [
    { text: "أحبّ الرسم في الصباح", said_on: "2025-05-01" },
    { text: "أريد أن أتعلّم العزف", said_on: null },
  ],
  media: {
    drawings: [
      {
        id: "d1",
        title: "بيتنا",
        caption: "رسمت بيت العائلة",
        display_date: "2025-05-01",
        url: "https://cdn.example/d1-full.jpg",
        thumbnail_url: "https://cdn.example/d1-thumb.jpg",
        duration_seconds: null,
        width: 800,
        height: 600,
      },
      {
        id: "d2",
        title: null,
        caption: null,
        display_date: "2025-05-10",
        url: "https://cdn.example/d2-full.jpg",
        thumbnail_url: null,
        duration_seconds: null,
        width: null,
        height: null,
      },
    ],
    certificates: [
      {
        id: "c1",
        title: "شهادة تفوّق",
        caption: null,
        display_date: "2025-04-01",
        url: "https://cdn.example/c1-full.jpg",
        thumbnail_url: "https://cdn.example/c1-thumb.jpg",
        duration_seconds: null,
        width: 1000,
        height: 700,
      },
    ],
    album: [
      {
        id: "a1",
        title: null,
        caption: "في الرحلة المدرسية",
        display_date: "2025-03-15",
        url: "https://cdn.example/a1-full.jpg",
        thumbnail_url: "https://cdn.example/a1-thumb.jpg",
        duration_seconds: null,
        width: null,
        height: null,
      },
    ],
    recitations: [
      {
        id: "r1",
        title: "سورة الفاتحة",
        caption: null,
        display_date: "2025-02-01",
        url: "https://cdn.example/r1.mp3",
        thumbnail_url: null,
        duration_seconds: 95,
        width: null,
        height: null,
      },
    ],
  },
  father_memory: { father_name: "أحمد", death_year: 2019 },
  health: {
    status_label: "good",
    last_checkup: "2026-04-10",
    vaccinations_status: "up_to_date",
  },
  home: { governorate: "الفروانية", housing_status: "rented" },
  guardian: { relation: "mother", occupation: "معلّمة" },
  siblings: {
    items: [
      {
        first_name: "سلمى",
        age_years: 15,
        gender: "F",
        sponsorship_status: "sponsored",
        code: null,
      },
      {
        first_name: "يوسف",
        age_years: 7,
        gender: "M",
        sponsorship_status: "awaiting_sponsor",
        code: "ORP-2044",
      },
    ],
  },
  independence: { stage: "skill_building" },
  skills: {
    items: [
      { name: "الخطّ العربي", category: "arts", level: "beginner" },
      { name: "القراءة الجهرية", category: "academic", level: null },
    ],
  },
  wishes: {
    items: [
      {
        title: "دراجة هوائية",
        description: "تحلم بدراجة تذهب بها إلى مركز التحفيظ.",
        target_amount: "50",
        raised_amount: "20",
        currency: "KWD",
        status: "open",
        progress: 40,
      },
    ],
  },
  needs: {
    items: [
      {
        title: "حقيبة مدرسية",
        description: null,
        category: "supplies",
        target_amount: "30",
        raised_amount: "30",
        currency: "KWD",
        status: "met",
        progress: 100,
      },
      {
        title: "معطف شتوي",
        description: "لموسم البرد القادم.",
        category: "clothing",
        target_amount: "25",
        raised_amount: "5",
        currency: "KWD",
        status: "open",
        progress: 20,
      },
    ],
  },
};

// Identity only — every element block omitted (backend hid/absent them all).
const IDENTITY_ONLY = { ...IDENTITY };

function page<T>(items: T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

/** Exposes the current location search so URL-backed tab state is testable. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-search">{location.search}</span>;
}

function renderPage(initialPath = `/donor/orphans/${ORPHAN_ID}`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/donor/orphans/:id"
              element={
                <>
                  <DonorOrphanDetailPage />
                  <LocationProbe />
                </>
              }
            />
            <Route path="/donor/orphans" element={<div>orphans list</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

/** Click a tab by its accessible name (waits for the tablist to mount). */
async function openTab(name: string) {
  const user = userEvent.setup();
  const tab = await screen.findByRole("tab", { name });
  await user.click(tab);
}

beforeEach(async () => {
  await i18n.changeLanguage("ar");
  sponsorshipsMock.mockReset();
  reportsMock.mockReset();
  paymentsMock.mockReset();
  profileMock.mockReset();
  statsMock.mockReset();
  waitingMock.mockReset();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sponsorshipsMock.mockResolvedValue(page([SPONSORSHIP]) as any);
  reportsMock.mockResolvedValue(page([]) as never);
  paymentsMock.mockResolvedValue(page([]) as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profileMock.mockResolvedValue(FULL_PROFILE as any);
  // Closing-zone public queries default to benign values so the existing
  // suites are unaffected; individual tests override as needed.
  statsMock.mockResolvedValue({
    orphans_available: 12,
    orphans_sponsored: 120,
    donors_total: 45,
    countries_served: 7,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitingMock.mockResolvedValue(page([]) as any);
  archiveListMock.mockReset();
  archiveSendMock.mockReset();
  // Default: empty archive (most suites don't care about the messages block).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  archiveListMock.mockResolvedValue(page([]) as any);
});

describe("DonorOrphanDetailPage — v4 app-shell (tabs + rail)", () => {
  it("renders the seven tabs in order with من أنا selected by default", async () => {
    renderPage();

    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      TAB_ABOUT,
      TAB_EDUCATION,
      TAB_REPORTS,
      TAB_MEDIA,
      TAB_SPONSORSHIP,
      TAB_GIFTS,
      TAB_IMPACT,
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    // The default tab shows "who she is"; other tabs' content stays absent.
    expect(await screen.findByText("عالم عائشة اليوم")).toBeInTheDocument();
    expect(screen.queryByText("رحلة الحفظ")).not.toBeInTheDocument();
    expect(screen.queryByText("مسار الشفافية المالية")).not.toBeInTheDocument();
  });

  it("switches tabs on click and mirrors the tab in the URL", async () => {
    renderPage();

    await openTab(TAB_MEDIA);

    expect(screen.getByTestId("location-search").textContent).toContain("tab=media");
    expect(
      await screen.findByRole("region", { name: "أرشيف رسائلك إليها" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("عالم عائشة اليوم")).not.toBeInTheDocument();
  });

  it("deep-links a tab from the URL (shareable)", async () => {
    renderPage(`/donor/orphans/${ORPHAN_ID}?tab=education`);

    expect(await screen.findByRole("heading", { name: "رحلة الحفظ" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: TAB_EDUCATION })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves the selection with arrow keys (RTL-aware)", async () => {
    const user = userEvent.setup();
    renderPage();

    const aboutTab = await screen.findByRole("tab", { name: TAB_ABOUT });
    await user.click(aboutTab);
    // In RTL, ArrowLeft moves toward the reading direction — the next tab.
    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("tab", { name: TAB_EDUCATION })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("heading", { name: "رحلة الحفظ" })).toBeInTheDocument();
  });

  it("shows a sticky chapter nav for the present sections of the active tab", async () => {
    renderPage();

    const nav = await screen.findByRole("navigation", { name: "محتويات القسم" });
    // Chapters mirror the PRESENT blocks, in tab order.
    expect(within(nav).getByRole("button", { name: "خريطة الحلم" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "عالمها اليوم" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "ذكرى الأب" })).toBeInTheDocument();
    // Chapters of other tabs don't leak in.
    expect(within(nav).queryByRole("button", { name: "رحلة الحفظ" })).not.toBeInTheDocument();
  });

  it("shows a gentle empty state for a tab with no present sections", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    await openTab(TAB_GIFTS);

    expect(await screen.findByText("لا شيء هنا بعد")).toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — identity rail", () => {
  it("renders identity, chips, rings, counters, dream and the next-payment summary", async () => {
    renderPage();

    const rail = await screen.findByRole("complementary", { name: "بطاقة عائشة" });

    // Identity: name (page h1) + code + facts.
    expect(within(rail).getByRole("heading", { level: 1, name: "عائشة" })).toBeInTheDocument();
    expect(within(rail).getByText("ORF-99")).toBeInTheDocument();
    expect(within(rail).getByText("مصر")).toBeInTheDocument();
    expect(within(rail).getByText("دار الأمل")).toBeInTheDocument();
    // Derived orphanhood status + languages chips — localized, never raw.
    expect(within(rail).getByText("يتيم الأب")).toBeInTheDocument();
    expect(within(rail).getByText("العربية")).toBeInTheDocument();
    expect(within(rail).queryByText("father")).not.toBeInTheDocument();

    // Two progress rings, each voiced with its value.
    expect(
      within(rail).getByRole("img", { name: "حفظت 5 من 30 جزءًا" }),
    ).toBeInTheDocument();
    expect(within(rail).getByRole("img", { name: "نسبة الحضور 95٪" })).toBeInTheDocument();

    // Two stat counters (milestones · updates).
    expect(within(rail).getByText("محطّات بارزة")).toBeInTheDocument();
    expect(within(rail).getByText("تحديثات")).toBeInTheDocument();

    // "تحلم بأن…" — the aspiration's ONE home on the page.
    expect(within(rail).getByText("يحلم بأن…")).toBeInTheDocument();
    expect(within(rail).getByText("أن تصبح معلمة")).toBeInTheDocument();

    // Next-payment summary is READ-ONLY: a label + date, never a pay button.
    expect(within(rail).getByText("تاريخ السداد القادم")).toBeInTheDocument();
    expect(within(rail).queryByRole("button", { name: /ادفع|سداد/ })).not.toBeInTheDocument();
  });

  it("jumps to the messages chapter of the media tab from اكتب رسالة", async () => {
    const user = userEvent.setup();
    renderPage();

    const rail = await screen.findByRole("complementary", { name: "بطاقة عائشة" });
    await user.click(within(rail).getByRole("button", { name: "اكتب رسالة" }));

    expect(
      await screen.findByRole("region", { name: "أرشيف رسائلك إليها" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: TAB_MEDIA })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("DonorOrphanDetailPage — message archive (أرشيف رسائلك إليها)", () => {
  // A privacy-safe MessageRead fixture in a given moderation state.
  function archiveMsg(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: `m-${Math.random().toString(36).slice(2)}`,
      from_role: "donor",
      from_name: "",
      to_role: "",
      to_name: "",
      orphan_code: null,
      message_type: "text",
      content: "نص الرسالة",
      moderation_status: "pending",
      moderation_notes: null,
      is_read: false,
      is_mine: true,
      created_at: "2026-06-01T10:00:00Z",
      moderated_at: null,
      read_at: null,
      ...over,
    };
  }

  it("renders each status with its badge, plus the rejected note", async () => {
    archiveListMock.mockResolvedValue(
      page([
        archiveMsg({ content: "رسالة قيد المراجعة", moderation_status: "pending" }),
        archiveMsg({
          content: "رسالة وصلت وقُرئت",
          moderation_status: "approved",
          is_read: true,
        }),
        archiveMsg({
          content: "رسالة مرفوضة",
          moderation_status: "rejected",
          moderation_notes: "خارج الموضوع",
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any,
    );
    renderPage();
    await openTab(TAB_MEDIA);

    const section = await screen.findByRole("region", { name: "أرشيف رسائلك إليها" });
    // pending → warning badge (await the async archive query to resolve)
    expect(await within(section).findByText("قيد المراجعة")).toBeInTheDocument();
    // approved → "وصلت" + a "قُرئت" chip
    expect(within(section).getByText("وصلت")).toBeInTheDocument();
    expect(within(section).getByText("قُرئت")).toBeInTheDocument();
    // rejected → "لم تُعتمد" + the moderation note (sender-only)
    expect(within(section).getByText("لم تُعتمد")).toBeInTheDocument();
    expect(within(section).getByText(/خارج الموضوع/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no messages", async () => {
    renderPage();
    await openTab(TAB_MEDIA);
    const section = await screen.findByRole("region", { name: "أرشيف رسائلك إليها" });
    expect(
      await within(section).findByText(/لم ترسل أي رسالة بعد/),
    ).toBeInTheDocument();
  });

  it("posts a message and shows it immediately as an optimistic pending entry", async () => {
    const user = userEvent.setup();
    // The send never resolves during the assertion, so the entry can only
    // appear via the optimistic update (not a refetch).
    archiveSendMock.mockReturnValue(new Promise(() => {}) as never);
    renderPage();
    await openTab(TAB_MEDIA);

    const section = await screen.findByRole("region", { name: "أرشيف رسائلك إليها" });
    const box = within(section).getByPlaceholderText(/اكتب رسالتك إلى طفلك/);
    await user.type(box, "السلام عليك يا صغيرتي");
    await user.click(within(section).getByRole("button", { name: "إرسال" }));

    expect(archiveSendMock).toHaveBeenCalledWith(ORPHAN_ID, "السلام عليك يا صغيرتي");
    // The optimistic entry appears at once, marked "under review". The content
    // also lives in the textarea, so scope to the thread list item's badge.
    expect(await within(section).findByText("قيد المراجعة")).toBeInTheDocument();
    const rendered = within(section).getAllByText("السلام عليك يا صغيرتي");
    expect(rendered.length).toBeGreaterThanOrEqual(1);
  });
});

describe("DonorOrphanDetailPage — composed donor profile", () => {
  it("renders the من أنا blocks on the default tab", async () => {
    renderPage();

    // Her world (default tab) + the dream roadmap.
    expect(await screen.findByText("عالم عائشة اليوم")).toBeInTheDocument();
    expect(screen.getByText("تحبّ الرسم")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "خريطة الحلم" })).toBeInTheDocument();

    // No raw schema keys leak into the DOM.
    expect(screen.queryByText(/juz_memorized/)).not.toBeInTheDocument();
    expect(screen.queryByText(/multidim_growth/)).not.toBeInTheDocument();
  });

  it("renders the education-and-growth blocks in their tab", async () => {
    renderPage();
    await openTab(TAB_EDUCATION);

    // Qur'an growth — multi-point caption, not the single-point one.
    expect(await screen.findByRole("heading", { name: "رحلة الحفظ" })).toBeInTheDocument();
    expect(screen.getByText("من 2 إلى 5 جزءًا — ما شاء الله.")).toBeInTheDocument();

    // Multidimensional growth — localized before → now. (The attendance %
    // also feeds the rail's ring, so scope to the section.)
    const multidim = screen.getByRole("region", { name: "لمحة عن التقدّم" });
    expect(within(multidim).getByText("جيّد")).toBeInTheDocument(); // social latest "good"
    expect(within(multidim).getByText("95٪")).toBeInTheDocument(); // attendance latest

    // Milestones.
    expect(screen.getByText("محطّات بارزة في الطريق")).toBeInTheDocument();
    expect(screen.getByText("أتمّت حفظ جزء عمّ")).toBeInTheDocument();

    // Supervisor's word.
    expect(screen.getByText("كلمة من المشرف")).toBeInTheDocument();
    expect(screen.getByText(/عائشة فتاة مجتهدة/)).toBeInTheDocument();
    expect(screen.getByText(/الأستاذة منى/)).toBeInTheDocument();
  });

  it("renders recent updates with the timeline link in the reports tab", async () => {
    renderPage();
    await openTab(TAB_REPORTS);

    expect(await screen.findByText("أحدث التحديثات")).toBeInTheDocument();
    expect(screen.getByText("تحسّن ملحوظ في القراءة")).toBeInTheDocument();
    const allUpdates = screen.getByText("اطّلع على كل التحديثات");
    expect(allUpdates.getAttribute("href")).toBe("#reports-timeline");
    // The timeline itself lives in the same tab, so the anchor resolves.
    expect(screen.getByText("كيف حاله؟")).toBeInTheDocument();
  });

  it("renders only the identity when all element blocks are absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    // Identity (rail) still renders intentionally — including the dream,
    // which comes from the ungated identity aspiration.
    expect(await screen.findByText("عائشة")).toBeInTheDocument();
    expect(screen.getByText("مصر")).toBeInTheDocument();
    expect(screen.getByText("يحلم بأن…")).toBeInTheDocument();

    // None of the block-gated sections appear — and nothing crashes.
    expect(screen.queryByText("عالم عائشة اليوم")).not.toBeInTheDocument();
    expect(screen.queryByText("منذ أن بدأت")).not.toBeInTheDocument();

    // The education tab has no present block → gentle empty state.
    await openTab(TAB_EDUCATION);
    expect(await screen.findByText("لا شيء هنا بعد")).toBeInTheDocument();
    expect(screen.queryByText("رحلة الحفظ")).not.toBeInTheDocument();
    expect(screen.queryByText("لمحة عن التقدّم")).not.toBeInTheDocument();
    expect(screen.queryByText("محطّات بارزة في الطريق")).not.toBeInTheDocument();
    expect(screen.queryByText("كلمة من المشرف")).not.toBeInTheDocument();

    // The reports timeline (profile-independent) still mounts in its tab.
    await openTab(TAB_REPORTS);
    expect(await screen.findByText("كيف حاله؟")).toBeInTheDocument();
    expect(screen.queryByText("أحدث التحديثات")).not.toBeInTheDocument();
  });

  it("renders a single-point Qur'an series without a fabricated trend", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      quran_growth: { series: [{ period: "2025-06-01", juz_memorized: 5 }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const { container } = renderPage();
    await openTab(TAB_EDUCATION);

    expect(await screen.findByText("رحلة الحفظ")).toBeInTheDocument();
    // Single-point caption, never the "from → to" slope caption.
    expect(screen.getByText("5 جزءًا حتى الآن.")).toBeInTheDocument();
    expect(screen.queryByText(/من .* إلى .* جزءًا/)).not.toBeInTheDocument();
    // No connecting line/area is drawn for a lone point.
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("polygon")).toBeNull();
  });

  it("is RTL-correct in Arabic — the before→now arrow flips", async () => {
    const { container } = renderPage();
    await openTab(TAB_EDUCATION);

    await screen.findByText("لمحة عن التقدّم");
    // The multidim arrow is mirrored in RTL so it points first → latest.
    expect(container.querySelector("svg.-scale-x-100")).not.toBeNull();
  });
});

describe("DonorOrphanDetailPage — in her words", () => {
  it("renders each curated phrase as a quote card", async () => {
    renderPage();

    // Section heading (بكلمات عائشة) + both phrases — default tab.
    expect(await screen.findByText("بكلمات عائشة")).toBeInTheDocument();
    expect(screen.getByText("أحبّ الرسم في الصباح")).toBeInTheDocument();
    expect(screen.getByText("أريد أن أتعلّم العزف")).toBeInTheDocument();

    // The internal id never appears (donor projection has none).
    expect(screen.queryByText(/said_on/)).not.toBeInTheDocument();
  });

  it("omits the section entirely when there are no phrases", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByText(/بكلمات/)).not.toBeInTheDocument();
  });

  it("omits the section when the block is an empty array", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue({ ...IDENTITY, in_her_words: [] } as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByText(/بكلمات/)).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — father's memory (ذكرى الأب)", () => {
  it("renders the dignified remembrance with the name and the YEAR only", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "ذكرى الأب" });
    expect(within(section).getByText("في ذمّة الله")).toBeInTheDocument();
    expect(within(section).getByText("أحمد")).toBeInTheDocument();
    // YEAR only — never a full date.
    expect(within(section).getByText("توفّي عام 2019")).toBeInTheDocument();
    expect(within(section).getByText(/نسأل الله أن يتغمّده/)).toBeInTheDocument();
  });

  it("renders the name but no death line when death_year is null", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      father_memory: { father_name: "محمود", death_year: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();

    const section = await screen.findByRole("region", { name: "ذكرى الأب" });
    expect(within(section).getByText("محمود")).toBeInTheDocument();
    expect(within(section).queryByText(/توفّي/)).not.toBeInTheDocument();
  });

  it("omits the block entirely when father_memory is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByRole("region", { name: "ذكرى الأب" })).not.toBeInTheDocument();
    expect(screen.queryByText("في ذمّة الله")).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — health (الاطمئنان الصحي)", () => {
  it("renders the reassuring summary with localized coded values only", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "الاطمئنان على صحة عائشة" });
    // Coded status → warm localized label, never the raw code.
    expect(within(section).getByText("بصحة جيدة والحمد لله")).toBeInTheDocument();
    expect(within(section).getByText("آخر فحص طبي")).toBeInTheDocument();
    expect(within(section).getByText("التطعيمات")).toBeInTheDocument();
    expect(within(section).getByText("مكتملة")).toBeInTheDocument();
    expect(within(section).queryByText("up_to_date")).not.toBeInTheDocument();
    expect(within(section).queryByText("good")).not.toBeInTheDocument();
  });

  it("renders only the fields the backend included", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      health: { status_label: null, last_checkup: "2026-01-05", vaccinations_status: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();

    const section = await screen.findByRole("region", { name: "الاطمئنان على صحة عائشة" });
    expect(within(section).getByText("آخر فحص طبي")).toBeInTheDocument();
    expect(within(section).queryByText("التطعيمات")).not.toBeInTheDocument();
    expect(within(section).queryByText("بصحة جيدة والحمد لله")).not.toBeInTheDocument();
  });

  it("omits the section entirely when the block is absent (hidden or no data)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(
      screen.queryByRole("region", { name: /الاطمئنان على صحة/ }),
    ).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — home (بيت عائشة)", () => {
  it("renders the PII-free home glimpse with localized coded housing", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "بيت عائشة" });
    expect(within(section).getByText("المحافظة")).toBeInTheDocument();
    expect(within(section).getByText("الفروانية")).toBeInTheDocument();
    expect(within(section).getByText("السكن")).toBeInTheDocument();
    // Coded housing status → localized label, never the raw code.
    expect(within(section).getByText("إيجار")).toBeInTheDocument();
    expect(within(section).queryByText("rented")).not.toBeInTheDocument();
  });

  it("renders only the fields the backend included", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      home: { governorate: "الفروانية", housing_status: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();

    const section = await screen.findByRole("region", { name: "بيت عائشة" });
    expect(within(section).getByText("الفروانية")).toBeInTheDocument();
    expect(within(section).queryByText("السكن")).not.toBeInTheDocument();
  });

  it("omits the section entirely when the block is absent (hidden or no data)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByRole("region", { name: "بيت عائشة" })).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — guardian (من يرعاها)", () => {
  it("renders only the localized coded relation and the occupation", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "من يرعى عائشة" });
    expect(within(section).getByText("صلة القرابة")).toBeInTheDocument();
    // Coded relation → localized label, never the raw code.
    expect(within(section).getByText("أم")).toBeInTheDocument();
    expect(within(section).getByText("المهنة")).toBeInTheDocument();
    expect(within(section).getByText("معلّمة")).toBeInTheDocument();
    expect(within(section).queryByText("mother")).not.toBeInTheDocument();
  });

  it("omits the occupation tile when the backend sent none", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      guardian: { relation: "grandmother", occupation: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();

    const section = await screen.findByRole("region", { name: "من يرعى عائشة" });
    expect(within(section).getByText("جدة")).toBeInTheDocument();
    expect(within(section).queryByText("المهنة")).not.toBeInTheDocument();
  });

  it("omits the section entirely when the block is absent (hidden or no data)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByRole("region", { name: "من يرعى عائشة" })).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — siblings (إخوتها)", () => {
  it("renders one card per sibling with localized status labels", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "إخوة عائشة" });
    expect(within(section).getByText("سلمى")).toBeInTheDocument();
    expect(within(section).getByText("تحت الكفالة")).toBeInTheDocument();
    expect(within(section).getByText("يوسف")).toBeInTheDocument();
    expect(within(section).getByText("بانتظار كافل")).toBeInTheDocument();
    // Coded statuses are localized, never rendered raw.
    expect(within(section).queryByText("sponsored")).not.toBeInTheDocument();
    expect(within(section).queryByText("awaiting_sponsor")).not.toBeInTheDocument();
  });

  it("links the sponsorship CTA only for the awaiting sibling", async () => {
    renderPage();

    const section = await screen.findByRole("region", { name: "إخوة عائشة" });
    const links = within(section).getAllByRole("link", { name: /بادر بالكفالة/ });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/orphans/ORP-2044");
  });

  it("omits the section entirely when the block is absent (hidden or no data)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByRole("region", { name: "إخوة عائشة" })).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — independence (رحلة الاستقلال)", () => {
  it("renders the localized stage, derives the next step and shows the charter", async () => {
    renderPage();
    await openTab(TAB_EDUCATION);

    const section = await screen.findByRole("region", { name: "رحلة عائشة نحو الاستقلال" });
    // Current stage tile — the coded value is localized, never rendered raw.
    expect(within(section).getByText("المرحلة الحالية")).toBeInTheDocument();
    expect(within(section).getAllByText("بناء المهارات").length).toBeGreaterThan(0);
    expect(within(section).queryByText("skill_building")).not.toBeInTheDocument();
    // The next step is DERIVED from the ordered vocabulary (skill_building →
    // vocational_training) — the backend never sent it.
    expect(within(section).getByText("الخطوة التالية")).toBeInTheDocument();
    expect(within(section).getAllByText("التدريب المهني").length).toBeGreaterThan(0);
    // The stepper walks the full ordered vocabulary, current stage marked.
    const steps = within(section).getAllByRole("listitem");
    expect(steps).toHaveLength(5);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    // The static, localized empowerment charter.
    expect(within(section).getByText("ميثاق التمكين")).toBeInTheDocument();
    expect(within(section).getByText(/نرافق عائشة خطوة بخطوة/)).toBeInTheDocument();
  });

  it("shows the journey-complete phrasing on the final stage", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      independence: { stage: "independence" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();
    await openTab(TAB_EDUCATION);

    const section = await screen.findByRole("region", { name: "رحلة عائشة نحو الاستقلال" });
    expect(
      within(section).getByText("بلغت الاستقلال — اكتملت الرحلة بفضل الله"),
    ).toBeInTheDocument();
  });

  it("omits the section entirely when the block is absent (hidden or no stage)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    await openTab(TAB_EDUCATION);
    expect(
      screen.queryByRole("region", { name: /رحلة .* نحو الاستقلال/ }),
    ).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — skills (المهارات)", () => {
  it("renders each skill with its localized category and level", async () => {
    renderPage();
    await openTab(TAB_EDUCATION);

    const section = await screen.findByRole("region", { name: "مهارات عائشة" });
    expect(within(section).getByText("الخطّ العربي")).toBeInTheDocument();
    expect(within(section).getByText("فنون")).toBeInTheDocument();
    expect(within(section).getByText("مبتدئة")).toBeInTheDocument();
    // A skill without a level renders name-only; codes never leak raw.
    expect(within(section).getByText("القراءة الجهرية")).toBeInTheDocument();
    expect(within(section).queryByText("arts")).not.toBeInTheDocument();
    expect(within(section).queryByText("beginner")).not.toBeInTheDocument();
  });

  it("omits the section entirely when the block is absent (hidden or empty)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    await openTab(TAB_EDUCATION);
    expect(screen.queryByRole("region", { name: "مهارات عائشة" })).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — gifts (الهدايا والأمنيات)", () => {
  it("renders wishes with the money trail and a DISABLED CTA (finance deferred)", async () => {
    renderPage();
    await openTab(TAB_GIFTS);

    const section = await screen.findByRole("region", { name: "أمنيات عائشة" });
    expect(within(section).getByText("دراجة هوائية")).toBeInTheDocument();
    expect(within(section).getByText(/تحلم بدراجة/)).toBeInTheDocument();
    expect(within(section).getByText("جُمع 20 من 50 KWD")).toBeInTheDocument();
    expect(within(section).getByText("مفتوحة")).toBeInTheDocument();

    // The donation CTA renders DISABLED and is never wired to a flow.
    const cta = within(section).getByRole("button", { name: "حقّق هذه الأمنية" });
    expect(cta).toBeDisabled();
    expect(within(section).getByText(/التبرّعات المباشرة ستتوفّر قريبًا/)).toBeInTheDocument();
  });

  it("renders needs with category chips; a met need carries no CTA", async () => {
    renderPage();
    await openTab(TAB_GIFTS);

    const section = await screen.findByRole("region", { name: "احتياجات عائشة" });
    // Met need: localized category + status, no CTA.
    expect(within(section).getByText("حقيبة مدرسية")).toBeInTheDocument();
    expect(within(section).getByText("مستلزمات دراسية")).toBeInTheDocument();
    expect(within(section).getByText("تمّت تلبيته")).toBeInTheDocument();
    // Open need: disabled CTA only.
    expect(within(section).getByText("معطف شتوي")).toBeInTheDocument();
    const ctas = within(section).getAllByRole("button", { name: "ادعم هذا الاحتياج" });
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toBeDisabled();
    // Raw codes never leak.
    expect(within(section).queryByText("supplies")).not.toBeInTheDocument();
    expect(within(section).queryByText("met")).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — memory box", () => {
  it("renders each media group with the right counts and an audio player", async () => {
    const { container } = renderPage();
    await openTab(TAB_MEDIA);

    // Zone heading.
    expect(await screen.findByText("صندوق ذكريات عائشة")).toBeInTheDocument();

    // Two drawings: one with a thumbnail, one falling back to the full url.
    const drawings = container.querySelector('img[src="https://cdn.example/d1-thumb.jpg"]');
    expect(drawings).not.toBeNull();
    expect(container.querySelector('img[src="https://cdn.example/d2-full.jpg"]')).not.toBeNull();

    // Certificate + album images present.
    expect(container.querySelector('img[src="https://cdn.example/c1-thumb.jpg"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://cdn.example/a1-thumb.jpg"]')).not.toBeNull();

    // Recitation → an <audio> with the presigned src and an accessible name.
    const audios = container.querySelectorAll("audio");
    expect(audios).toHaveLength(1);
    const audio = audios[0]!;
    expect(audio.getAttribute("src")).toBe("https://cdn.example/r1.mp3");
    expect(audio.getAttribute("aria-label")).toBe("تلاوة: سورة الفاتحة");
    // Duration formatted as m:ss.
    expect(screen.getByText("1:35")).toBeInTheDocument();
  });

  it("filters the box to one group via the toggle chips (no 'all' chip)", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await openTab(TAB_MEDIA);

    await screen.findByText("صندوق ذكريات عائشة");
    const filters = screen.getByRole("group", { name: "تصفية الوسائط" });
    // One chip per NON-EMPTY group — and deliberately no "all" chip.
    expect(within(filters).getAllByRole("button")).toHaveLength(4);
    expect(within(filters).queryByRole("button", { name: /الكل/ })).not.toBeInTheDocument();

    // Toggle ON: only the recitations group remains.
    await user.click(within(filters).getByRole("button", { name: "تلاوات" }));
    expect(screen.getByText("تلاوات عائشة")).toBeInTheDocument();
    expect(screen.queryByText("رسومات عائشة")).not.toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);

    // Toggle OFF: every group returns.
    await user.click(within(filters).getByRole("button", { name: "تلاوات" }));
    expect(screen.getByText("رسومات عائشة")).toBeInTheDocument();
    expect(screen.getByText("شهادات عائشة")).toBeInTheDocument();
  });

  it("opens the lightbox on a tile click and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderPage();
    await openTab(TAB_MEDIA);

    await screen.findByText("صندوق ذكريات عائشة");

    // Click the first drawing tile (labelled by its title).
    await user.click(screen.getByRole("button", { name: "عرض: بيتنا" }));

    const dialog = await screen.findByRole("dialog");
    // Full-resolution url shown inside the dialog.
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(
      "https://cdn.example/d1-full.jpg",
    );
    expect(within(dialog).getByText("رسمت بيت العائلة")).toBeInTheDocument();

    // Escape dismisses it.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("omits an empty group while still rendering the non-empty ones", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      media: {
        drawings: [
          {
            id: "d1",
            title: "بيتنا",
            caption: null,
            display_date: "2025-05-01",
            url: "https://cdn.example/d1-full.jpg",
            thumbnail_url: null,
            duration_seconds: null,
            width: null,
            height: null,
          },
        ],
        certificates: [],
        album: [],
        recitations: [],
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();
    await openTab(TAB_MEDIA);

    // The drawings sub-section renders…
    expect(await screen.findByText("رسومات عائشة")).toBeInTheDocument();
    // …while the empty groups are omitted entirely, and a single-group box
    // needs no filter bar.
    expect(screen.queryByText("شهادات عائشة")).not.toBeInTheDocument();
    expect(screen.queryByText("ألبوم لحظات عائشة")).not.toBeInTheDocument();
    expect(screen.queryByText("تلاوات عائشة")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "تصفية الوسائط" })).not.toBeInTheDocument();
  });

  it("renders nothing for the zone when media is null", async () => {
    // IDENTITY_ONLY has no `media` key at all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();
    await openTab(TAB_MEDIA);

    await screen.findByText("عائشة");
    expect(screen.queryByText(/صندوق ذكريات/)).not.toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("renders nothing when media is present but every group is empty", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      media: { drawings: [], certificates: [], album: [], recitations: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();
    await openTab(TAB_MEDIA);

    await screen.findByText("عائشة");
    expect(screen.queryByText(/صندوق ذكريات/)).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — dream roadmap", () => {
  it("marks the current step at education_stage and ends at the aspiration", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue({ ...IDENTITY, education_stage: "preparatory" } as any);
    const { container } = renderPage();

    expect(await screen.findByText("خريطة الحلم")).toBeInTheDocument();
    // Dream node carries the aspiration (which also lives in the rail).
    expect(screen.getAllByText("أن تصبح معلمة").length).toBeGreaterThan(0);
    expect(screen.getAllByText("الحلم").length).toBeGreaterThan(0);

    // The current marker lands on the matching stage (preparatory → إعدادي).
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toContain("إعدادي");
    expect(current?.textContent).toContain("أنت هنا");
  });

  it("renders the path and dream node without a marker when stage is null", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue({ ...IDENTITY, education_stage: null } as any);
    const { container } = renderPage();

    expect(await screen.findByText("خريطة الحلم")).toBeInTheDocument();
    expect(screen.getAllByText("أن تصبح معلمة").length).toBeGreaterThan(0);
    // No "you are here" step is marked.
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.queryByText("أنت هنا")).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — impact tab (أثرك)", () => {
  it("renders the since-you-began strip and the impact tree", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      since_you_began: {
        start_date: monthsAgo(14),
        juz_gained: 3,
        milestones_count: 2,
        reports_count: 4,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    renderPage();
    await openTab(TAB_IMPACT);

    // "Since you began" delta strip.
    expect(await screen.findByText("منذ أن بدأت")).toBeInTheDocument();
    expect(screen.getByText("+3 جزءًا")).toBeInTheDocument();

    // The tree + caption pieces.
    expect(screen.getByText("شجرة أثرك")).toBeInTheDocument();
    expect(screen.getByText(/ثمرة رعايتك تنمو منذ/)).toBeInTheDocument();
    expect(screen.getByText(/14 ورقة/)).toBeInTheDocument();
    expect(screen.getByText(/2 ثمرة/)).toBeInTheDocument();
    // The metaphor SVG is voiced.
    expect(
      screen.getByRole("img", { name: "شجرة ترمز إلى أثر رعايتك، تنمو مع الوقت" }),
    ).toBeInTheDocument();
  });

  it("omits the growth chapter when since_you_began is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();
    await openTab(TAB_IMPACT);

    await screen.findByText("عائشة");
    expect(screen.queryByText("شجرة أثرك")).not.toBeInTheDocument();
    expect(screen.queryByText("منذ أن بدأت")).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — part of something bigger", () => {
  it("renders the three collective figures", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    statsMock.mockResolvedValue({
      orphans_available: 12,
      orphans_sponsored: 120,
      donors_total: 45,
      countries_served: 7,
    });
    renderPage();
    await openTab(TAB_IMPACT);

    const section = await screen.findByRole("region", { name: "جزء من شيء أكبر" });
    // The figures appear once the public stats query resolves (skeleton first).
    expect(await within(section).findByText("120")).toBeInTheDocument();
    expect(within(section).getByText("45")).toBeInTheDocument();
    expect(within(section).getByText("7")).toBeInTheDocument();
    expect(within(section).getByText("طفل تحت الرعاية")).toBeInTheDocument();
    expect(within(section).getByText("كفيل")).toBeInTheDocument();
    expect(within(section).getByText("دولة")).toBeInTheDocument();
  });

  it("omits the section entirely when the stats query rejects", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    statsMock.mockRejectedValue(new Error("stats down"));
    renderPage();
    await openTab(TAB_IMPACT);

    await screen.findByText("عائشة");
    await waitFor(() => expect(screen.queryByText("جزء من شيء أكبر")).not.toBeInTheDocument());
  });
});

describe("DonorOrphanDetailPage — children waiting", () => {
  const WAITING = [
    {
      code: "ORF-99", // same as SPONSORSHIP.orphan_code → must be excluded
      first_name: "مستبعد",
      age_years: 9,
      gender: "F" as const,
      country: "EG",
      case_status: "available",
      partner_organization_name: "دار أ",
    },
    {
      code: "P-1",
      first_name: "سارة",
      age_years: 8,
      gender: "F" as const,
      country: "SY",
      case_status: "available",
      partner_organization_name: "دار ب",
    },
    {
      code: "P-2",
      first_name: "يوسف",
      age_years: 11,
      gender: "M" as const,
      country: "YE",
      case_status: "available",
      partner_organization_name: "دار ج",
    },
    {
      code: "P-3",
      first_name: "ليلى",
      age_years: 7,
      gender: "F" as const,
      country: "JO",
      case_status: "available",
      partner_organization_name: "دار د",
    },
  ];

  it("renders up to 3 cards, excludes the current orphan, and links out", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitingMock.mockResolvedValue(page(WAITING) as any);
    renderPage();
    await openTab(TAB_IMPACT);

    const section = await screen.findByRole("region", { name: "أطفال في انتظار كفيل" });

    // The current child (ORF-99) is filtered out; the next three remain.
    expect(within(section).queryByText("مستبعد")).not.toBeInTheDocument();
    expect(within(section).getByText("سارة")).toBeInTheDocument();
    expect(within(section).getByText("يوسف")).toBeInTheDocument();
    expect(within(section).getByText("ليلى")).toBeInTheDocument();

    // Each card is a real link to the public child page.
    const card = within(section).getByRole("link", { name: "تعرّف على سارة" });
    expect(card.getAttribute("href")).toBe("/orphans/P-1");

    // Closing CTA links to the public browse page — never a payment.
    const cta = within(section).getByRole("link", { name: /اكفل طفلًا آخر/ });
    expect(cta.getAttribute("href")).toBe("/orphans");
  });

  it("omits the section when there are no available children", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitingMock.mockResolvedValue(page([]) as any);
    renderPage();
    await openTab(TAB_IMPACT);

    await screen.findByText("عائشة");
    expect(screen.queryByText("أطفال في انتظار كفيل")).not.toBeInTheDocument();
  });
});
