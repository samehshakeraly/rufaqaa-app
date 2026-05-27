import type { Meta, StoryObj } from "@storybook/react";

import { SponsorshipsDonut } from "./SponsorshipsDonut";

const meta: Meta<typeof SponsorshipsDonut> = {
  title: "Charts/SponsorshipsDonut",
  component: SponsorshipsDonut,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof SponsorshipsDonut>;

export const TypicalMix: Story = {
  args: {
    data: {
      slices: [
        { status: "active", count: 42 },
        { status: "overdue", count: 7 },
        { status: "paused", count: 3 },
        { status: "completed", count: 11 },
      ],
    },
  },
};

export const Empty: Story = {
  args: { data: { slices: [] } },
};

export const HeavilyOverdue: Story = {
  args: {
    data: {
      slices: [
        { status: "active", count: 10 },
        { status: "overdue", count: 25 },
      ],
    },
  },
};
