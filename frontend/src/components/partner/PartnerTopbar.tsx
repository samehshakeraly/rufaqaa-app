import type { ReactNode } from "react";

/**
 * Sticky topbar shared by every partner-portal page. Renders the single
 * semantic `<h1>` for the page (visually styled as the mockup's `h2`)
 * plus an optional manager-permission badge, subtitle, and action slot.
 * Keeping the one h1 here guarantees the a11y "one h1 per page" rule
 * across PM-01..PM-04.
 */
export function PartnerTopbar({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  badge?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="pm-topbar">
      <div className="pm-topbar-title">
        <h1>
          {title}
          {badge ? <span className="pm-mgr-badge">{badge}</span> : null}
        </h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="pm-topbar-actions">{actions}</div> : null}
    </header>
  );
}
