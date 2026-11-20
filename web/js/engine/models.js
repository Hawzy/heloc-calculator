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
  };
}
