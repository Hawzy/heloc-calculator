/**
 * Core financial formulas mirroring `heloc/core/formulas.py`.
 */

import { YearBasis } from "./models.js";

/**
 * Calculate the Daily Periodic Rate (DPR) from an annual percentage rate.
 *
 * @param {number} annualRatePct
 * @param {number} [yearBasis=YearBasis.DAYS_365]
 * @returns {number}
 */
export function dailyPeriodicRate(annualRatePct, yearBasis = YearBasis.DAYS_365) {
  const basis = Math.trunc(Number(yearBasis));
  if (!Number.isFinite(basis) || basis <= 0) {
    throw new RangeError("year_basis must be greater than 0");
  }
  return (annualRatePct / 100.0) / basis;
}

/**
 * Calculate the Average Daily Balance (ADB) over a billing cycle.
 *
 * @param {number[]} dailyBalances
 * @returns {number}
 */
export function averageDailyBalance(dailyBalances) {
  if (!Array.isArray(dailyBalances) || dailyBalances.length === 0) {
    return 0.0;
  }
  let sum = 0.0;
  for (let i = 0; i < dailyBalances.length; i += 1) {
    sum += dailyBalances[i];
  }
  return sum / dailyBalances.length;
}

/**
 * Calculate the monthly finance charge for a billing period.
 *
 * @param {number} balance
 * @param {number} dpr
 * @param {number} [daysInCycle=30.4167]
 * @returns {number}
 */
export function monthlyFinanceCharge(balance, dpr, daysInCycle = 30.4167) {
  return balance * dpr * daysInCycle;
}

/**
 * Calculate the fully amortizing fixed monthly payment installment.
 *
 * @param {number} principal
 * @param {number} annualRatePct
 * @param {number} remainingMonths
 * @returns {number}
 */
export function amortizedMonthlyInstallment(principal, annualRatePct, remainingMonths) {
  if (principal <= 0.0 || remainingMonths <= 0) {
    return 0.0;
  }
  if (annualRatePct <= 0.0) {
    return principal / remainingMonths;
  }
  const monthlyRate = (annualRatePct / 100.0) / 12.0;
  const factor = (1.0 + monthlyRate) ** remainingMonths;
  return (principal * (monthlyRate * factor)) / (factor - 1.0);
}
