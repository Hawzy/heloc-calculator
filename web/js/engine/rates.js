/**
 * Rate resolution, macroeconomic scenarios, and usury enforcement mirroring `heloc/core/rates.py`.
 */

import { RateScenarioType } from "./models.js";

/**
 * Calculate active effective APR for a given 1-indexed month under caps and intro terms.
 *
 * @param {number} month
 * @param {import('./models.js').HelocConfig} config
 * @param {number} primeRate
 * @returns {number}
 */
export function getEffectiveRate(month, config, primeRate) {
  if (month < 1) {
    throw new RangeError("month must be greater than or equal to 1");
  }

  const appliedCeiling = Math.min(config.lifetime_rate_cap, config.regulatory_ceiling);

  if (config.intro_apr !== null && config.intro_apr !== undefined && month <= config.intro_duration_months) {
    return Math.max(0.0, Math.min(config.intro_apr, appliedCeiling));
  }

  const rawRate = primeRate + config.margin;
  return Math.max(0.0, Math.min(rawRate, appliedCeiling));
}

/**
 * Generate a monthly Prime rate schedule for the selected scenario.
 *
 * @param {{
 *   totalMonths: number,
 *   scenario: string,
 *   basePrime: number,
 *   annualStep?: number,
 *   customRates?: number[] | null
 * }} opts
 * @returns {number[]}
 */
export function generatePrimeRates({
  totalMonths,
  scenario,
  basePrime,
  annualStep = 0.5,
  customRates = null,
}) {
  if (totalMonths <= 0) {
    return [];
  }

  if (scenario === RateScenarioType.CUSTOM && customRates !== null && customRates !== undefined) {
    if (customRates.length < totalMonths) {
      const lastRate = customRates.length > 0 ? customRates[customRates.length - 1] : basePrime;
      const padded = customRates.slice();
      while (padded.length < totalMonths) {
        padded.push(lastRate);
      }
      return padded;
    }
    return customRates.slice(0, totalMonths);
  }

  if (scenario === RateScenarioType.FLAT) {
    return new Array(totalMonths).fill(basePrime);
  }

  if (scenario === RateScenarioType.RISING) {
    const rates = new Array(totalMonths);
    for (let m = 0; m < totalMonths; m += 1) {
      const yearIdx = Math.floor(m / 12);
      rates[m] = basePrime + yearIdx * annualStep;
    }
    return rates;
  }

  if (scenario === RateScenarioType.STRESS_TEST) {
    const rates = new Array(totalMonths);
    for (let m = 0; m < totalMonths; m += 1) {
      const semesterIdx = Math.min(Math.floor(m / 6), 6);
      rates[m] = basePrime + semesterIdx * 0.75;
    }
    return rates;
  }

  return new Array(totalMonths).fill(basePrime);
}
