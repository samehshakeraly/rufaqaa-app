import { api } from "./api";
import type { Page } from "./orphans";

export type ChannelType =
  | "digital_marketing"
  | "committee"
  | "website"
  | "branch"
  | "social_media"
  | "partnership"
  | "other";

export interface MarketingChannel {
  id: string;
  name_ar: string;
  name_en: string | null;
  channel_type: ChannelType | null;
  description: string | null;
  status: "active" | "suspended" | "archived";
  created_at: string;
}

export interface MarketingChannelCreateInput {
  name_ar: string;
  name_en?: string;
  channel_type?: ChannelType;
  description?: string;
}

export async function listMarketingChannels(
  includeInactive = false,
): Promise<Page<MarketingChannel>> {
  const { data } = await api.get<Page<MarketingChannel>>("/marketing-channels", {
    params: { limit: 100, include_inactive: includeInactive },
  });
  return data;
}

export async function createMarketingChannel(
  payload: MarketingChannelCreateInput,
): Promise<MarketingChannel> {
  const { data } = await api.post<MarketingChannel>("/marketing-channels", payload);
  return data;
}

export async function getMarketingChannel(id: string): Promise<MarketingChannel> {
  const { data } = await api.get<MarketingChannel>(`/marketing-channels/${id}`);
  return data;
}

export async function archiveMarketingChannel(id: string): Promise<void> {
  await api.delete(`/marketing-channels/${id}`);
}

/** Goal-vs-achieved snapshot for a channel's annual + monthly targets.
 * Mirrors the backend `ChannelProgress` schema. Money fields arrive as
 * strings (Decimal) so they render with tabular-nums without precision
 * loss; counts are plain numbers. */
export interface ChannelProgress {
  channel_id: string;
  goal_year: number;
  annual_goal_count: number | null;
  annual_goal_amount: string | null;
  goal_currency: string | null;
  achieved_count: number;
  achieved_amount: string;
  completion_percentage_count: number;
  completion_percentage_amount: number;
  monthly_goal_count: number | null;
  monthly_goal_amount: string | null;
  monthly_achieved_count: number;
  monthly_achieved_amount: string;
}

export async function fetchChannelProgress(id: string): Promise<ChannelProgress> {
  const { data } = await api.get<ChannelProgress>(
    `/marketing-channels/${id}/progress`,
  );
  return data;
}
