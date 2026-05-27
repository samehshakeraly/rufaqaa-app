import type { Meta, StoryObj } from "@storybook/react";

import { PartnerDonationsBar } from "./PartnerDonationsBar";

const meta: Meta<typeof PartnerDonationsBar> = {
  title: "Charts/PartnerDonationsBar",
  component: PartnerDonationsBar,
  tags: ["autodocs"],
};
export default meta;
type Story = StoryObj<typeof PartnerDonationsBar>;

export const TopPartners: Story = {
  args: {
    data: {
      window_days: 90,
      items: [
        {
          partner_id: "00000000-0000-0000-0000-000000000001",
          partner_code: "PTN-AAAA",
          partner_name: "شركة الخير",
          payments_total: "12500.00",
          payments_count: 41,
        },
        {
          partner_id: "00000000-0000-0000-0000-000000000002",
          partner_code: "PTN-BBBB",
          partner_name: "جمعية الإيمان",
          payments_total: "8200.00",
          payments_count: 27,
        },
        {
          partner_id: "00000000-0000-0000-0000-000000000003",
          partner_code: "PTN-CCCC",
          partner_name: "مؤسسة النور",
          payments_total: "1300.00",
          payments_count: 5,
        },
      ],
    },
  },
};

export const Empty: Story = {
  args: { data: { window_days: 90, items: [] } },
};
