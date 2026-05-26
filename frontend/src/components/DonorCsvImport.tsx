import { AxiosError } from "axios";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { parseCsv } from "@/lib/csv";
import { createDonor, type DonorCreateInput } from "@/lib/donors";

const FIELD_ALIASES: Record<string, keyof DonorCreateInput> = {
  full_name: "full_name",
  name: "full_name",
  email: "email",
  phone: "phone",
  mobile: "phone",
  country: "country_of_residence",
  country_of_residence: "country_of_residence",
  currency: "preferred_currency",
  preferred_currency: "preferred_currency",
};

interface ParsedRow {
  rowIndex: number;
  donor: DonorCreateInput | null;
  error: string | null;
}

interface ImportResult {
  rowIndex: number;
  status: "ok" | "fail";
  message: string;
}

function rowsToDonors(rows: string[][]): {
  parsed: ParsedRow[];
  headerMap: Array<keyof DonorCreateInput | null>;
} {
  if (rows.length === 0) return { parsed: [], headerMap: [] };
  const headerRow = rows[0] ?? [];
  const header = headerRow.map((h) => h.trim().toLowerCase());
  const headerMap: Array<keyof DonorCreateInput | null> = header.map(
    (h) => FIELD_ALIASES[h] ?? null,
  );
  const parsed: ParsedRow[] = rows.slice(1).map((cells, idx) => {
    const rowIndex = idx + 2; // 1-based, accounting for header
    const donor: Partial<DonorCreateInput> = {};
    headerMap.forEach((field, colIdx) => {
      if (!field) return;
      const raw = (cells[colIdx] ?? "").trim();
      if (raw === "") return;
      (donor as Record<string, string>)[field] = raw;
    });
    if (!donor.full_name) {
      return { rowIndex, donor: null, error: "missing full_name" };
    }
    if (!donor.email) {
      return { rowIndex, donor: null, error: "missing email" };
    }
    if (donor.country_of_residence && donor.country_of_residence.length !== 2) {
      return { rowIndex, donor: null, error: "country must be 2-letter code" };
    }
    if (donor.preferred_currency && donor.preferred_currency.length !== 3) {
      return { rowIndex, donor: null, error: "currency must be 3-letter code" };
    }
    return { rowIndex, donor: donor as DonorCreateInput, error: null };
  });
  return { parsed, headerMap };
}

interface Props {
  onImported: () => void | Promise<void>;
}

export function DonorCsvImport({ onImported }: Props) {
  const { t } = useTranslation();
  const [rawText, setRawText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  const { parsed, headerMap } = useMemo(() => {
    if (!rawText) return { parsed: [], headerMap: [] };
    return rowsToDonors(parseCsv(rawText));
  }, [rawText]);

  const validRows = parsed.filter((r) => r.donor !== null);
  const invalidRows = parsed.filter((r) => r.donor === null);
  const hasRecognizedColumn = headerMap.some((c) => c !== null);

  async function handleFile(file: File) {
    setResults(null);
    const text = await file.text();
    setRawText(text);
  }

  async function runImport() {
    setImporting(true);
    setResults(null);
    const out: ImportResult[] = [];
    for (const row of parsed) {
      if (!row.donor) {
        out.push({ rowIndex: row.rowIndex, status: "fail", message: row.error ?? "invalid" });
        continue;
      }
      try {
        await createDonor(row.donor);
        out.push({ rowIndex: row.rowIndex, status: "ok", message: row.donor.email });
      } catch (err) {
        let msg = "unknown error";
        if (err instanceof AxiosError) {
          msg = err.response?.data?.detail ?? err.message;
        } else if (err instanceof Error) {
          msg = err.message;
        }
        out.push({ rowIndex: row.rowIndex, status: "fail", message: String(msg) });
      }
      setResults([...out]);
    }
    setImporting(false);
    await onImported();
  }

  return (
    <div className="card space-y-4">
      <h2 className="text-lg font-semibold">{t("donors.csvImport.title")}</h2>
      <p className="text-sm text-slate-600">
        {t("donors.csvImport.help")}
      </p>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">
          {t("donors.csvImport.file")}
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          className="block w-full text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>

      {rawText && parsed.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("donors.csvImport.empty")}
        </p>
      )}

      {rawText && parsed.length > 0 && !hasRecognizedColumn && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("donors.csvImport.noColumns")}
        </p>
      )}

      {parsed.length > 0 && hasRecognizedColumn && (
        <>
          <p className="text-sm text-slate-700">
            {t("donors.csvImport.summary", {
              valid: validRows.length,
              invalid: invalidRows.length,
            })}
          </p>

          {invalidRows.length > 0 && (
            <details className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-amber-900">
                {t("donors.csvImport.invalidDetails", { count: invalidRows.length })}
              </summary>
              <ul className="mt-2 list-disc ps-5 text-amber-900">
                {invalidRows.slice(0, 20).map((r) => (
                  <li key={r.rowIndex}>
                    Row {r.rowIndex}: {r.error}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            className="btn-primary"
            disabled={importing || validRows.length === 0}
            onClick={runImport}
          >
            {importing
              ? t("donors.csvImport.importing", {
                  done: results?.length ?? 0,
                  total: parsed.length,
                })
              : t("donors.csvImport.run", { n: validRows.length })}
          </button>
        </>
      )}

      {results && !importing && (
        <div className="rounded-lg border border-sky bg-snow px-3 py-2 text-sm">
          <p className="font-medium">
            {t("donors.csvImport.done", {
              ok: results.filter((r) => r.status === "ok").length,
              fail: results.filter((r) => r.status === "fail").length,
            })}
          </p>
          {results.filter((r) => r.status === "fail").length > 0 && (
            <ul className="mt-2 list-disc ps-5 text-red-700">
              {results
                .filter((r) => r.status === "fail")
                .slice(0, 20)
                .map((r) => (
                  <li key={r.rowIndex}>
                    Row {r.rowIndex}: {r.message}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
