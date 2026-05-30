import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { LoginPage } from "@/pages/LoginPage";

function renderWithProviders(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  it("renders the login form using the active language", async () => {
    await i18n.changeLanguage("ar");
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole("heading", { name: "رفقاء" })).toBeInTheDocument();
    expect(screen.getByLabelText("البريد الإلكتروني")).toBeInTheDocument();
    expect(screen.getByLabelText("كلمة المرور")).toBeInTheDocument();
  });

  it("translates the form to English on switch", async () => {
    await i18n.changeLanguage("en");
    renderWithProviders(<LoginPage />);
    expect(screen.getByRole("heading", { name: "Rufaqaa" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("shows validation errors for short password", async () => {
    await i18n.changeLanguage("ar");
    const user = userEvent.setup();
    renderWithProviders(<LoginPage />);

    await user.clear(screen.getByLabelText("البريد الإلكتروني"));
    await user.type(screen.getByLabelText("البريد الإلكتروني"), "admin@example.com");
    await user.type(screen.getByLabelText("كلمة المرور"), "short");
    await user.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    expect(
      await screen.findByText("كلمة المرور يجب أن تكون 8 أحرف على الأقل"),
    ).toBeInTheDocument();
  });
});
