import { api } from "./api";

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  weekly_digest: boolean;
  marketing: boolean;
}

export interface CurrentUser {
  id: string;
  email: string;
  organization_id: string;
  /** The جهة this user is scoped to (partner_manager / partner_staff); null otherwise. */
  partner_organization_id: string | null;
  role: string;
  first_name: string;
  last_name: string;
  email_verified_at: string | null;
  notification_preferences: NotificationPreferences;
}

export async function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<NotificationPreferences> {
  const { data } = await api.patch<NotificationPreferences>(
    "/auth/me/notifications",
    patch,
  );
  return data;
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const { data } = await api.post<TokenPair>("/auth/login", { email, password });
  return data;
}

export async function fetchMe(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>("/auth/me");
  return data;
}

export interface ForgotPasswordResponse {
  sent: boolean;
  debug_token: string | null;
}

export async function requestPasswordReset(
  email: string,
): Promise<ForgotPasswordResponse> {
  const { data } = await api.post<ForgotPasswordResponse>(
    "/auth/forgot-password",
    { email },
  );
  return data;
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post("/auth/reset-password", {
    token,
    new_password: newPassword,
  });
}
