import { useTranslation } from "react-i18next";

import { Skeleton } from "@/components/Skeleton";

/** PR-D01 — a skeleton shaped like the real dashboard (impact strip,
 * three feed rows, side cards), never a single gray box. */
export function DashboardSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className="space-y-6"
    >
      <Skeleton className="h-16 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card space-y-4 p-5 lg:col-span-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-6">
          <div className="card space-y-3 p-5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="card space-y-3 p-5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
