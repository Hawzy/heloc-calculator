/**
 * Location-agnostic Year-Month calendar arithmetic without timezone drift.
 * Uses Temporal.PlainYearMonth when available, with exact integer arithmetic fallback.
 */

const MONTH_SHORT = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

const YEAR_MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Parse `"YYYY-MM"` strictly into `{ year, month }` or return `null`.
 *
 * @param {unknown} raw
 * @returns {{ year: number, month: number } | null}
 */
export function parseYearMonth(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const match = YEAR_MONTH_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Format `{ year, month }` as `"YYYY-MM"`.
 *
 * @param {{ year: number, month: number } | null} ym
 * @returns {string}
 */
export function formatIsoYearMonth(ym) {
  if (!ym) return "";
  return `${String(ym.year).padStart(4, "0")}-${String(ym.month).padStart(2, "0")}`;
}

/**
 * Shift a `{ year, month }` pair forward by `offsetMonths` without timezone conversion.
 *
 * @param {{ year: number, month: number }} ym
 * @param {number} offsetMonths
 * @returns {{ year: number, month: number }}
 */
export function addMonthsToYearMonth(ym, offsetMonths) {
  if (typeof globalThis.Temporal?.PlainYearMonth?.from === "function") {
    const plain = globalThis.Temporal.PlainYearMonth.from({
      year: ym.year,
      month: ym.month,
      calendar: "iso8601",
    });
    const shifted =
      offsetMonths >= 0
        ? plain.add({ months: offsetMonths })
        : plain.subtract({ months: Math.abs(offsetMonths) });
    return { year: shifted.year, month: shifted.month };
  }

  const totalZeroBased = ym.year * 12 + (ym.month - 1) + Math.trunc(offsetMonths);
  const year = Math.floor(totalZeroBased / 12);
  const month = (((totalZeroBased % 12) + 12) % 12) + 1;
  return { year, month };
}

/**
 * Format `{ year, month }` as `"Nov 2026"`.
 *
 * @param {{ year: number, month: number }} ym
 * @returns {string}
 */
export function formatYearMonthLabel(ym) {
  return `${MONTH_SHORT[ym.month - 1]} ${ym.year}`;
}

/**
 * Format a 1-based simulation month as a calendar date label when `startYearMonth` is set.
 *
 * @param {string | null | undefined} startYearMonth
 * @param {number} loanMonth
 * @returns {string | null}
 */
export function formatLoanMonthDate(startYearMonth, loanMonth) {
  const start = parseYearMonth(startYearMonth);
  if (!start || !Number.isInteger(loanMonth) || loanMonth < 1) return null;
  return formatYearMonthLabel(addMonthsToYearMonth(start, loanMonth - 1));
}

/**
 * Format `"YYYY-MM"` string for a 1-based simulation month (used in CSV export).
 *
 * @param {string | null | undefined} startYearMonth
 * @param {number} loanMonth
 * @returns {string}
 */
export function formatLoanMonthIso(startYearMonth, loanMonth) {
  const start = parseYearMonth(startYearMonth);
  if (!start || !Number.isInteger(loanMonth) || loanMonth < 1) return "";
  return formatIsoYearMonth(addMonthsToYearMonth(start, loanMonth - 1));
}

/**
 * Format an annual date span (e.g. `"Nov 2026–Oct 2027"`) from 1-based first/last months.
 *
 * @param {string | null | undefined} startYearMonth
 * @param {number} firstMonth
 * @param {number} lastMonth
 * @returns {string | null}
 */
export function formatLoanYearSpan(startYearMonth, firstMonth, lastMonth) {
  const start = parseYearMonth(startYearMonth);
  if (!start) return null;
  const firstStr = formatYearMonthLabel(addMonthsToYearMonth(start, firstMonth - 1));
  if (lastMonth <= firstMonth) return firstStr;
  const lastStr = formatYearMonthLabel(addMonthsToYearMonth(start, lastMonth - 1));
  return `${firstStr}–${lastStr}`;
}
