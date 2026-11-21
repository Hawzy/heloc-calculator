/**
 * Data contracts, enums, defaults, and validation mirroring `heloc/core/models.py`.
 */

export const BalanceMethod = Object.freeze({
  AVERAGE_DAILY_BALANCE: "average_daily_balance",
  ADJUSTED_BALANCE: "adjusted_balance",
  PREVIOUS_BALANCE: "previous_balance",
});

export const YearBasis = Object.freeze({
  DAYS_365: 365,
  DAYS_360: 360,
});

export const RateScenarioType = Object.freeze({
  FLAT: "flat",
  RISING: "rising",
  STRESS_TEST: "stress_test",
  CUSTOM: "custom",
});

export const DrawPaymentMode = Object.freeze({
  INTEREST_ONLY: "interest_only",
  PCT_OF_BALANCE: "pct_of_balance",
  FIXED_FLOOR: "fixed_floor",
});

export const DEFAULT_CONFIG = Object.freeze({
  margin: 2.0,
  intro_apr: null,
  intro_duration_months: 12,
  draw_period_months: 120,
  repayment_period_months: 240,
  lifetime_rate_cap: 18.0,
  regulatory_ceiling: 25.0,
  monthly_prepayment: 0.0,
  balance_method: BalanceMethod.AVERAGE_DAILY_BALANCE,
  year_basis: YearBasis.DAYS_365,
  draw_payment_mode: DrawPaymentMode.INTEREST_ONLY,
  draw_min_payment_pct: 1.0,
  draw_min_payment_floor: 0.0,
  cash_flow_events: [],
  closing_costs: 0.0,
  annual_fee: 0.0,
  early_closure_fee: 0.0,
  early_closure_months: 36,
});

export class ConfigValidationError extends Error {
  /**
   * @param {Array<{field: string, message: string}>} errors
   */
  constructor(errors) {
    const summary = errors.map((e) => `${e.field}: ${e.message}`).join("; ");
    super(summary || "Invalid HELOC configuration");
    this.name = "ConfigValidationError";
    this.errors = errors;
  }
}

const VALID_BALANCE_METHODS = new Set(Object.values(BalanceMethod));
const VALID_DRAW_MODES = new Set(Object.values(DrawPaymentMode));

/**
 * Validate and normalize a raw HELOC configuration object.
 *
 * @param {Record<string, unknown>} raw
 * @returns {import('./models.js').HelocConfig}
 */
