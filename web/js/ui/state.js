/**
 * Scenario defaults, built-in benchmark presets, custom rate parsing, and URL query state.
 */

import {
  BalanceMethod,
  DrawPaymentMode,
  RateScenarioType,
  YearBasis,
  validateConfig,
} from "../engine/index.js";
import { formatIsoYearMonth, parseYearMonth } from "./dates.js";

export const DEFAULT_SCENARIO = Object.freeze({
  initial_principal: 50000,
  credit_limit: 350000,
  prime_rate: 7.0,
  margin: 0.24,
  intro_apr: 4.49,
  intro_duration_months: 6,
  draw_period_months: 120,
  repayment_period_months: 240,
  lifetime_rate_cap: 18.0,
  regulatory_ceiling: 25.0,
  monthly_prepayment: 0,
  balance_method: BalanceMethod.AVERAGE_DAILY_BALANCE,
  year_basis: YearBasis.DAYS_365,
  rate_scenario: RateScenarioType.FLAT,
  annual_rate_step: 0.5,
  custom_rates: null,
  custom_rates_mode: "annual",
  draw_payment_mode: DrawPaymentMode.INTEREST_ONLY,
  draw_min_payment_pct: 1.0,
  draw_min_payment_floor: 0,
  cash_flow_events: [],
  closing_costs: 0,
  annual_fee: 0,
  early_closure_fee: 0,
  early_closure_months: 36,
  start_year_month: null,
  heloan_enabled: false,
  heloan_apr: 7.5,
  heloan_term_years: 15,
  heloan_closing_costs: 0,
});

export const BUILTIN_PRESETS = Object.freeze([
  {
    id: "default_terms",
    label: "Default Terms",
    description: "$50k drawn / $350k limit, 4.49% 6-mo intro, 7.00% Prime + 0.24% margin (7.24% variable)",
    params: { ...DEFAULT_SCENARIO },
  },
  {
    id: "blueprint_rising",
    label: "Blueprint Rising",
    description: "$50k drawn / $100k limit, 0.99% 12-mo intro, Prime 6% + 2% (+0.5%/yr), +$300/mo prepay",
    params: {
      ...DEFAULT_SCENARIO,
      credit_limit: 100000,
      prime_rate: 6.0,
      margin: 2.0,
      intro_apr: 0.99,
      intro_duration_months: 12,
      rate_scenario: RateScenarioType.RISING,
      annual_rate_step: 0.5,
      monthly_prepayment: 300,
    },
  },
  {
    id: "flat_baseline",
    label: "Flat Baseline",
    description: "$50k drawn / $100k limit, flat 7.0% Prime + 2% margin, $0 extra prepayment",
    params: {
      ...DEFAULT_SCENARIO,
      credit_limit: 100000,
      prime_rate: 7.0,
      margin: 2.0,
      intro_apr: null,
      intro_duration_months: 12,
      rate_scenario: RateScenarioType.FLAT,
      monthly_prepayment: 0,
    },
  },
  {
    id: "stress_test_15yr",
    label: "Stress Test 15yr",
    description: "$60k drawn, 5yr draw / 10yr repay, rapid +0.75% per 6-mo Prime surge",
    params: {
      ...DEFAULT_SCENARIO,
      initial_principal: 60000,
      credit_limit: 120000,
      prime_rate: 6.5,
      margin: 2.5,
      intro_apr: null,
      intro_duration_months: 12,
      draw_period_months: 60,
      repayment_period_months: 120,
      rate_scenario: RateScenarioType.STRESS_TEST,
      monthly_prepayment: 0,
    },
  },
  {
    id: "wa_usury_cap",
    label: "WA 25% Usury Cap",
    description: "$20k drawn, 25% Prime + 3% margin clamped to WA CLA 25.0% ceiling",
    params: {
      ...DEFAULT_SCENARIO,
      initial_principal: 20000,
      credit_limit: 50000,
      prime_rate: 25.0,
      margin: 3.0,
      intro_apr: null,
      intro_duration_months: 12,
      draw_period_months: 12,
      repayment_period_months: 12,
      lifetime_rate_cap: 30.0,
      regulatory_ceiling: 25.0,
      rate_scenario: RateScenarioType.FLAT,
      monthly_prepayment: 0,
    },
  },
  {
    id: "early_draw_payoff",
    label: "Early Draw Payoff",
    description: "$10k drawn, $2,000/mo prepay retiring debt in 5 months during draw",
    params: {
      ...DEFAULT_SCENARIO,
      initial_principal: 10000,
      credit_limit: 50000,
      prime_rate: 7.0,
      margin: 2.0,
      intro_apr: 0.99,
      intro_duration_months: 12,
      rate_scenario: RateScenarioType.FLAT,
      monthly_prepayment: 2000,
    },
  },
  {
    id: "staged_reno",
    label: "Staged Reno + Bonus",
    description: "$30k initial draw, +$15k Kitchen Reno (Mo 14), -$8k Bonus (Mo 24), +$200/mo prepay",
    params: {
      ...DEFAULT_SCENARIO,
      initial_principal: 30000,
      credit_limit: 100000,
      prime_rate: 6.5,
      margin: 2.0,
      intro_apr: null,
      intro_duration_months: 12,
      draw_period_months: 60,
      repayment_period_months: 120,
      rate_scenario: RateScenarioType.RISING,
      annual_rate_step: 0.5,
      monthly_prepayment: 200,
      cash_flow_events: [
        { month: 14, amount: 15000, event_type: "draw", label: "Kitchen Reno" },
        { month: 24, amount: 8000, event_type: "lump_sum", label: "Annual Bonus" },
      ],
    },
  },
]);

