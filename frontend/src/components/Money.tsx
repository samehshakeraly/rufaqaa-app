import { useTranslation } from "react-i18next";

interface MoneyProps {
  /** Decimal amount as a string (preferred — no float precision loss)
   * or a number. */
  amount: string | number | null | undefined;
  /** ISO-4217 currency code, always rendered alongside the figure. */
  currency: string | null | undefined;
  className?: string;
}

/**
 * Renders a money figure with `tabular-nums` (so columns of numbers
 * align) and the currency code appended. Locale-aware grouping uses the
 * active language. Amounts arrive as strings to preserve Decimal
 * precision; we only coerce to Number for display formatting.
 */
export function Money({ amount, currency, className = "" }: MoneyProps) {
  const { i18n } = useTranslation();
  const n = amount == null ? null : Number(amount);
  const text =
    n == null || Number.isNaN(n)
      ? "—"
      : n.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className={`tabular-nums ${className}`}>
      {text}
      {currency ? <span className="ms-1 text-xs text-gray-500">{currency}</span> : null}
    </span>
  );
}
