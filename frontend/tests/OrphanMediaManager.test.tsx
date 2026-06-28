import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrphanMediaManager } from "@/components/OrphanMediaManager";
import i18n from "@/i18n";

// Mock the data lib's network helpers; the pure helpers (sponsorVisibility,
// needsConsent, UPLOAD_CATEGORIES) stay real so the component encodes the
// canonical domain rules.
vi.mock("@/lib/orphanMedia", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orphanMedia")>();
  return {
    ...actual,
    listOrphanMedia: vi.fn(),
    uploadOrphanMedia: vi.fn(),
    updateMedia: vi.fn(),
    moderateMedia: vi.fn(),
  };
});

import {
  listOrphanMedia,
  moderateMedia,
  updateMedia,
  uploadOrphanMedia,
  type MediaManageRead,
} from "@/lib/orphanMedia";

const listMock = vi.mocked(listOrphanMedia);
const uploadMock = vi.mocked(uploadOrphanMedia);
const updateMock = vi.mocked(updateMedia);
const moderateMock = vi.mocked(moderateMedia);

const ORPHAN_ID = "11111111-1111-1111-1111-111111111111";

function makeItem(over: Partial<MediaManageRead> = {}): MediaManageRead {
  return {
    id: "media-1",
    category: "drawing",
    title: "A sunny house",
    description: "Crayon drawing",
    display_date: "2026-01-10",
    url: "https://example.test/media-1.png",
    thumbnail_url: null,
    moderation_status: "pending",
    visibility: "private",
    has_guardian_consent: false,
    media_type: "image",
    orphan_id: ORPHAN_ID,
    created_at: "2026-01-10T00:00:00Z",
    duration_seconds: null,
    file_size_bytes: 1234,
    height: null,
    width: null,
    ...over,
  };
}

function renderManager() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <OrphanMediaManager orphanId={ORPHAN_ID} />
      </I18nextProvider>
    </QueryClientProvider>
  );
  return render(ui);
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  listMock.mockReset();
  uploadMock.mockReset();
  updateMock.mockReset();
  moderateMock.mockReset();
});

describe("OrphanMediaManager — list", () => {
  it("renders each item with its moderation-status badge and a sponsor-visibility line", async () => {
    listMock.mockResolvedValue([
      makeItem(),
      makeItem({
        id: "media-2",
        title: "Award",
        category: "certificate",
        moderation_status: "approved",
        visibility: "donor_only",
      }),
    ]);
    renderManager();

    expect(await screen.findByText("A sunny house")).toBeInTheDocument();
    // Pending item: status badge + a "hidden — reason" line.
    expect(screen.getByText("Awaiting review")).toBeInTheDocument();
    expect(screen.getByText(/Hidden from sponsor/)).toBeInTheDocument();
    // Approved + donor_only certificate (no consent gate): visible to sponsor.
    expect(screen.getByText("Visible to sponsor")).toBeInTheDocument();
  });

  it("shows the empty state when there is no media", async () => {
    listMock.mockResolvedValue([]);
    renderManager();
    expect(await screen.findByText(/No media yet/)).toBeInTheDocument();
  });
});

describe("OrphanMediaManager — upload", () => {
  it("submits multipart input including the category and refetches the list", async () => {
    listMock.mockResolvedValue([]);
    uploadMock.mockResolvedValue(makeItem());
    const user = userEvent.setup();
    renderManager();
    await screen.findByText(/No media yet/);

    await user.selectOptions(screen.getByRole("combobox", { name: /Category/ }), "drawing");
    const file = new File(["x"], "art.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await user.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1));
    const [orphanId, payload] = uploadMock.mock.calls[0]!;
    expect(orphanId).toBe(ORPHAN_ID);
    expect(payload.category).toBe("drawing");
    expect(payload.file).toBe(file);
    // List is refetched (initial load + post-upload invalidation).
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("surfaces a 415 unsupported-type error from the server", async () => {
    listMock.mockResolvedValue([]);
    const err = new AxiosError("unsupported");
    // @ts-expect-error minimal response shape for the test
    err.response = { status: 415 };
    uploadMock.mockRejectedValue(err);
    const user = userEvent.setup();
    renderManager();
    await screen.findByText(/No media yet/);

    await user.selectOptions(screen.getByRole("combobox", { name: /Category/ }), "recitation");
    const file = new File(["x"], "art.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(await screen.findByText(/isn't supported for this category/)).toBeInTheDocument();
  });
});

describe("OrphanMediaManager — per-item actions", () => {
  it("'Show to sponsor' moderates with decision 'approve'", async () => {
    listMock.mockResolvedValue([makeItem()]);
    moderateMock.mockResolvedValue(
      makeItem({ moderation_status: "approved", visibility: "donor_only" }),
    );
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("A sunny house");

    await user.click(screen.getByRole("button", { name: "Show to sponsor" }));

    await waitFor(() => expect(moderateMock).toHaveBeenCalledWith("media-1", "approve"));
  });

  it("'Hide' PATCHes visibility to 'archived'", async () => {
    listMock.mockResolvedValue([
      makeItem({ moderation_status: "approved", visibility: "donor_only" }),
    ]);
    updateMock.mockResolvedValue(makeItem({ visibility: "archived" }));
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("A sunny house");

    await user.click(screen.getByRole("button", { name: "Hide" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("media-1", { visibility: "archived" }),
    );
  });

  it("the consent toggle PATCHes has_guardian_consent", async () => {
    listMock.mockResolvedValue([makeItem({ category: "recitation", media_type: "audio" })]);
    updateMock.mockResolvedValue(makeItem({ has_guardian_consent: true }));
    const user = userEvent.setup();
    renderManager();
    await screen.findByText("A sunny house");

    await user.click(screen.getByRole("button", { name: "Turn on guardian consent" }));

    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("media-1", { has_guardian_consent: true }),
    );
  });
});
