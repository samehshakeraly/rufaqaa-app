import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LoginPage } from "@/pages/LoginPage";

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("renders the Arabic login form", () => {
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole("heading", { name: "رفقاء" })).toBeInTheDocument();
    expect(screen.getByLabelText("البريد الإلكتروني")).toBeInTheDocument();
    expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "دخول" })).toBeInTheDocument();
  });

  it("shows validation errors for short password", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.clear(screen.getByLabelText("البريد الإلكتروني"));
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "admin@example.com");
    await user.type(screen.getByLabelText("كلمة المرور"), "short");
    await user.click(screen.getByRole("button", { name: "دخول" }));

    expect(
      await screen.findByText("كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
    ).toBeInTheDocument();
  });
});
