import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Tab state persisted in the URL (`?tab=…`) so a tab is shareable and
 * back-button friendly. An absent or unknown param resolves to
 * `defaultTab` WITHOUT rewriting the URL.
 */
export function useUrlTab(
  tabIds: readonly string[],
  defaultTab: string,
): [string, (id: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const active = raw && tabIds.includes(raw) ? raw : defaultTab;

  const select = useCallback(
    (id: string) => {
      if (!tabIds.includes(id)) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("tab", id);
          return next;
        },
        // Each tab switch is a history entry, so the back button walks
        // the donor's path through the profile.
        { replace: false },
      );
    },
    [tabIds, setSearchParams],
  );

  return [active, select];
}
