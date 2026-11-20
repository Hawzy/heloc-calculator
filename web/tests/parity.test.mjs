import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BalanceMethod,
  ConfigValidationError,
  RateScenarioType,
  YearBasis,
  amortizedMonthlyInstallment,
  averageDailyBalance,
  calculateHelocTrajectory,
  dailyPeriodicRate,
  generatePrimeRates,
  getEffectiveRate,
  monthlyFinanceCharge,
  pyRound,
  simulateHeloc,
  validateConfig,
} from "../js/engine/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.resolve(__dirname, "../../tests/fixtures/golden_parity_vectors.json");
const fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf-8"));

const CURRENCY_TOLERANCE = 0.01;
const RATE_TOLERANCE = 0.0001;

test("pyRound matches IEEE-754 binary64 round-half-to-even", () => {
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(1.005, 2), 1.0);
  assert.equal(pyRound(-0.0, 2), 0);
  assert.equal(pyRound(12.345, 2), 12.35);
  assert.equal(pyRound(12.355, 2), 12.36);
  assert.equal(pyRound(-2.675, 2), -2.67);
  assert.equal(pyRound(125, -1), 120);
  assert.equal(pyRound(135, -1), 140);
});

test("formula vectors match Python core formulas", () => {
  const { formula_vectors: fv } = fixtures;

  for (const vec of fv.daily_periodic_rate) {
    const actual = dailyPeriodicRate(vec.annual_rate_pct, vec.year_basis);
    assert.ok(Math.abs(actual - vec.expected) <= 1e-12);
  }

  for (const vec of fv.average_daily_balance) {
    const actual = averageDailyBalance(vec.daily_balances);
    assert.ok(Math.abs(actual - vec.expected) <= 1e-12);
  }

  for (const vec of fv.monthly_finance_charge) {
    const actual =
      vec.days_in_cycle === null
        ? monthlyFinanceCharge(vec.balance, vec.dpr)
        : monthlyFinanceCharge(vec.balance, vec.dpr, vec.days_in_cycle);
    assert.ok(Math.abs(actual - vec.expected) <= 1e-9);
  }

  for (const vec of fv.amortized_monthly_installment) {
    const actual = amortizedMonthlyInstallment(
      vec.principal,
      vec.annual_rate_pct,
      vec.remaining_months,
    );
    assert.ok(Math.abs(actual - vec.expected) <= 1e-9);
  }
});

test("HelocConfig validation rejects invalid inputs", () => {
  const base = { initial_principal: 50000, credit_limit: 100000 };
  assert.doesNotThrow(() => validateConfig(base));

  const badCases = [
    { ...base, initial_principal: 0 },
    { ...base, initial_principal: -100 },
    { ...base, credit_limit: 0 },
    { ...base, initial_principal: 150000, credit_limit: 100000 },
    { ...base, margin: -1 },
    { ...base, intro_apr: -0.5 },
    { ...base, intro_duration_months: -1 },
    { ...base, draw_period_months: 0 },
    { ...base, repayment_period_months: 0 },
    { ...base, lifetime_rate_cap: 0 },
    { ...base, regulatory_ceiling: 0 },
    { ...base, monthly_prepayment: -50 },
    { ...base, year_basis: 366 },
    { ...base, balance_method: "invalid_method" },
  ];

  for (const bad of badCases) {
    assert.throws(() => validateConfig(bad), ConfigValidationError);
  }
});

