/**
 * Client-side CSV export matching the 12-column `MonthlyRecord` schema.
 */

import { formatLoanMonthIso, parseYearMonth } from "./dates.js";

export const CSV_COLUMNS = Object.freeze([
  "month",
  "year",
  "phase",
  "starting_balance",
  "effective_apr",
  "prime_rate",
  "required_payment",
  "prepayment",
  "total_payment",
  "interest_paid",
  "principal_paid",
  "ending_balance",
]);

const FOUR_DECIMAL_COLS = new Set(["effective_apr", "prime_rate"]);
const INT_COLS = new Set(["month", "year"]);
const TEXT_COLS = new Set(["phase"]);

function escapeCsvCell(value) {
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert monthly trajectory records into an RFC 4180 CSV string.
 * Appends `calendar_month` (`YYYY-MM`) only when `startYearMonth` is provided.
 *
 * @param {Array<Record<string, unknown>>} records
 * @param {{ startYearMonth?: string | null }} [opts]
 * @returns {string}
 */
export function recordsToCsv(records, { startYearMonth = null } = {}) {
  const validStart = parseYearMonth(startYearMonth);
  const cols = validStart ? [...CSV_COLUMNS, "calendar_month"] : CSV_COLUMNS;
  const lines = [cols.join(",")];
  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    const row = cols.map((col) => {
      if (col === "calendar_month") {
        return formatLoanMonthIso(startYearMonth, Number(rec.month));
      }
      const val = rec[col];
      if (INT_COLS.has(col)) return String(Math.trunc(Number(val)));
      if (TEXT_COLS.has(col)) return escapeCsvCell(val);
      if (FOUR_DECIMAL_COLS.has(col)) return Number(val).toFixed(4);
      return Number(val).toFixed(2);
    });
    lines.push(row.join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * Trigger a browser download of a CSV string strictly client-side.
 *
 * @param {string} csvText
 * @param {string} [filename="heloc_amortization_schedule.csv"]
 */
export function triggerCsvDownload(csvText, filename = "heloc_amortization_schedule.csv") {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
