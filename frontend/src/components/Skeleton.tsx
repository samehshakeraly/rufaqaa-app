/** Tailwind-only skeleton placeholders. Pulse + shimmer come from the
 * `animate-pulse` utility — no extra CSS needed. */

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200/70 dark:bg-slate-700/40 ${className}`}
    />
  );
}

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
}

export function TableSkeleton({ rows = 6, columns = 4 }: TableSkeletonProps) {
  return (
    <div className="card overflow-hidden p-0" role="status" aria-label="Loading">
      <div className="border-b border-sky bg-tranquil/40 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      <ul className="divide-y divide-sky/40">
        {Array.from({ length: rows }).map((_, r) => (
          <li key={r} className="flex gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((__, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface StatGridSkeletonProps {
  cards?: number;
}

export function StatGridSkeleton({ cards = 4 }: StatGridSkeletonProps) {
  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="card space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}
