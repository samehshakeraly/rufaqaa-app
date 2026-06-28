import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

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
};

// Identity only — every element block omitted (backend hid/absent them all).
const IDENTITY_ONLY = { ...IDENTITY };

function page<T>(items: T[]) {
  return { items, total: items.length, limit: 100, offset: 0 };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/donor/orphans/${ORPHAN_ID}`]}>
          <Routes>
            <Route path="/donor/orphans/:id" element={<DonorOrphanDetailPage />} />
            <Route path="/donor/orphans" element={<div>orphans list</div>} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
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
});

describe("DonorOrphanDetailPage — composed donor profile", () => {
  it("renders every composed block when the full profile is present", async () => {
    renderPage();

    // Identity header.
    expect(await screen.findByText("عائشة")).toBeInTheDocument();
    expect(screen.getByText("مصر")).toBeInTheDocument(); // EG → human name
    expect(screen.getByText("دار الأمل")).toBeInTheDocument(); // partner org

    // "Since you began" delta strip.
    expect(screen.getByText("منذ أن بدأت")).toBeInTheDocument();
    expect(screen.getByText("+3 جزءًا")).toBeInTheDocument();

    // Dream — the emotional anchor. The aspiration also appears as the
    // roadmap's dream node, so it legitimately occurs more than once.
    expect(screen.getByText("يحلم بأن…")).toBeInTheDocument();
    expect(screen.getAllByText("أن تصبح معلمة").length).toBeGreaterThan(0);

    // Qur'an growth — multi-point caption, not the single-point one.
    expect(screen.getByText("رحلة الحفظ")).toBeInTheDocument();
    expect(screen.getByText("من 2 إلى 5 جزءًا — ما شاء الله.")).toBeInTheDocument();

    // Multidimensional growth — localized before → now.
    expect(screen.getByText("لمحة عن التقدّم")).toBeInTheDocument();
    expect(screen.getByText("جيّد")).toBeInTheDocument(); // social latest "good"
    expect(screen.getByText("95٪")).toBeInTheDocument(); // attendance latest

    // Milestones.
    expect(screen.getByText("محطّات بارزة في الطريق")).toBeInTheDocument();
    expect(screen.getByText("أتمّت حفظ جزء عمّ")).toBeInTheDocument();

    // Recent updates + link to the full timeline.
    expect(screen.getByText("أحدث التحديثات")).toBeInTheDocument();
    expect(screen.getByText("تحسّن ملحوظ في القراءة")).toBeInTheDocument();
    const allUpdates = screen.getByText("اطّلع على كل التحديثات");
    expect(allUpdates.getAttribute("href")).toBe("#reports-timeline");

    // Supervisor's word.
    expect(screen.getByText("كلمة من المشرف")).toBeInTheDocument();
    expect(screen.getByText(/عائشة فتاة مجتهدة/)).toBeInTheDocument();
    expect(screen.getByText(/الأستاذة منى/)).toBeInTheDocument();

    // Her world.
    expect(screen.getByText("عالم عائشة اليوم")).toBeInTheDocument();
    expect(screen.getByText("تحبّ الرسم")).toBeInTheDocument();

    // No raw schema keys leak into the DOM.
    expect(screen.queryByText(/juz_memorized/)).not.toBeInTheDocument();
    expect(screen.queryByText(/multidim_growth/)).not.toBeInTheDocument();
  });

  it("renders only the identity when all element blocks are absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    // Identity still renders intentionally.
    expect(await screen.findByText("عائشة")).toBeInTheDocument();
    expect(screen.getByText("مصر")).toBeInTheDocument();

    // None of the optional sections appear — and nothing crashes.
    expect(screen.queryByText("يحلم بأن…")).not.toBeInTheDocument();
    expect(screen.queryByText("رحلة الحفظ")).not.toBeInTheDocument();
    expect(screen.queryByText("لمحة عن التقدّم")).not.toBeInTheDocument();
    expect(screen.queryByText("محطّات بارزة في الطريق")).not.toBeInTheDocument();
    expect(screen.queryByText("أحدث التحديثات")).not.toBeInTheDocument();
    expect(screen.queryByText("كلمة من المشرف")).not.toBeInTheDocument();
    expect(screen.queryByText("منذ أن بدأت")).not.toBeInTheDocument();

    // The reports timeline (profile-independent) still mounts.
    expect(screen.getByText("كيف حاله؟")).toBeInTheDocument();
  });

  it("renders a single-point Qur'an series without a fabricated trend", async () => {
    profileMock.mockResolvedValue({
      ...IDENTITY,
      quran_growth: { series: [{ period: "2025-06-01", juz_memorized: 5 }] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const { container } = renderPage();

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

    await screen.findByText("عائشة");
    // The multidim arrow is mirrored in RTL so it points first → latest.
    expect(container.querySelector("svg.-scale-x-100")).not.toBeNull();
  });
});

describe("DonorOrphanDetailPage — in her words", () => {
  it("renders each curated phrase as a quote card", async () => {
    renderPage();

    // Section heading (بكلمات عائشة) + both phrases.
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

describe("DonorOrphanDetailPage — memory box", () => {
  it("renders each media group with the right counts and an audio player", async () => {
    const { container } = renderPage();

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

  it("opens the lightbox on a tile click and closes it on Escape", async () => {
    const user = userEvent.setup();
    renderPage();

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

    // The drawings sub-section renders…
    expect(await screen.findByText("رسومات عائشة")).toBeInTheDocument();
    // …while the empty groups are omitted entirely.
    expect(screen.queryByText("شهادات عائشة")).not.toBeInTheDocument();
    expect(screen.queryByText("ألبوم لحظات عائشة")).not.toBeInTheDocument();
    expect(screen.queryByText("تلاوات عائشة")).not.toBeInTheDocument();
  });

  it("renders nothing for the zone when media is null", async () => {
    // IDENTITY_ONLY has no `media` key at all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

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

    await screen.findByText("عائشة");
    expect(screen.queryByText(/صندوق ذكريات/)).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — dream roadmap", () => {
  it("marks the current step at education_stage and ends at the aspiration", async () => {
    // IDENTITY has no `dream` block, so the aspiration text appears only in
    // the roadmap's dream node (unique getByText).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue({ ...IDENTITY, education_stage: "preparatory" } as any);
    const { container } = renderPage();

    expect(await screen.findByText("خريطة الحلم")).toBeInTheDocument();
    // Dream node carries the aspiration.
    expect(screen.getByText("أن تصبح معلمة")).toBeInTheDocument();
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
    expect(screen.getByText("أن تصبح معلمة")).toBeInTheDocument();
    // No "you are here" step is marked.
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.queryByText("أنت هنا")).not.toBeInTheDocument();
  });
});

describe("DonorOrphanDetailPage — impact tree", () => {
  it("renders the tree and caption from since_you_began", async () => {
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

    expect(await screen.findByText("شجرة أثرك")).toBeInTheDocument();
    // Bond duration line + leaf/fruit caption pieces.
    expect(screen.getByText(/ثمرة رعايتك تنمو منذ/)).toBeInTheDocument();
    expect(screen.getByText(/14 ورقة/)).toBeInTheDocument();
    expect(screen.getByText(/2 ثمرة/)).toBeInTheDocument();
    // The metaphor SVG is voiced.
    expect(
      screen.getByRole("img", { name: "شجرة ترمز إلى أثر رعايتك، تنمو مع الوقت" }),
    ).toBeInTheDocument();
  });

  it("is omitted when since_you_began is absent", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByText("شجرة أثرك")).not.toBeInTheDocument();
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

    const section = await screen.findByRole("region", { name: "أطفال في انتظار كفيل" });

    // The current child (ORF-99) is filtered out; the next three remain.
    expect(within(section).queryByText("مستبعد")).not.toBeInTheDocument();
    expect(within(section).getByText("سارة")).toBeInTheDocument();
    expect(within(section).getByText("يوسف")).toBeInTheDocument();
    expect(within(section).getByText("ليلى")).toBeInTheDocument();

    // Each card is a real link to the public child page.
    const card = within(section).getByRole("link", { name: "تعرّف على سارة" });
    expect(card.getAttribute("href")).toBe("/orphans/P-1");

    // Closing CTA links to the public browse page.
    const cta = within(section).getByRole("link", { name: /اكفل طفلًا آخر/ });
    expect(cta.getAttribute("href")).toBe("/orphans");
  });

  it("omits the section when there are no available children", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileMock.mockResolvedValue(IDENTITY_ONLY as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    waitingMock.mockResolvedValue(page([]) as any);
    renderPage();

    await screen.findByText("عائشة");
    expect(screen.queryByText("أطفال في انتظار كفيل")).not.toBeInTheDocument();
  });
});
