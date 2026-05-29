import { Outlet } from "react-router-dom";

import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicNav } from "@/components/public/PublicNav";

/**
 * Chrome for the constrained public pages (W-01 landing, orphan browse,
 * signup). Shares the PublicNav + PublicFooter with the wider marketing
 * site (PublicSiteLayout) but keeps its <main> in a centered column,
 * since these pages are card/list layouts rather than full-bleed
 * marketing sections.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-snow-100 dark:bg-gray-900">
      <PublicNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
