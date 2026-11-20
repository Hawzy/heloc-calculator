/**
 * Stateful month-by-month HELOC simulation engine mirroring `heloc/core/simulator.py`.
 */

import {
  amortizedMonthlyInstallment,
  dailyPeriodicRate,
  monthlyFinanceCharge,
} from "./formulas.js";
import { BalanceMethod, RateScenarioType } from "./models.js";
import { generatePrimeRates, getEffectiveRate } from "./rates.js";
import { pyRound } from "./rounding.js";

/**
 * Simulate a single loan trajectory given a fixed configuration and Prime rate schedule.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number[]} primeSchedule
 * @returns {{
 *   records: Array<Record<string, unknown>>,
 *   actualMonths: number,
 *   totalInterest: number,
 *   totalPrincipalPaid: number
 * }}
 */
export function runSingleTrajectory(config, primeSchedule) {
  const totalMonths = config.draw_period_months + config.repayment_period_months;
  const records = [];
  let currentBalance = config.initial_principal;
  let totalInterest = 0.0;
  let totalPrincipalPaid = 0.0;
  let actualMonths = totalMonths;

  // Match Python simulator.py exact monthly day approximation
  const daysInMonth = 365.0 / 12.0;

  for (let m = 1; m <= totalMonths; m += 1) {
    if (currentBalance <= 1e-4) {
      actualMonths = m - 1;
      break;
    }

    const year = Math.floor((m - 1) / 12) + 1;
    const isDraw = m <= config.draw_period_months;
    const phase = isDraw ? "draw" : "repayment";
    const primeRate = primeSchedule[m - 1];
    const effectiveApr = getEffectiveRate(m, config, primeRate);
    const startingBal = currentBalance;

    let interestDue;
    let prepayment;
    let principalPaid;
    let endingBal;

    if (isDraw) {
      const dpr = dailyPeriodicRate(effectiveApr, config.year_basis);
      if (config.balance_method === BalanceMethod.ADJUSTED_BALANCE) {
        prepayment = Math.min(config.monthly_prepayment, startingBal);
        const calcBal = Math.max(0.0, startingBal - prepayment);
        interestDue = monthlyFinanceCharge(calcBal, dpr, daysInMonth);
      } else {
        interestDue = monthlyFinanceCharge(startingBal, dpr, daysInMonth);
        prepayment = Math.min(config.monthly_prepayment, startingBal);
      }
      principalPaid = prepayment;
      endingBal = Math.max(0.0, startingBal - principalPaid);
    } else {
      const remainingRepayMonths = totalMonths - m + 1;
      const installment = amortizedMonthlyInstallment(
        startingBal,
        effectiveApr,
        remainingRepayMonths,
      );
      const rMonthly = (effectiveApr / 100.0) / 12.0;
      interestDue = startingBal * rMonthly;
      const scheduledPrincipal = Math.min(Math.max(0.0, installment - interestDue), startingBal);
      prepayment = Math.min(config.monthly_prepayment, startingBal - scheduledPrincipal);
      principalPaid = scheduledPrincipal + prepayment;
      endingBal = Math.max(0.0, startingBal - principalPaid);
    }

    if (endingBal < 1e-4) {
      endingBal = 0.0;
    }

    totalInterest += interestDue;
    totalPrincipalPaid += principalPaid;
    currentBalance = endingBal;

    const intPaid = pyRound(interestDue, 2);
    const prinPaid = pyRound(principalPaid, 2);
    const totPaid = pyRound(intPaid + prinPaid, 2);
    const prepRounded = pyRound(prepayment, 2);
    const reqPaid = pyRound(totPaid - prepRounded, 2);

    records.push({
      month: m,
      year,
      phase,
      starting_balance: pyRound(startingBal, 2),
      effective_apr: pyRound(effectiveApr, 4),
      prime_rate: pyRound(primeRate, 4),
      required_payment: reqPaid,
      prepayment: prepRounded,
      total_payment: totPaid,
      interest_paid: intPaid,
      principal_paid: prinPaid,
      ending_balance: pyRound(endingBal, 2),
    });

    if (currentBalance <= 1e-4) {
      actualMonths = m;
      break;
    }
  }

  return { records, actualMonths, totalInterest, totalPrincipalPaid };
}

/**
 * Simulate a complete HELOC trajectory with $0-prepayment baseline comparison.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number[] | null} [primeSchedule=null]
 * @returns {{
 *   summary: Record<string, number>,
 *   records: Array<Record<string, unknown>>,
 *   baselineRecords: Array<Record<string, unknown>>
 * }}
 */
export function simulateHeloc(config, primeSchedule = null) {
  const totalMonths = config.draw_period_months + config.repayment_period_months;
  let resolvedPrime;

  if (primeSchedule === null || primeSchedule === undefined) {
    resolvedPrime = generatePrimeRates({
      totalMonths,
      scenario: RateScenarioType.FLAT,
      basePrime: 8.5,
    });
  } else if (primeSchedule.length < totalMonths) {
    resolvedPrime = generatePrimeRates({
      totalMonths,
      scenario: RateScenarioType.CUSTOM,
      basePrime: 8.5,
      customRates: primeSchedule,
    });
  } else {
    resolvedPrime = primeSchedule.slice(0, totalMonths);
  }

  const { records, actualMonths, totalInterest, totalPrincipalPaid } = runSingleTrajectory(
    config,
    resolvedPrime,
  );

  const initialDrawPayment = records.length > 0 ? pyRound(records[0].required_payment, 2) : 0.0;
  const firstRepayIdx = config.draw_period_months;

  let firstRepaymentPayment = 0.0;
  let shockAmount = 0.0;
  let shockPct = 0.0;

  if (records.length > firstRepayIdx) {
    const firstRepayRecord = records[firstRepayIdx];
    const lastDrawRecord = records[firstRepayIdx - 1];
    firstRepaymentPayment = pyRound(firstRepayRecord.required_payment, 2);
    const lastDrawPayment = pyRound(lastDrawRecord.required_payment, 2);
    shockAmount = Math.max(0.0, pyRound(firstRepaymentPayment - lastDrawPayment, 2));
    shockPct =
      lastDrawPayment > 0
        ? pyRound((shockAmount / lastDrawPayment) * 100.0, 2)
        : 0.0;
  }

  let interestSavings = 0.0;
  let monthsSaved = 0;
  let baselineRecords = records;

  if (config.monthly_prepayment > 0) {
    const baselineConfig = { ...config, monthly_prepayment: 0.0 };
    const baselineRun = runSingleTrajectory(baselineConfig, resolvedPrime);
    baselineRecords = baselineRun.records;
    interestSavings = Math.max(0.0, baselineRun.totalInterest - totalInterest);
    monthsSaved = Math.max(0, baselineRun.actualMonths - actualMonths);
  }

  const summary = {
    initial_principal: config.initial_principal,
    credit_limit: config.credit_limit,
    total_months_scheduled: totalMonths,
    actual_months_to_payoff: actualMonths,
    total_interest_paid: pyRound(totalInterest, 2),
    total_principal_paid: pyRound(totalPrincipalPaid, 2),
    total_payments: pyRound(totalInterest + totalPrincipalPaid, 2),
    initial_draw_payment: initialDrawPayment,
    first_repayment_payment: firstRepaymentPayment,
    payment_shock_amount: pyRound(shockAmount, 2),
    payment_shock_pct: pyRound(shockPct, 2),
    interest_savings_vs_baseline: pyRound(interestSavings, 2),
    months_saved_vs_baseline: monthsSaved,
  };

  return { summary, records, baselineRecords };
}
