import { api } from "./api";

export interface TwoFAEnrollResponse {
  secret: string;
  otpauth_uri: string;
}

export interface BackupCodesResponse {
  backup_codes: string[];
}

export async function enroll2FA(): Promise<TwoFAEnrollResponse> {
  const { data } = await api.post<TwoFAEnrollResponse>("/auth/2fa/enroll");
  return data;
}

export async function verify2FA(code: string): Promise<BackupCodesResponse> {
  const { data } = await api.post<BackupCodesResponse>("/auth/2fa/verify", { code });
  return data;
}

export async function disable2FA(code: string): Promise<void> {
  await api.post("/auth/2fa/disable", { code });
}