const VALID_BALANCE_METHODS = new Set(Object.values(BalanceMethod));
const VALID_SCENARIOS = new Set(Object.values(RateScenarioType));
const VALID_DRAW_MODES = new Set(Object.values(DrawPaymentMode));
const STRICT_NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parse and optionally expand a custom Prime rate sequence string.
 *
 * @param {string} rawText
 * @param {"annual" | "monthly"} [mode="annual"]
 * @returns {{ rates: number[], error: string | null }}
 */
export function expandCustomRates(rawText, mode = "annual") {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return { rates: [], error: "Enter one or more comma-separated Prime rates." };
  }

  const tokens = trimmed.split(/[\s,;]+/).filter(Boolean);
  const parsed = [];
  for (const token of tokens) {
    if (!STRICT_NUMBER_RE.test(token)) {
      return { rates: [], error: `Invalid rate "${token}". Use numeric percentages like 6.0, 6.5.` };
    }
    const num = Number(token);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      return { rates: [], error: `Rate "${token}" must be between 0% and 100%.` };
    }
    parsed.push(num);
  }

  if (mode === "annual") {
    const expanded = [];
    for (const rate of parsed) {
      for (let m = 0; m < 12; m += 1) {
        expanded.push(rate);
      }
    }
    return { rates: expanded, error: null };
  }

  return { rates: parsed, error: null };
}

function serializeEventsParam(events) {
  if (!Array.isArray(events) || events.length === 0) return "";
  return events
    .map((ev) => {
      const cleanLabel = String(ev.label ?? "").replace(/\|/g, " ").trim().slice(0, 60);
      return `${ev.event_type}:${ev.month}:${ev.amount}:${cleanLabel}`;
    })
    .join("|");
}

/**
 * Serialize a HELOC parameter state into a clean URL query string.
 *
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function serializeToQueryString(params) {
  const q = new URLSearchParams();
  q.set("principal", String(params.initial_principal));
  q.set("limit", String(params.credit_limit));
  q.set("prime", String(params.prime_rate));
  q.set("margin", String(params.margin));
  q.set(
    "introApr",
    params.intro_apr === null || params.intro_apr === undefined ? "" : String(params.intro_apr),
  );
  q.set("introMonths", String(params.intro_duration_months));
  q.set("drawMonths", String(params.draw_period_months));
  q.set("repayMonths", String(params.repayment_period_months));
  q.set("cap", String(params.lifetime_rate_cap));
  q.set("usury", String(params.regulatory_ceiling));
  q.set("prepay", String(params.monthly_prepayment));
  q.set("method", String(params.balance_method));
  q.set("basis", String(params.year_basis));
  q.set("scenario", String(params.rate_scenario));
  q.set("step", String(params.annual_rate_step));
  if (Array.isArray(params.custom_rates) && params.custom_rates.length > 0) {
    q.set("customRates", params.custom_rates.join(","));
  }
  if (params.custom_rates_mode) {
    q.set("customMode", String(params.custom_rates_mode));
  }

  // Optional v2 fields (emitted only when non-default to keep v1 links concise)
  if (params.draw_payment_mode && params.draw_payment_mode !== DEFAULT_SCENARIO.draw_payment_mode) {
    q.set("drawMode", String(params.draw_payment_mode));
  }
  if (
    params.draw_min_payment_pct !== undefined &&
    params.draw_min_payment_pct !== DEFAULT_SCENARIO.draw_min_payment_pct
  ) {
    q.set("drawPct", String(params.draw_min_payment_pct));
  }
  if (
    params.draw_min_payment_floor !== undefined &&
    params.draw_min_payment_floor !== DEFAULT_SCENARIO.draw_min_payment_floor
  ) {
    q.set("drawFloor", String(params.draw_min_payment_floor));
  }
  const serializedEvents = serializeEventsParam(params.cash_flow_events);
  if (serializedEvents) {
    q.set("events", serializedEvents);
  }
  if (params.start_year_month) {
    q.set("start", String(params.start_year_month));
  }
  if (params.closing_costs) {
    q.set("closingFee", String(params.closing_costs));
  }
  if (params.annual_fee) {
    q.set("annualFee", String(params.annual_fee));
  }
  if (params.early_closure_fee) {
    q.set("closureFee", String(params.early_closure_fee));
  }
  if (
    params.early_closure_months !== undefined &&
    params.early_closure_months !== DEFAULT_SCENARIO.early_closure_months
  ) {
    q.set("closureMos", String(params.early_closure_months));
  }
  if (params.heloan_enabled) {
    q.set("heloanOn", "1");
    q.set("heloanApr", String(params.heloan_apr ?? DEFAULT_SCENARIO.heloan_apr));
    q.set("heloanYrs", String(params.heloan_term_years ?? DEFAULT_SCENARIO.heloan_term_years));
    if (params.heloan_closing_costs) {
      q.set("heloanFees", String(params.heloan_closing_costs));
    }
  }
  return q.toString();
}

function parseStrictNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  const s = String(raw).trim();
  if (!STRICT_NUMBER_RE.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Parse URL query parameters safely, clamping/ignoring invalid or tampered values.
 *
 * @param {string} search
 * @param {Record<string, unknown>} [fallback=DEFAULT_SCENARIO]
 * @returns {{ params: Record<string, unknown>, warnings: string[] }}
 */
