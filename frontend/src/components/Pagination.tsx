import { useTranslation } from "react-i18next";

interface Props {
  total: number;
  limit: number;
  offset: number;
  onOffsetChange: (next: number) => void;
}

export function Pagination({ total, limit, offset, onOffsetChange }: Props) {
  const { t } = useTranslation();
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  if (total <= limit) return null;

  return (
    <div className="flex items-center justify-between text-sm text-slate-600">
      <span>
        {t("pagination.page", { page, total: totalPages })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-sky px-3 py-1 disabled:opacity-50"
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
          disabled={!canPrev}
        >
          {t("pagination.prev")}
        </button>
        <button
          type="button"
          className="rounded-lg border border-sky px-3 py-1 disabled:opacity-50"
          onClick={() => onOffsetChange(offset + limit)}
          disabled={!canNext}
        >
          {t("pagination.next")}
        </button>
      </div>
    </div>
  );
}
