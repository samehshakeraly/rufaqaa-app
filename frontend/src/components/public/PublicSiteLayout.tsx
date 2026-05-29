import { Outlet } from "react-router-dom";

import { PublicFooter } from "./PublicFooter";
import { PublicNav } from "./PublicNav";

/**
 * Full-bleed shell for the public marketing pages (W-02..W-06). Unlike
 * PublicLayout (which constrains its <main> to a centered column for
 * the browse/auth pages), marketing pages render their own full-width
 * sections with internal containers, so <main> here is unconstrained.
 * No auth, no AppLayout/DonorLayout — public shell only.
 */
export function PublicSiteLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-snow-100 dark:bg-gray-900">
      <PublicNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <PublicFooter />
    </div>
  );
}