export function validateConfig(raw) {
  const errors = [];
  const merged = { ...DEFAULT_CONFIG, ...(raw ?? {}) };

  const initialPrincipal = Number(merged.initial_principal);
  if (!Number.isFinite(initialPrincipal) || initialPrincipal <= 0) {
    errors.push({
      field: "initial_principal",
      message: "Initial drawn balance must be greater than $0.",
    });
  }

  const creditLimit = Number(merged.credit_limit);
  if (!Number.isFinite(creditLimit) || creditLimit <= 0) {
    errors.push({
      field: "credit_limit",
      message: "Credit limit must be greater than $0.",
    });
  }

  if (
    Number.isFinite(initialPrincipal) &&
    Number.isFinite(creditLimit) &&
    initialPrincipal > 0 &&
    creditLimit > 0 &&
    initialPrincipal > creditLimit
  ) {
    errors.push({
      field: "initial_principal",
      message: "Initial drawn balance cannot exceed credit limit.",
    });
  }

  const margin = Number(merged.margin);
  if (!Number.isFinite(margin) || margin < 0) {
    errors.push({
      field: "margin",
      message: "Lender margin must be 0% or higher.",
    });
  }

  let introApr = null;
  if (merged.intro_apr !== null && merged.intro_apr !== undefined && merged.intro_apr !== "") {
    introApr = Number(merged.intro_apr);
    if (!Number.isFinite(introApr) || introApr < 0) {
      errors.push({
        field: "intro_apr",
        message: "Introductory APR must be 0% or higher.",
      });
    }
  }

  const introDuration = Number(merged.intro_duration_months);
  if (!Number.isInteger(introDuration) || introDuration < 0) {
    errors.push({
      field: "intro_duration_months",
      message: "Introductory duration must be a whole number of months (0 or more).",
    });
  }

  const drawPeriod = Number(merged.draw_period_months);
  if (!Number.isInteger(drawPeriod) || drawPeriod < 1) {
    errors.push({
      field: "draw_period_months",
      message: "Draw period must be at least 1 month.",
    });
  }

  const repayPeriod = Number(merged.repayment_period_months);
  if (!Number.isInteger(repayPeriod) || repayPeriod < 1) {
    errors.push({
      field: "repayment_period_months",
      message: "Repayment period must be at least 1 month.",
    });
  }

  const lifetimeCap = Number(merged.lifetime_rate_cap);
  if (!Number.isFinite(lifetimeCap) || lifetimeCap <= 0) {
    errors.push({
      field: "lifetime_rate_cap",
      message: "Lifetime rate cap must be greater than 0%.",
    });
  }

  const regulatoryCeiling = Number(merged.regulatory_ceiling);
  if (!Number.isFinite(regulatoryCeiling) || regulatoryCeiling <= 0) {
    errors.push({
      field: "regulatory_ceiling",
      message: "Regulatory usury ceiling must be greater than 0%.",
    });
  }

  const monthlyPrepayment = Number(merged.monthly_prepayment);
  if (!Number.isFinite(monthlyPrepayment) || monthlyPrepayment < 0) {
    errors.push({
      field: "monthly_prepayment",
      message: "Monthly prepayment must be $0 or higher.",
    });
  }

  const balanceMethod = String(merged.balance_method);
  if (!VALID_BALANCE_METHODS.has(balanceMethod)) {
    errors.push({
      field: "balance_method",
      message: "Invalid balance calculation method.",
    });
  }

  const yearBasis = Number(merged.year_basis);
  if (yearBasis !== YearBasis.DAYS_365 && yearBasis !== YearBasis.DAYS_360) {
    errors.push({
      field: "year_basis",
      message: "Year basis must be 365 or 360.",
    });
  }

  const drawPaymentMode = String(merged.draw_payment_mode ?? DrawPaymentMode.INTEREST_ONLY);
  if (!VALID_DRAW_MODES.has(drawPaymentMode)) {
    errors.push({
      field: "draw_payment_mode",
      message: "Invalid draw minimum payment mode.",
    });
  }

  const drawMinPct = Number(merged.draw_min_payment_pct ?? 1.0);
  if (!Number.isFinite(drawMinPct) || drawMinPct < 0 || drawMinPct > 100) {
    errors.push({
      field: "draw_min_payment_pct",
      message: "Minimum draw % must be between 0% and 100%.",
    });
  }

  const drawMinFloor = Number(merged.draw_min_payment_floor ?? 0.0);
  if (!Number.isFinite(drawMinFloor) || drawMinFloor < 0) {
    errors.push({
      field: "draw_min_payment_floor",
      message: "Minimum draw payment floor must be $0 or higher.",
    });
  }

  const closingCosts = Number(merged.closing_costs ?? 0.0);
  if (!Number.isFinite(closingCosts) || closingCosts < 0) {
    errors.push({
      field: "closing_costs",
      message: "Closing costs must be $0 or higher.",
    });
  }

  const annualFee = Number(merged.annual_fee ?? 0.0);
  if (!Number.isFinite(annualFee) || annualFee < 0) {
    errors.push({
      field: "annual_fee",
      message: "Annual fee must be $0 or higher.",
    });
  }

  const earlyClosureFee = Number(merged.early_closure_fee ?? 0.0);
  if (!Number.isFinite(earlyClosureFee) || earlyClosureFee < 0) {
    errors.push({
      field: "early_closure_fee",
      message: "Early closure fee must be $0 or higher.",
    });
  }

  const earlyClosureMonths = Number(merged.early_closure_months ?? 36);
  if (!Number.isInteger(earlyClosureMonths) || earlyClosureMonths < 0) {
    errors.push({
      field: "early_closure_months",
      message: "Early closure window must be a whole number of months (0 or more).",
    });
  }

  const normalizedEvents = [];
  const rawEvents = merged.cash_flow_events ?? [];
  if (!Array.isArray(rawEvents)) {
    errors.push({
      field: "cash_flow_events",
      message: "Scheduled cash-flow events must be a list.",
    });
  } else {
    const totalMonths =
      Number.isInteger(drawPeriod) && Number.isInteger(repayPeriod) ? drawPeriod + repayPeriod : 0;
    for (let i = 0; i < rawEvents.length; i += 1) {
      const ev = rawEvents[i];
      if (!ev || typeof ev !== "object") {
        errors.push({
          field: "cash_flow_events",
          message: `Cash-flow event #${i + 1} is invalid.`,
        });
        continue;
      }
      const evMonth = Number(ev.month);
      const evAmount = Number(ev.amount);
      const evType = String(ev.event_type);
      const evLabel = String(ev.label ?? "").slice(0, 60);
      if (!Number.isInteger(evMonth) || evMonth < 1) {
        errors.push({
          field: "cash_flow_events",
          message: `Event month must be at least 1.`,
        });
        continue;
      }
      if (totalMonths > 0 && evMonth > totalMonths) {
        errors.push({
          field: "cash_flow_events",
          message: `Event month ${evMonth} exceeds total term (${totalMonths} months).`,
        });
        continue;
      }
      if (!Number.isFinite(evAmount) || evAmount <= 0) {
        errors.push({
          field: "cash_flow_events",
          message: `Event amount must be greater than $0.`,
        });
        continue;
      }
      if (evType !== "draw" && evType !== "lump_sum") {
        errors.push({
          field: "cash_flow_events",
          message: `Event type "${evType}" must be "draw" or "lump_sum".`,
        });
        continue;
      }
      if (evType === "draw" && Number.isInteger(drawPeriod) && evMonth > drawPeriod) {
        errors.push({
          field: "cash_flow_events",
          message: `Scheduled draw in month ${evMonth} cannot occur after draw period (${drawPeriod} months).`,
        });
        continue;
      }
      normalizedEvents.push({
        month: evMonth,
        amount: evAmount,
        event_type: evType,
        label: evLabel,
      });
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return {
    initial_principal: initialPrincipal,
    credit_limit: creditLimit,
    margin,
    intro_apr: introApr,
    intro_duration_months: introDuration,
    draw_period_months: drawPeriod,
    repayment_period_months: repayPeriod,
    lifetime_rate_cap: lifetimeCap,
    regulatory_ceiling: regulatoryCeiling,
    monthly_prepayment: monthlyPrepayment,
    balance_method: balanceMethod,
    year_basis: yearBasis,
    draw_payment_mode: drawPaymentMode,
    draw_min_payment_pct: drawMinPct,
    draw_min_payment_floor: drawMinFloor,
    cash_flow_events: normalizedEvents,
    closing_costs: closingCosts,
    annual_fee: annualFee,
    early_closure_fee: earlyClosureFee,
    early_closure_months: earlyClosureMonths,
  };
}
