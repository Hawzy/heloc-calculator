/**
 * Borrowing power, payoff goal solver, and fixed-rate HELoan comparison analytics
 * mirroring `heloc/core/analytics.py`.
 */

import { amortizedMonthlyInstallment } from "./formulas.js";
import { RateScenarioType } from "./models.js";
import { generatePrimeRates } from "./rates.js";
import { pyRound } from "./rounding.js";
import { runSingleTrajectory, simulateHeloc } from "./simulator.js";

/**
 * Estimate maximum HELOC line capacity and Combined Loan-to-Value (CLTV) metrics.
 *
 * @param {number} homeValue
 * @param {number} firstMortgageBalance
 * @param {number} [maxCltvPct=80.0]
 * @param {number | null} [plannedCreditLimit=null]
 * @param {number} [plannedInitialDraw=0.0]
 */
export function estimateBorrowingPower(
  homeValue,
  firstMortgageBalance,
  maxCltvPct = 80.0,
  plannedCreditLimit = null,
  plannedInitialDraw = 0.0,
) {
  if (!Number.isFinite(homeValue) || homeValue <= 0) {
    throw new RangeError("home_value must be greater than 0");
  }
  if (!Number.isFinite(firstMortgageBalance) || firstMortgageBalance < 0) {
    throw new RangeError("first_mortgage_balance must be 0 or higher");
  }
  if (!Number.isFinite(maxCltvPct) || maxCltvPct <= 0 || maxCltvPct > 100) {
    throw new RangeError("max_cltv_pct must be between 0 (exclusive) and 100");
  }

  const currentEquity = pyRound(Math.max(0.0, homeValue - firstMortgageBalance), 2);
  const currentLtvPct = pyRound((firstMortgageBalance / homeValue) * 100.0, 2);
  const maxTotalDebt = pyRound(homeValue * (maxCltvPct / 100.0), 2);
  const maxHelocLimit = pyRound(Math.max(0.0, maxTotalDebt - firstMortgageBalance), 2);

  const effectiveLimit =
    plannedCreditLimit === null || plannedCreditLimit === undefined
      ? maxHelocLimit
      : Math.max(0.0, plannedCreditLimit);
  const projectedCltvPct = pyRound(
    ((firstMortgageBalance + effectiveLimit) / homeValue) * 100.0,
    2,
  );
  const drawnCltvPct = pyRound(
    ((firstMortgageBalance + Math.max(0.0, plannedInitialDraw)) / homeValue) * 100.0,
    2,
  );
  const exceedsMaxCltv = projectedCltvPct > maxCltvPct + 1e-6;

  return {
    home_value: pyRound(homeValue, 2),
    first_mortgage_balance: pyRound(firstMortgageBalance, 2),
    max_cltv_pct: pyRound(maxCltvPct, 2),
    current_equity: currentEquity,
    current_ltv_pct: currentLtvPct,
    max_total_debt: maxTotalDebt,
    max_heloc_limit: maxHelocLimit,
    projected_cltv_pct: projectedCltvPct,
    drawn_cltv_pct: drawnCltvPct,
    exceeds_max_cltv: exceedsMaxCltv,
  };
}

function resolvePrimeSchedule(config, primeSchedule) {
  const totalMonths = config.draw_period_months + config.repayment_period_months;
  if (primeSchedule === null || primeSchedule === undefined) {
    return generatePrimeRates({
      totalMonths,
      scenario: RateScenarioType.FLAT,
      basePrime: 8.5,
    });
  }
  if (primeSchedule.length < totalMonths) {
    return generatePrimeRates({
      totalMonths,
      scenario: RateScenarioType.CUSTOM,
      basePrime: 8.5,
      customRates: primeSchedule,
    });
  }
  return primeSchedule.slice(0, totalMonths);
}

/**
 * Solve for the minimum fixed monthly prepayment ($) needed to pay off by `targetMonths`.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number} targetMonths
 * @param {number[] | null} [primeSchedule=null]
 */
