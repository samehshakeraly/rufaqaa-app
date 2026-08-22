/** Minimal CSV parser. Handles RFC-4180-style quoting (double-quote
 * escapes a quote inside a quoted field), commas and newlines inside
 * quoted fields, and \r\n line endings.
 *
 * Not a full RFC implementation — no BOM stripping beyond the leading
 * 0xFEFF, no per-cell whitespace trimming. Good enough for donor
 * imports out of Excel/Numbers/Sheets. */
/** Serialize rows to RFC-4180 CSV. A cell is quoted only when it needs
 * to be (comma, quote or newline inside), quotes are doubled, lines end
 * with \r\n, and the result opens with a BOM so Excel detects UTF-8 —
 * the donor statement is full of Arabic text. */
export function buildCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined): string => {
    const s = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cell);
        cell = "";
      } else if (ch === "\n" || ch === "\r") {
        row.push(cell);
        cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else {
        cell += ch;
      }
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}
