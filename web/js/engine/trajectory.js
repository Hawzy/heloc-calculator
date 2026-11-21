/**
 * Unified trajectory orchestration mirroring `heloc/tools/trajectory_tool.py`.
 */

import { BalanceMethod, DrawPaymentMode, RateScenarioType, validateConfig } from "./models.js";
import { generatePrimeRates, getEffectiveRate } from "./rates.js";
import { pyRound } from "./rounding.js";
import { simulateHeloc } from "./simulator.js";

/**
 * Calculate a full HELOC amortization trajectory, milestones, annual summary, and cap stats.
 *
 * @param {Record<string, unknown>} params
 * @returns {{
 *   config: import('./models.js').HelocConfig,
 *   summary: Record<string, number>,
 *   milestones: Array<Record<string, unknown>>,
 *   annual_trajectory: Array<Record<string, number>>,
 *   records: Array<Record<string, unknown>>,
 *   baseline_records: Array<Record<string, unknown>>,
 *   prime_schedule: number[],
 *   cap_stats: {
 *     applied_ceiling: number,
 *     cap_hit: boolean,
 *     first_cap_month: number | null,
 *     binding_cap_source: "regulatory_ceiling" | "lifetime_rate_cap" | "equal"
 *   }
 * }}
 */
export function calculateHelocTrajectory(params) {
  const drawMonths =
    params.draw_period_months !== undefined && params.draw_period_months !== null
      ? Number(params.draw_period_months)
      : Number(params.draw_period_years ?? 10) * 12;

  const repayMonths =
    params.repayment_period_months !== undefined && params.repayment_period_months !== null
      ? Number(params.repayment_period_months)
      : Number(params.repayment_period_years ?? 20) * 12;

  const config = validateConfig({
    initial_principal: params.initial_principal,
    credit_limit: params.credit_limit,
    margin: params.margin ?? 2.0,
    intro_apr: params.intro_apr ?? null,
    intro_duration_months: params.intro_duration_months ?? 12,
    draw_period_months: drawMonths,
    repayment_period_months: repayMonths,
    lifetime_rate_cap: params.lifetime_rate_cap ?? 18.0,
    regulatory_ceiling: params.regulatory_ceiling ?? 25.0,
    monthly_prepayment: params.monthly_prepayment ?? 0.0,
    balance_method: String(
      params.balance_method ?? BalanceMethod.AVERAGE_DAILY_BALANCE,
    ).toLowerCase(),
    year_basis: Number(params.year_basis ?? 365),
    draw_payment_mode: String(
      params.draw_payment_mode ?? DrawPaymentMode.INTEREST_ONLY,
    ).toLowerCase(),
    draw_min_payment_pct: params.draw_min_payment_pct ?? 1.0,
    draw_min_payment_floor: params.draw_min_payment_floor ?? 0.0,
    cash_flow_events: params.cash_flow_events ?? [],
    closing_costs: params.closing_costs ?? 0.0,
    annual_fee: params.annual_fee ?? 0.0,
    early_closure_fee: params.early_closure_fee ?? 0.0,
    early_closure_months: params.early_closure_months ?? 36,
  });

  const totalMonths = config.draw_period_months + config.repayment_period_months;
  const rawScenario = String(params.rate_scenario ?? RateScenarioType.FLAT).toLowerCase();
  const customRates = params.custom_rates ?? null;
  const scenario =
    customRates !== null && customRates !== undefined && rawScenario === RateScenarioType.FLAT
      ? RateScenarioType.CUSTOM
      : rawScenario;

  const basePrime = Number(params.prime_rate ?? 8.5);
  const annualStep = Number(params.annual_rate_step ?? 0.5);

  const primeSchedule = generatePrimeRates({
    totalMonths,
    scenario,
    basePrime,
    annualStep,
    customRates,
  });

  const { summary, records, baselineRecords, clippedDraws } = simulateHeloc(
    config,
    primeSchedule,
  );

  // Annualized breakdown matching pandas groupby("year").agg(...)
  const annualTrajectory = [];
  if (records.length > 0) {
    let currentGroup = null;
    for (let i = 0; i < records.length; i += 1) {
      const rec = records[i];
      if (!currentGroup || currentGroup.year !== rec.year) {
        if (currentGroup) {
          annualTrajectory.push({
            year: currentGroup.year,
            start_balance: pyRound(currentGroup.startBalance, 2),
            end_balance: pyRound(currentGroup.endBalance, 2),
            avg_apr: pyRound(currentGroup.aprSum / currentGroup.count, 2),
            total_payment: pyRound(currentGroup.totalPaymentSum, 2),
            interest_paid: pyRound(currentGroup.interestSum, 2),
            principal_paid: pyRound(currentGroup.principalSum, 2),
          });
        }
        currentGroup = {
          year: rec.year,
          startBalance: rec.starting_balance,
          endBalance: rec.ending_balance,
          aprSum: rec.effective_apr,
          totalPaymentSum: rec.total_payment,
          interestSum: rec.interest_paid,
          principalSum: rec.principal_paid,
          count: 1,
        };
      } else {
        currentGroup.endBalance = rec.ending_balance;
        currentGroup.aprSum += rec.effective_apr;
        currentGroup.totalPaymentSum += rec.total_payment;
        currentGroup.interestSum += rec.interest_paid;
        currentGroup.principalSum += rec.principal_paid;
        currentGroup.count += 1;
      }
    }
    if (currentGroup) {
      annualTrajectory.push({
        year: currentGroup.year,
        start_balance: pyRound(currentGroup.startBalance, 2),
        end_balance: pyRound(currentGroup.endBalance, 2),
        avg_apr: pyRound(currentGroup.aprSum / currentGroup.count, 2),
        total_payment: pyRound(currentGroup.totalPaymentSum, 2),
        interest_paid: pyRound(currentGroup.interestSum, 2),
        principal_paid: pyRound(currentGroup.principalSum, 2),
      });
    }
  }

  // Lifecycle milestones matching trajectory_tool.py
  const milestones = [
    { event: "Loan Origination", month: 1, balance: config.initial_principal },
  ];

  if (
    config.intro_apr !== null &&
    config.intro_apr !== undefined &&
    summary.actual_months_to_payoff > config.intro_duration_months
  ) {
    const nextMonth = config.intro_duration_months + 1;
    const nextPrime =
      config.intro_duration_months < primeSchedule.length
        ? primeSchedule[config.intro_duration_months]
        : primeSchedule.length > 0
          ? primeSchedule[primeSchedule.length - 1]
          : 8.5;
    const nextRate = getEffectiveRate(nextMonth, config, nextPrime);
    milestones.push({
      event: "Introductory Rate Expiration",
      month: config.intro_duration_months,
      next_rate: pyRound(nextRate, 4),
    });
  }

  if (summary.actual_months_to_payoff > config.draw_period_months) {
    milestones.push({
      event: "Phase Shift: Repayment Period Begins",
      month: config.draw_period_months + 1,
      payment_shock_pct: summary.payment_shock_pct,
      payment_shock_amount: summary.payment_shock_amount,
    });
  }

  for (const ev of config.cash_flow_events) {
    if (ev.month <= summary.actual_months_to_payoff) {
      milestones.push({
        event: ev.event_type === "draw" ? "Scheduled Draw" : "One-Time Lump Sum",
        month: ev.month,
        amount: pyRound(ev.amount, 2),
        label: ev.label,
      });
    }
  }

  milestones.push({
    event: "Loan Payoff",
    month: summary.actual_months_to_payoff,
    balance: 0.0,
  });

  milestones.sort((a, b) => a.month - b.month);

  // Cap diagnostics for UI banner
  const appliedCeiling = Math.min(config.lifetime_rate_cap, config.regulatory_ceiling);
  const bindingCapSource =
    config.regulatory_ceiling < config.lifetime_rate_cap
      ? "regulatory_ceiling"
      : config.lifetime_rate_cap < config.regulatory_ceiling
        ? "lifetime_rate_cap"
        : "equal";

  let capHit = false;
  let firstCapMonth = null;
  for (let i = 0; i < records.length; i += 1) {
    const monthNum = records[i].month;
    const isIntro =
      config.intro_apr !== null &&
      config.intro_apr !== undefined &&
      monthNum <= config.intro_duration_months;
    const uncappedRate = isIntro
      ? config.intro_apr
      : primeSchedule[monthNum - 1] + config.margin;
    if (uncappedRate > appliedCeiling) {
      capHit = true;
      firstCapMonth = monthNum;
      break;
    }
  }

  return {
    config,
    summary,
    milestones,
    annual_trajectory: annualTrajectory,
    records,
    baseline_records: baselineRecords,
    prime_schedule: primeSchedule,
    clipped_draws: clippedDraws,
    cap_stats: {
      applied_ceiling: appliedCeiling,
      cap_hit: capHit,
      first_cap_month: firstCapMonth,
      binding_cap_source: bindingCapSource,
    },
  };
}