export function parseQueryString(search, fallback = DEFAULT_SCENARIO) {
  const params = {
    ...fallback,
    cash_flow_events: Array.isArray(fallback.cash_flow_events)
      ? fallback.cash_flow_events.map((ev) => ({ ...ev }))
      : [],
  };
  const warnings = [];
  const q = new URLSearchParams(search ?? "");

  const readFloat = (key, target, { min = -Infinity, max = Infinity, minExclusive = false } = {}) => {
    if (!q.has(key)) return;
    const val = parseStrictNum(q.get(key));
    const lowerOk = minExclusive ? val > min : val >= min;
    if (!Number.isFinite(val) || !lowerOk || val > max) {
      warnings.push(`Ignored invalid URL parameter "${key}".`);
      return;
    }
    params[target] = val;
  };

  const readInt = (key, target, { min = 0, max = 1200 } = {}) => {
    if (!q.has(key)) return;
    const val = parseStrictNum(q.get(key));
    if (!Number.isInteger(val) || val < min || val > max) {
      warnings.push(`Ignored invalid integer URL parameter "${key}".`);
      return;
    }
    params[target] = val;
  };

  readFloat("principal", "initial_principal", { min: 0, minExclusive: true, max: 1e9 });
  readFloat("limit", "credit_limit", { min: 0, minExclusive: true, max: 1e9 });
  readFloat("prime", "prime_rate", { min: 0, max: 100 });
  readFloat("margin", "margin", { min: 0, max: 100 });
  readInt("introMonths", "intro_duration_months", { min: 0, max: 600 });
  readInt("drawMonths", "draw_period_months", { min: 1, max: 600 });
  readInt("repayMonths", "repayment_period_months", { min: 1, max: 600 });
  readFloat("cap", "lifetime_rate_cap", { min: 0, minExclusive: true, max: 100 });
  readFloat("usury", "regulatory_ceiling", { min: 0, minExclusive: true, max: 100 });
  readFloat("prepay", "monthly_prepayment", { min: 0, max: 1e8 });
  readFloat("step", "annual_rate_step", { min: -25, max: 25 });

  // Optional v2 numeric / enum parameters
  readFloat("drawPct", "draw_min_payment_pct", { min: 0, max: 100 });
  readFloat("drawFloor", "draw_min_payment_floor", { min: 0, max: 1e8 });
  readFloat("closingFee", "closing_costs", { min: 0, max: 1e7 });
  readFloat("annualFee", "annual_fee", { min: 0, max: 1e6 });
  readFloat("closureFee", "early_closure_fee", { min: 0, max: 1e7 });
  readInt("closureMos", "early_closure_months", { min: 0, max: 600 });
  readFloat("heloanApr", "heloan_apr", { min: 0, max: 100 });
  readInt("heloanYrs", "heloan_term_years", { min: 1, max: 40 });
  readFloat("heloanFees", "heloan_closing_costs", { min: 0, max: 1e7 });

  if (q.has("introApr")) {
    const rawIntro = q.get("introApr").trim();
    if (rawIntro === "" || rawIntro === "none" || rawIntro === "null") {
      params.intro_apr = null;
    } else {
      const val = parseStrictNum(rawIntro);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        warnings.push('Ignored invalid URL parameter "introApr".');
      } else {
        params.intro_apr = val;
      }
    }
  }

  if (q.has("method")) {
    const m = q.get("method").trim().toLowerCase();
    if (VALID_BALANCE_METHODS.has(m)) {
      params.balance_method = m;
    } else {
      warnings.push('Ignored invalid URL parameter "method".');
    }
  }

  if (q.has("basis")) {
    const b = parseStrictNum(q.get("basis"));
    if (b === YearBasis.DAYS_365 || b === YearBasis.DAYS_360) {
      params.year_basis = b;
    } else {
      warnings.push('Ignored invalid URL parameter "basis".');
    }
  }

  if (q.has("scenario")) {
    const s = q.get("scenario").trim().toLowerCase();
    if (VALID_SCENARIOS.has(s)) {
      params.rate_scenario = s;
    } else {
      warnings.push('Ignored invalid URL parameter "scenario".');
    }
  }

  if (q.has("drawMode")) {
    const dm = q.get("drawMode").trim().toLowerCase();
    if (VALID_DRAW_MODES.has(dm)) {
      params.draw_payment_mode = dm;
    } else {
      warnings.push('Ignored invalid URL parameter "drawMode".');
    }
  }

  if (q.has("start")) {
    const rawStart = q.get("start").trim();
    if (rawStart === "" || rawStart === "none" || rawStart === "null") {
      params.start_year_month = null;
    } else {
      const ym = parseYearMonth(rawStart);
      if (!ym) {
        warnings.push('Ignored invalid URL parameter "start".');
      } else {
        params.start_year_month = formatIsoYearMonth(ym);
      }
    }
  }

  if (q.has("heloanOn")) {
    const rawOn = q.get("heloanOn").trim().toLowerCase();
    params.heloan_enabled = rawOn === "1" || rawOn === "true";
  }

  if (q.has("customMode")) {
    const mode = q.get("customMode").trim().toLowerCase();
    if (mode === "annual" || mode === "monthly") {
      params.custom_rates_mode = mode;
    } else {
      warnings.push('Ignored invalid URL parameter "customMode".');
    }
  }

  if (q.has("customRates")) {
    const rawRates = q.get("customRates");
    if (rawRates.trim() === "") {
      params.custom_rates = null;
    } else {
      const parsed = expandCustomRates(rawRates, "monthly");
      if (parsed.error) {
        warnings.push('Ignored invalid URL parameter "customRates".');
        params.custom_rates = null;
      } else {
        params.custom_rates = parsed.rates;
      }
    }
  }

  if (q.has("events")) {
    const rawEvents = q.get("events").trim();
    if (rawEvents === "") {
      params.cash_flow_events = [];
    } else {
      const totalMonths = params.draw_period_months + params.repayment_period_months;
      const parsedEvents = [];
      for (const chunk of rawEvents.split("|")) {
        if (!chunk) continue;
        const [rawType, rawMonth, rawAmount, ...labelParts] = chunk.split(":");
        const evType = (rawType ?? "").trim().toLowerCase();
        const evMonth = parseStrictNum(rawMonth);
        const evAmount = parseStrictNum(rawAmount);
        const validType = evType === "draw" || evType === "lump_sum";
        const validMonth =
          Number.isInteger(evMonth) &&
          evMonth >= 1 &&
          evMonth <= totalMonths &&
          (evType !== "draw" || evMonth <= params.draw_period_months);
        const validAmount = Number.isFinite(evAmount) && evAmount > 0 && evAmount <= 1e9;
        if (!validType || !validMonth || !validAmount) {
          warnings.push("Ignored invalid URL scheduled cash-flow event.");
          continue;
        }
        parsedEvents.push({
          month: evMonth,
          amount: evAmount,
          event_type: evType,
          label: labelParts.join(":").trim().slice(0, 60),
        });
      }
      params.cash_flow_events = parsedEvents;
    }
  }

  if (params.initial_principal > params.credit_limit) {
    warnings.push("Clamped initial principal to match credit limit.");
    params.initial_principal = params.credit_limit;
  }

  try {
    validateConfig(params);
  } catch {
    warnings.push("Reset parameters to safe defaults after validation check.");
    return {
      params: {
        ...fallback,
        cash_flow_events: Array.isArray(fallback.cash_flow_events)
          ? fallback.cash_flow_events.map((ev) => ({ ...ev }))
          : [],
      },
      warnings,
    };
  }

  return { params, warnings };
}

/**
 * Build a shareable URL that preserves the hosting origin and subpath (e.g. `/heloc-calculator/`).
 *
 * @param {Record<string, unknown>} params
 * @param {{ origin?: string, pathname?: string }} locationLike
 * @returns {string}
 */
export function buildShareUrl(params, locationLike) {
  const origin = locationLike?.origin ?? "";
  const pathname = locationLike?.pathname ?? "/";
  const base = origin && origin !== "null" ? `${origin}${pathname}` : pathname;
  return `${base}?${serializeToQueryString(params)}`;
}
