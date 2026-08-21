import { Skeleton } from "@/components/Skeleton";

/** Loading placeholder shaped like a real OrphanCard — 52px avatar, two
 * header lines, a relationship box, the money lines, and the actions row
 * — so the page doesn't "jump" when data lands. */
export function OrphanCardSkeleton() {
  return (
    <div className="card flex h-full flex-col gap-3 p-5" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 w-11 rounded-xl" />
        <Skeleton className="h-11 w-11 rounded-xl" />
      </div>
    </div>
  );
}