test("all 12 golden Python scenarios match within cent parity", () => {
  assert.equal(fixtures.scenarios.length, 12);

  let maxCurrencyDelta = 0;
  let maxRateDelta = 0;

  const summaryCurrencyFields = [
    "initial_principal",
    "credit_limit",
    "total_interest_paid",
    "total_principal_paid",
    "total_payments",
    "initial_draw_payment",
    "first_repayment_payment",
    "payment_shock_amount",
    "interest_savings_vs_baseline",
  ];
  const summaryIntFields = [
    "total_months_scheduled",
    "actual_months_to_payoff",
    "months_saved_vs_baseline",
  ];
  const recordCurrencyFields = [
    "starting_balance",
    "required_payment",
    "prepayment",
    "total_payment",
    "interest_paid",
    "principal_paid",
    "ending_balance",
  ];
  const annualCurrencyFields = [
    "start_balance",
    "end_balance",
    "total_payment",
    "interest_paid",
    "principal_paid",
  ];

  for (const scenario of fixtures.scenarios) {
    const actual = calculateHelocTrajectory(scenario.params);
    const expSummary = scenario.summary;
    const actSummary = actual.summary;

    for (const key of summaryIntFields) {
      assert.equal(actSummary[key], expSummary[key], `${scenario.name}.summary.${key}`);
    }
    for (const key of summaryCurrencyFields) {
      const delta = Math.abs(actSummary[key] - expSummary[key]);
      maxCurrencyDelta = Math.max(maxCurrencyDelta, delta);
      assert.ok(
        delta <= CURRENCY_TOLERANCE,
        `${scenario.name}.summary.${key}: JS=${actSummary[key]} vs PY=${expSummary[key]} (delta=${delta})`,
      );
    }
    {
      const delta = Math.abs(actSummary.payment_shock_pct - expSummary.payment_shock_pct);
      maxCurrencyDelta = Math.max(maxCurrencyDelta, delta);
      assert.ok(
        delta <= CURRENCY_TOLERANCE,
        `${scenario.name}.summary.payment_shock_pct: JS=${actSummary.payment_shock_pct} vs PY=${expSummary.payment_shock_pct}`,
      );
    }

    assert.equal(
      actual.milestones.length,
      scenario.milestones.length,
      `${scenario.name}.milestones.length`,
    );
    for (let i = 0; i < scenario.milestones.length; i += 1) {
      const am = actual.milestones[i];
      const em = scenario.milestones[i];
      assert.equal(am.event, em.event, `${scenario.name}.milestones[${i}].event`);
      assert.equal(am.month, em.month, `${scenario.name}.milestones[${i}].month`);
      if (em.balance !== undefined) {
        assert.ok(Math.abs(am.balance - em.balance) <= CURRENCY_TOLERANCE);
      }
      if (em.next_rate !== undefined) {
        const d = Math.abs(am.next_rate - em.next_rate);
        maxRateDelta = Math.max(maxRateDelta, d);
        assert.ok(d <= RATE_TOLERANCE);
      }
      if (em.payment_shock_pct !== undefined) {
        assert.ok(Math.abs(am.payment_shock_pct - em.payment_shock_pct) <= CURRENCY_TOLERANCE);
        assert.ok(Math.abs(am.payment_shock_amount - em.payment_shock_amount) <= CURRENCY_TOLERANCE);
      }
    }

    assert.equal(
      actual.annual_trajectory.length,
      scenario.annual_trajectory.length,
      `${scenario.name}.annual_trajectory.length`,
    );
    for (let i = 0; i < scenario.annual_trajectory.length; i += 1) {
      const ar = actual.annual_trajectory[i];
      const er = scenario.annual_trajectory[i];
      assert.equal(ar.year, er.year);
      for (const key of annualCurrencyFields) {
        const d = Math.abs(ar[key] - er[key]);
        maxCurrencyDelta = Math.max(maxCurrencyDelta, d);
        assert.ok(
          d <= CURRENCY_TOLERANCE,
          `${scenario.name}.annual[${i}].${key}: JS=${ar[key]} vs PY=${er[key]}`,
        );
      }
      const aprDelta = Math.abs(ar.avg_apr - er.avg_apr);
      maxRateDelta = Math.max(maxRateDelta, aprDelta);
      assert.ok(aprDelta <= CURRENCY_TOLERANCE);
    }

    assert.equal(actual.records.length, scenario.records.length, `${scenario.name}.records.length`);
    for (let i = 0; i < scenario.records.length; i += 1) {
      const ar = actual.records[i];
      const er = scenario.records[i];
      assert.equal(ar.month, er.month);
      assert.equal(ar.year, er.year);
      assert.equal(ar.phase, er.phase);
      for (const key of recordCurrencyFields) {
        const d = Math.abs(ar[key] - er[key]);
        maxCurrencyDelta = Math.max(maxCurrencyDelta, d);
        assert.ok(
          d <= CURRENCY_TOLERANCE,
          `${scenario.name}.records[${i}].${key}: JS=${ar[key]} vs PY=${er[key]}`,
        );
      }
      const effDelta = Math.abs(ar.effective_apr - er.effective_apr);
      const primeDelta = Math.abs(ar.prime_rate - er.prime_rate);
      maxRateDelta = Math.max(maxRateDelta, effDelta, primeDelta);
      assert.ok(effDelta <= RATE_TOLERANCE);
      assert.ok(primeDelta <= RATE_TOLERANCE);
    }
  }

  console.log(
    `[parity] 12 scenarios verified — maxCurrencyDelta=$${maxCurrencyDelta.toFixed(4)}, maxRateDelta=${maxRateDelta.toFixed(6)}%`,
  );
});

test("edge-case behaviors match Python specs", () => {
  const early = fixtures.scenarios.find((s) => s.name === "early_payoff_during_draw");
  const earlyRes = calculateHelocTrajectory(early.params);
  assert.equal(earlyRes.summary.actual_months_to_payoff, 5);
  assert.equal(earlyRes.summary.payment_shock_amount, 0);
  assert.equal(earlyRes.summary.payment_shock_pct, 0);
  const earlyEvents = earlyRes.milestones.map((m) => m.event);
  assert.ok(!earlyEvents.includes("Introductory Rate Expiration"));
  assert.ok(!earlyEvents.includes("Phase Shift: Repayment Period Begins"));

  const adj = fixtures.scenarios.find((s) => s.name === "adjusted_balance_prepay");
  const adb = fixtures.scenarios.find((s) => s.name === "adb_balance_prepay");
  const adjRes = calculateHelocTrajectory(adj.params);
  const adbRes = calculateHelocTrajectory(adb.params);
  assert.ok(adjRes.summary.total_interest_paid < adbRes.summary.total_interest_paid);

  const usury = fixtures.scenarios.find((s) => s.name === "wa_usury_cap_25pct");
  const usuryRes = calculateHelocTrajectory(usury.params);
  assert.equal(usuryRes.cap_stats.applied_ceiling, 25.0);
  assert.equal(usuryRes.cap_stats.cap_hit, true);
  assert.equal(usuryRes.cap_stats.first_cap_month, 1);
  assert.equal(usuryRes.cap_stats.binding_cap_source, "regulatory_ceiling");
});

test("rates and simulator API edge guards", () => {
  const cfg = validateConfig({ initial_principal: 50000, credit_limit: 100000, margin: 1.0 });
  assert.throws(() => getEffectiveRate(0, cfg, 7.0));
  assert.equal(getEffectiveRate(1, cfg, -5.0), 0.0);
  assert.deepEqual(
    generatePrimeRates({ totalMonths: 0, scenario: RateScenarioType.FLAT, basePrime: 7.0 }),
    [],
  );

  const simRes = simulateHeloc(cfg, null);
  assert.equal(simRes.records.length, 360);
  assert.equal(simRes.baselineRecords.length, 360);
  assert.equal(BalanceMethod.PREVIOUS_BALANCE, "previous_balance");
  assert.equal(YearBasis.DAYS_360, 360);
});
