import { useEffect, useRef, useState } from "react";

import {
  chapterDomId,
  scrollToChapter,
  type ShellChapter,
  type ShellTab,
  tabDomId,
  tabPanelDomId,
} from "@/lib/profileShell";

/* ------------------------------------------------------------------ */
/* App-shell components for tabbed profile pages (donor profile v4):   */
/* an accessible tablist (roving tabindex + RTL-aware arrow keys) and  */
/* a sticky in-tab chapter-navigation bar with a scroll-spy active     */
/* state. IntersectionObserver is feature-detected so jsdom test runs  */
/* never crash — they just skip the observation niceties.              */
/* ------------------------------------------------------------------ */

/**
 * WAI-ARIA tablist: roving tabindex, selection-follows-focus arrow keys
 * (direction-aware so "next" always moves toward the reading direction),
 * Home/End, and visible focus rings from the global stylesheet.
 */
export function TabList({
  tabs,
  activeId,
  onSelect,
  label,
  rtl,
}: {
  tabs: ShellTab[];
  activeId: string;
  onSelect: (id: string) => void;
  label: string;
  rtl: boolean;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function moveTo(index: number) {
    const len = tabs.length;
    if (len === 0) return;
    const tab = tabs[(index + len) % len];
    if (!tab) return;
    onSelect(tab.id);
    buttonRefs.current[tab.id]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const idx = tabs.findIndex((tab) => tab.id === activeId);
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        moveTo(rtl ? idx - 1 : idx + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        moveTo(rtl ? idx + 1 : idx - 1);
        break;
      case "Home":
        e.preventDefault();
        moveTo(0);
        break;
      case "End":
        e.preventDefault();
        moveTo(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-2xl border border-sky-200 bg-white p-1.5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttonRefs.current[tab.id] = node;
            }}
            type="button"
            role="tab"
            id={tabDomId(tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelDomId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={onKeyDown}
            className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition ${
              selected
                ? "bg-trust-500 text-white shadow-sm"
                : "text-gray-600 hover:bg-tranquil-100 hover:text-trust-700 dark:text-gray-300 dark:hover:bg-gray-700"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sticky chapter-navigation bar for the active tab: one keyboard-focusable
 * chip per present section, active-state kept in sync with scroll via
 * IntersectionObserver (skipped gracefully where unavailable).
 */
export function ChapterNav({ chapters, label }: { chapters: ShellChapter[]; label: string }) {
  const [activeId, setActiveId] = useState<string | null>(chapters[0]?.id ?? null);
  const chapterKey = chapters.map((c) => c.id).join(",");

  useEffect(() => {
    setActiveId(chapters[0]?.id ?? null);
    if (typeof IntersectionObserver === "undefined") return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // The first chapter (in declared order) currently in the reading
        // band wins, so the active chip follows the scroll position.
        for (const c of chapters) {
          if (visible.has(chapterDomId(c.id))) {
            setActiveId(c.id);
            return;
          }
        }
      },
      // A band across the upper third of the viewport reads as "what the
      // donor is looking at" without flickering between sections.
      { rootMargin: "-10% 0px -65% 0px" },
    );

    for (const c of chapters) {
      const el = document.getElementById(chapterDomId(c.id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterKey]);

  if (chapters.length < 2) return null;

  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-20 -my-1 bg-snow/95 py-2 backdrop-blur dark:bg-gray-900/95"
    >
      <ul className="flex gap-1.5 overflow-x-auto rounded-xl border border-sky-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-800">
        {chapters.map((c) => {
          const current = c.id === activeId;
          return (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  setActiveId(c.id);
                  scrollToChapter(c.id);
                }}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  current
                    ? "bg-tranquil-200 text-trust-800 dark:bg-trust-500/25 dark:text-tranquil-100"
                    : "text-gray-500 hover:bg-tranquil-100 hover:text-trust-700 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
              >
                {c.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