export function solveMonthlyPrepayment(config, targetMonths, primeSchedule = null) {
  const totalMonths = config.draw_period_months + config.repayment_period_months;
  if (!Number.isInteger(targetMonths) || targetMonths < 1 || targetMonths > totalMonths) {
    throw new RangeError(`target_months must be between 1 and ${totalMonths}`);
  }

  const resolvedPrime = resolvePrimeSchedule(config, primeSchedule);
  const drawEvents = (config.cash_flow_events ?? []).filter((ev) => ev.event_type === "draw");
  let lastDrawEventMonth = 0;
  let sumDraws = 0.0;
  for (const ev of drawEvents) {
    if (ev.month > lastDrawEventMonth) lastDrawEventMonth = ev.month;
    sumDraws += ev.amount;
  }

  if (lastDrawEventMonth > targetMonths) {
    return {
      achievable: false,
      already_met: false,
      target_months: targetMonths,
      required_monthly_prepayment: null,
      actual_months_to_payoff: null,
      total_interest_paid: null,
      payment_shock_amount: null,
      reason: `Scheduled draw in Month ${lastDrawEventMonth} occurs after target Month ${targetMonths}.`,
    };
  }

  const cfgZero = { ...config, monthly_prepayment: 0.0 };
  const simZero = simulateHeloc(cfgZero, resolvedPrime);
  if (simZero.summary.actual_months_to_payoff <= targetMonths) {
    return {
      achievable: true,
      already_met: true,
      target_months: targetMonths,
      required_monthly_prepayment: 0.0,
      actual_months_to_payoff: simZero.summary.actual_months_to_payoff,
      total_interest_paid: simZero.summary.total_interest_paid,
      payment_shock_amount: simZero.summary.payment_shock_amount,
    };
  }

  let hi = Math.max((config.initial_principal + sumDraws) * 1.25, 100.0);
  let foundUpper = false;
  while (hi <= 1e9) {
    const cfgHi = { ...config, monthly_prepayment: hi };
    const runHi = runSingleTrajectory(cfgHi, resolvedPrime);
    if (runHi.actualMonths <= targetMonths) {
      foundUpper = true;
      break;
    }
    hi *= 2.0;
  }

  if (!foundUpper) {
    return {
      achievable: false,
      already_met: false,
      target_months: targetMonths,
      required_monthly_prepayment: null,
      actual_months_to_payoff: null,
      total_interest_paid: null,
      payment_shock_amount: null,
      reason: `Could not reach payoff by Month ${targetMonths} within search ceiling.`,
    };
  }

  let loCents = 1;
  let hiCents = Math.ceil(hi * 100.0);
  while (loCents < hiCents) {
    const midCents = Math.floor((loCents + hiCents) / 2);
    const cfgMid = { ...config, monthly_prepayment: midCents / 100.0 };
    const runMid = runSingleTrajectory(cfgMid, resolvedPrime);
    if (runMid.actualMonths <= targetMonths) {
      hiCents = midCents;
    } else {
      loCents = midCents + 1;
    }
  }

  const bestPrepay = pyRound(loCents / 100.0, 2);
  const cfgBest = { ...config, monthly_prepayment: bestPrepay };
  const simBest = simulateHeloc(cfgBest, resolvedPrime);

  return {
    achievable: true,
    already_met: false,
    target_months: targetMonths,
    required_monthly_prepayment: bestPrepay,
    actual_months_to_payoff: simBest.summary.actual_months_to_payoff,
    total_interest_paid: simBest.summary.total_interest_paid,
    payment_shock_amount: simBest.summary.payment_shock_amount,
  };
}

/**
 * Compare the simulated HELOC trajectory against a fixed-rate Home Equity Loan.
 *
 * @param {number} principal
 * @param {number} fixedApr
 * @param {number} termMonths
 * @param {Record<string, number>} helocSummary
 * @param {number} [fixedClosingCosts=0.0]
 */
export function compareFixedHomeEquityLoan(
  principal,
  fixedApr,
  termMonths,
  helocSummary,
  fixedClosingCosts = 0.0,
) {
  if (!Number.isFinite(principal) || principal <= 0) {
    throw new RangeError("principal must be greater than 0");
  }
  if (!Number.isFinite(fixedApr) || fixedApr < 0) {
    throw new RangeError("fixed_apr must be 0 or higher");
  }
  if (!Number.isInteger(termMonths) || termMonths < 1) {
    throw new RangeError("term_months must be at least 1");
  }
  if (!Number.isFinite(fixedClosingCosts) || fixedClosingCosts < 0) {
    throw new RangeError("fixed_closing_costs must be 0 or higher");
  }

  const monthlyPayment = amortizedMonthlyInstallment(principal, fixedApr, termMonths);
  const rMonthly = (fixedApr / 100.0) / 12.0;

  let balance = principal;
  let totalInterest = 0.0;
  let totalPrincipalPaid = 0.0;

  for (let m = 1; m <= termMonths; m += 1) {
    const interestDue = balance * rMonthly;
    const principalPaid =
      m === termMonths
        ? balance
        : Math.min(Math.max(0.0, monthlyPayment - interestDue), balance);
    totalInterest += interestDue;
    totalPrincipalPaid += principalPaid;
    balance = Math.max(0.0, balance - principalPaid);
  }

  const fixedInterest = pyRound(totalInterest, 2);
  const fixedPrincipal = pyRound(totalPrincipalPaid, 2);
  const fixedPayments = pyRound(totalInterest + totalPrincipalPaid, 2);
  const fixedFees = pyRound(fixedClosingCosts, 2);
  const fixedTotalCost = pyRound(totalInterest + totalPrincipalPaid + fixedClosingCosts, 2);

  const helocInterest = Number(helocSummary.total_interest_paid);
  const helocTotalCost = Number(
    helocSummary.total_cost_with_fees ?? helocSummary.total_payments,
  );
  const helocShock = Number(helocSummary.payment_shock_amount);

  return {
    principal: pyRound(principal, 2),
    fixed_apr: pyRound(fixedApr, 4),
    term_months: termMonths,
    monthly_payment: pyRound(monthlyPayment, 2),
    total_interest_paid: fixedInterest,
    total_principal_paid: fixedPrincipal,
    total_payments: fixedPayments,
    fixed_closing_costs: fixedFees,
    total_cost_with_fees: fixedTotalCost,
    interest_delta_vs_heloc: pyRound(helocInterest - fixedInterest, 2),
    total_cost_delta_vs_heloc: pyRound(helocTotalCost - fixedTotalCost, 2),
    payment_shock_avoided: pyRound(helocShock, 2),
  };
}
