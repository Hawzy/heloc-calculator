/**
 * Stateful month-by-month HELOC simulation engine mirroring `heloc/core/simulator.py`.
 */

import {
  amortizedMonthlyInstallment,
  dailyPeriodicRate,
  monthlyFinanceCharge,
} from "./formulas.js";
import { BalanceMethod, DrawPaymentMode, RateScenarioType } from "./models.js";
import { generatePrimeRates, getEffectiveRate } from "./rates.js";
import { pyRound } from "./rounding.js";

/**
 * Simulate a single trajectory with full v2 draw/lump-sum/peak diagnostics.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number[]} primeSchedule
 */
export function runTrajectoryWithStats(config, primeSchedule) {
  const totalMonths = config.draw_period_months + config.repayment_period_months;
  const records = [];
  let currentBalance = config.initial_principal;
  let totalInterest = 0.0;
  let totalPrincipalPaid = 0.0;
  let actualMonths = totalMonths;

  const drawsByMonth = new Map();
  const lumpsByMonth = new Map();
  const events = Array.isArray(config.cash_flow_events) ? config.cash_flow_events : [];
  let lastDrawEventMonth = 0;

  for (const ev of events) {
    if (ev.event_type === "draw") {
      drawsByMonth.set(ev.month, (drawsByMonth.get(ev.month) ?? 0.0) + ev.amount);
      if (ev.month > lastDrawEventMonth) lastDrawEventMonth = ev.month;
    } else {
      lumpsByMonth.set(ev.month, (lumpsByMonth.get(ev.month) ?? 0.0) + ev.amount);
    }
  }

  let totalAdditionalDraws = 0.0;
  let totalLumpSumPayments = 0.0;
  let peakBalance = config.initial_principal;
  const clippedDraws = [];

  // Match Python simulator.py exact monthly day approximation
  const daysInMonth = 365.0 / 12.0;
  const drawMode = config.draw_payment_mode ?? DrawPaymentMode.INTEREST_ONLY;
  const drawMinPct = config.draw_min_payment_pct ?? 1.0;
  const drawMinFloor = config.draw_min_payment_floor ?? 0.0;

  for (let m = 1; m <= totalMonths; m += 1) {
    if (currentBalance <= 1e-4 && m > lastDrawEventMonth) {
      actualMonths = m - 1;
      break;
    }

    const year = Math.floor((m - 1) / 12) + 1;
    const isDraw = m <= config.draw_period_months;
    const phase = isDraw ? "draw" : "repayment";
    const primeRate = primeSchedule[m - 1];
    const effectiveApr = getEffectiveRate(m, config, primeRate);

    if (isDraw && drawsByMonth.has(m)) {
      const requestedDraw = drawsByMonth.get(m);
      const availableCredit = Math.max(0.0, config.credit_limit - currentBalance);
      const actualDraw = Math.min(requestedDraw, availableCredit);
      if (actualDraw < requestedDraw - 1e-6) {
        clippedDraws.push({
          month: m,
          requested: pyRound(requestedDraw, 2),
          applied: pyRound(actualDraw, 2),
          limit: config.credit_limit,
        });
      }
      currentBalance += actualDraw;
      totalAdditionalDraws += actualDraw;
    }

    const startingBal = currentBalance;
    if (startingBal > peakBalance) peakBalance = startingBal;

    if (startingBal <= 1e-4) {
      records.push({
        month: m,
        year,
        phase,
        starting_balance: 0.0,
        effective_apr: pyRound(effectiveApr, 4),
        prime_rate: pyRound(primeRate, 4),
        required_payment: 0.0,
        prepayment: 0.0,
        total_payment: 0.0,
        interest_paid: 0.0,
        principal_paid: 0.0,
        ending_balance: 0.0,
      });
      continue;
    }

    const lumpSum = lumpsByMonth.get(m) ?? 0.0;
    const extraAvailable = config.monthly_prepayment + lumpSum;

    let interestDue;
    let prepayment;
    let principalPaid;
    let endingBal;

    if (isDraw) {
      const dpr = dailyPeriodicRate(effectiveApr, config.year_basis);
      if (config.balance_method === BalanceMethod.ADJUSTED_BALANCE) {
        const prepayEst = Math.min(extraAvailable, startingBal);
        const calcBal = Math.max(0.0, startingBal - prepayEst);
        interestDue = monthlyFinanceCharge(calcBal, dpr, daysInMonth);
      } else {
        interestDue = monthlyFinanceCharge(startingBal, dpr, daysInMonth);
      }

      let minReq;
      if (drawMode === DrawPaymentMode.PCT_OF_BALANCE) {
        minReq = Math.max(
          interestDue,
          startingBal * (drawMinPct / 100.0),
          drawMinFloor,
        );
      } else if (drawMode === DrawPaymentMode.FIXED_FLOOR) {
        minReq = Math.max(interestDue, drawMinFloor);
      } else {
        minReq = interestDue;
      }

      minReq = Math.min(minReq, startingBal + interestDue);
      const scheduledPrincipal = Math.min(Math.max(0.0, minReq - interestDue), startingBal);
      const remainingPrincipal = Math.max(0.0, startingBal - scheduledPrincipal);
      prepayment = Math.min(extraAvailable, remainingPrincipal);
      const actualLump = Math.min(
        lumpSum,
        Math.max(0.0, remainingPrincipal - Math.min(config.monthly_prepayment, remainingPrincipal)),
      );
      totalLumpSumPayments += actualLump;
      principalPaid = scheduledPrincipal + prepayment;
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
      const remainingPrincipal = Math.max(0.0, startingBal - scheduledPrincipal);
      prepayment = Math.min(extraAvailable, remainingPrincipal);
      const actualLump = Math.min(
        lumpSum,
        Math.max(0.0, remainingPrincipal - Math.min(config.monthly_prepayment, remainingPrincipal)),
      );
      totalLumpSumPayments += actualLump;
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
    let prepRounded = pyRound(prepayment, 2);
    let reqPaid = pyRound(totPaid - prepRounded, 2);
    if (reqPaid < 0.0) {
      reqPaid = 0.0;
      prepRounded = totPaid;
    }

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

    if (currentBalance <= 1e-4 && m >= lastDrawEventMonth) {
      actualMonths = m;
      break;
    }
  }

  return {
    records,
    actualMonths,
    totalInterest,
    totalPrincipalPaid,
    stats: {
      total_additional_draws: totalAdditionalDraws,
      total_lump_sum_payments: totalLumpSumPayments,
      peak_balance: peakBalance,
      clipped_draws: clippedDraws,
    },
  };
}

/**
 * Simulate a single loan trajectory given a fixed configuration and Prime rate schedule.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number[]} primeSchedule
 */
export function runSingleTrajectory(config, primeSchedule) {
  const { records, actualMonths, totalInterest, totalPrincipalPaid } = runTrajectoryWithStats(
    config,
    primeSchedule,
  );
  return { records, actualMonths, totalInterest, totalPrincipalPaid };
}

/**
 * Simulate a complete HELOC trajectory with $0-prepayment baseline comparison.
 *
 * @param {import('./models.js').HelocConfig} config
 * @param {number[] | null} [primeSchedule=null]
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

  const { records, actualMonths, totalInterest, totalPrincipalPaid, stats } =
    runTrajectoryWithStats(config, resolvedPrime);

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
  const events = Array.isArray(config.cash_flow_events) ? config.cash_flow_events : [];
  const hasLumpSums = events.some((ev) => ev.event_type === "lump_sum");

  if (config.monthly_prepayment > 0 || hasLumpSums) {
    const baselineConfig = {
      ...config,
      monthly_prepayment: 0.0,
      cash_flow_events: events.filter((ev) => ev.event_type === "draw"),
    };
    const baselineRun = runTrajectoryWithStats(baselineConfig, resolvedPrime);
    baselineRecords = baselineRun.records;
    interestSavings = Math.max(0.0, baselineRun.totalInterest - totalInterest);
    monthsSaved = Math.max(0, baselineRun.actualMonths - actualMonths);
  }

  const closingCosts = config.closing_costs ?? 0.0;
  const annualFee = config.annual_fee ?? 0.0;
  const earlyClosureFee = config.early_closure_fee ?? 0.0;
  const earlyClosureMonths = config.early_closure_months ?? 36;

  const annualFeesTotal =
    actualMonths > 0 && annualFee > 0 ? pyRound(annualFee * Math.ceil(actualMonths / 12.0), 2) : 0.0;
  const earlyClosureTriggered = Boolean(
    earlyClosureFee > 0 && earlyClosureMonths > 0 && actualMonths <= earlyClosureMonths,
  );
  const earlyClosureApplied = earlyClosureTriggered ? pyRound(earlyClosureFee, 2) : 0.0;
  const totalFees = pyRound(closingCosts + annualFeesTotal + earlyClosureApplied, 2);
  const totalCostWithFees = pyRound(totalInterest + totalPrincipalPaid + totalFees, 2);

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
    total_additional_draws: pyRound(stats.total_additional_draws, 2),
    total_lump_sum_payments: pyRound(stats.total_lump_sum_payments, 2),
    peak_balance: pyRound(stats.peak_balance, 2),
    total_fees: totalFees,
    total_cost_with_fees: totalCostWithFees,
    early_closure_fee_triggered: earlyClosureTriggered,
  };

  return {
    summary,
    records,
    baselineRecords,
    clippedDraws: stats.clipped_draws,
  };
}
