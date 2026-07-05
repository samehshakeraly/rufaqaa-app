/* Shared helpers for the tabbed profile app-shell (donor profile v4).
 *
 * Everything feature-detects browser APIs (matchMedia, scrollIntoView) so
 * jsdom test runs never crash — they just skip the motion niceties. */

export interface ShellTab {
  id: string;
  label: string;
}

export interface ShellChapter {
  id: string;
  label: string;
}

/** DOM id of a tab button, mirrored by the panel's aria-labelledby. */
export function tabDomId(id: string): string {
  return `tab-${id}`;
}

/** DOM id of the active tabpanel. */
export function tabPanelDomId(id: string): string {
  return `tabpanel-${id}`;
}

/** DOM id of a chapter anchor inside the active tab. */
export function chapterDomId(id: string): string {
  return `chapter-${id}`;
}

/** True when the user asked the OS for reduced motion. Never throws in
 * environments without matchMedia (jsdom). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Scroll a chapter anchor into view, honoring prefers-reduced-motion.
 * Safe no-op where scrollIntoView is unavailable (jsdom). */
export function scrollToChapter(id: string): void {
  const el = document.getElementById(chapterDomId(id));
  if (!el || typeof el.scrollIntoView !== "function") return;
  try {
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  } catch {
    /* jsdom implements the method but not scrolling — ignore. */
  }
}
