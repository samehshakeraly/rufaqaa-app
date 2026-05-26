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

export async function archiveMarketingChannel(id: string): Promise<void> {
  await api.delete(`/marketing-channels/${id}`);
}
