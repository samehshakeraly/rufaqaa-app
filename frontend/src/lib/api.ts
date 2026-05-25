import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

import { useAuthStore } from "@/store/auth";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

/**
 * On a 401 we try refreshing the access token exactly once.
 *
 * A single in-flight refresh is shared between concurrent failing requests,
 * so a burst of unauthorized calls only triggers one /auth/refresh round
 * trip. If refresh itself fails (or the request was already a retry, or
 * the failing call WAS the refresh) we clear the store and let the 401
 * bubble up — the ProtectedRoute will send the user to /login.
 */

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

let refreshing: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return null;
  try {
    const { data } = await axios.post<{ access_token: string; refresh_token: string }>(
      `${BASE_URL}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } },
    );
    useAuthStore.getState().setTokens(data.access_token, data.refresh_token);
    return data.access_token;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const cfg = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (
      status !== 401 ||
      !cfg ||
      cfg._retried ||
      cfg.url?.includes("/auth/refresh") ||
      cfg.url?.includes("/auth/login")
    ) {
      if (status === 401 && cfg?.url?.includes("/auth/refresh")) {
        useAuthStore.getState().clear();
      }
      return Promise.reject(error);
    }

    if (!refreshing) {
      refreshing = performRefresh().finally(() => {
        refreshing = null;
      });
    }
    const newToken = await refreshing;
    if (!newToken) return Promise.reject(error);

    cfg._retried = true;
    cfg.headers.set("Authorization", `Bearer ${newToken}`);
    return api.request(cfg);
  },
);
