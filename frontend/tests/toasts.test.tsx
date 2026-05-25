import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastViewport } from "@/components/ToastViewport";
import { toast, useToastStore } from "@/store/toasts";

afterEach(() => {
  // Drain anything left over so tests don't leak state.
  useToastStore.setState({ items: [] });
  vi.useRealTimers();
});

describe("toasts", () => {
  it("renders pushed toasts and dismisses on click", async () => {
    render(<ToastViewport />);
    act(() => toast.success("done"));
    expect(await screen.findByText("done")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("dismiss"));
    expect(screen.queryByText("done")).not.toBeInTheDocument();
  });

  it("auto-dismisses after the TTL", () => {
    vi.useFakeTimers();
    render(<ToastViewport />);
    act(() => toast.info("hello"));
    expect(screen.getByText("hello")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("hello")).not.toBeInTheDocument();
  });
});
