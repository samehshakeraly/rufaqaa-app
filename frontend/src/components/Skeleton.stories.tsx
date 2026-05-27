import type { Meta, StoryObj } from "@storybook/react";

import { Skeleton, StatGridSkeleton, TableSkeleton } from "./Skeleton";

const meta: Meta<typeof Skeleton> = {
  title: "Components/Skeleton",
  component: Skeleton,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Block: Story = {
  args: { className: "h-6 w-48" },
};

export const Table: StoryObj<typeof TableSkeleton> = {
  render: (args) => <TableSkeleton {...args} />,
  args: { rows: 5, columns: 4 },
};

export const StatGrid: StoryObj<typeof StatGridSkeleton> = {
  render: (args) => <StatGridSkeleton {...args} />,
  args: { cards: 4 },
};
