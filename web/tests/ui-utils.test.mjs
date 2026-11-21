import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { calculateHelocTrajectory } from "../js/engine/index.js";
import {
  BUILTIN_PRESETS,
  DEFAULT_SCENARIO,
  buildShareUrl,
  expandCustomRates,
  parseQueryString,
  serializeToQueryString,
} from "../js/ui/state.js";
import {
  STORAGE_KEY,
  deletePreset,
  loadSavedPresets,
  savePreset,
} from "../js/ui/presets.js";
import { CSV_COLUMNS, recordsToCsv } from "../js/ui/csv.js";
import {
  addMonthsToYearMonth,
  formatLoanMonthDate,
  formatLoanYearSpan,
  parseYearMonth,
} from "../js/ui/dates.js";
import { initThemeToggle } from "../js/ui/theme.js";
import { createAnnouncer, initFormValidation, initPopovers } from "../js/ui/a11y.js";
import { renderCharts } from "../js/ui/charts.js";
import { renderScheduleTable } from "../js/ui/table.js";

test("URL query round-trip preserves all presets including custom rates and disabled intro", () => {
  for (const preset of BUILTIN_PRESETS) {
    const qs = serializeToQueryString(preset.params);
    const { params, warnings } = parseQueryString(`?${qs}`);
    assert.deepEqual(warnings, [], `Unexpected warnings for ${preset.id}`);
    assert.deepEqual(params, preset.params);
  }

  const customParams = {
    ...DEFAULT_SCENARIO,
    intro_apr: null,
    rate_scenario: "custom",
    custom_rates: [5.0, 6.25, 7.5],
    custom_rates_mode: "monthly",
  };
  const customQs = serializeToQueryString(customParams);
  const parsedCustom = parseQueryString(`?${customQs}`);
  assert.deepEqual(parsedCustom.warnings, []);
  assert.deepEqual(parsedCustom.params, customParams);
});

test("malformed and tampered URL query strings safely fall back without NaN or throw", () => {
  const dirty =
    "?principal=-500&limit=abc&scenario=hack&introApr=NaN&customRates=foo,bar&basis=999&method=<script>&step=Infinity&prepay=-10";
  const { params, warnings } = parseQueryString(dirty);

  assert.ok(warnings.length >= 5);
  assert.equal(params.initial_principal, DEFAULT_SCENARIO.initial_principal);
  assert.equal(params.credit_limit, DEFAULT_SCENARIO.credit_limit);
  assert.equal(params.rate_scenario, DEFAULT_SCENARIO.rate_scenario);
  assert.equal(params.intro_apr, DEFAULT_SCENARIO.intro_apr);
  assert.equal(params.year_basis, DEFAULT_SCENARIO.year_basis);
  assert.equal(params.balance_method, DEFAULT_SCENARIO.balance_method);
  assert.equal(params.annual_rate_step, DEFAULT_SCENARIO.annual_rate_step);
  assert.equal(params.monthly_prepayment, DEFAULT_SCENARIO.monthly_prepayment);
  assert.equal(params.custom_rates, null);
  assert.doesNotThrow(() => calculateHelocTrajectory(params));
});

test("URL query parsing enforces principal <= credit_limit cleanly", () => {
  const { params, warnings } = parseQueryString("?principal=250000&limit=100000");
  assert.ok(warnings.length >= 1);
  assert.ok(params.initial_principal <= params.credit_limit);
  assert.doesNotThrow(() => calculateHelocTrajectory(params));
});

test("buildShareUrl preserves subpath pathname for GitHub Pages", () => {
  const url = buildShareUrl(DEFAULT_SCENARIO, {
    origin: "https://hawzy.github.io",
    pathname: "/heloc-calculator/",
  });
  assert.ok(url.startsWith("https://hawzy.github.io/heloc-calculator/?"));
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/heloc-calculator/");
  assert.equal(parsed.searchParams.get("principal"), "50000");
});

test("expandCustomRates validates and expands annual or monthly rate lists", () => {
  const annual = expandCustomRates("6.0, 6.5\n7.0", "annual");
  assert.equal(annual.error, null);
  assert.equal(annual.rates.length, 36);
  assert.equal(annual.rates[0], 6.0);
  assert.equal(annual.rates[12], 6.5);
  assert.equal(annual.rates[24], 7.0);

  const monthly = expandCustomRates("5.0, 6.25, 7.5", "monthly");
  assert.equal(monthly.error, null);
  assert.deepEqual(monthly.rates, [5.0, 6.25, 7.5]);

  const invalid = expandCustomRates("6.0, abc, 7.0", "annual");
  assert.ok(invalid.error !== null);
  assert.deepEqual(invalid.rates, []);
});

test("localStorage presets save, load, delete, and survive corrupt or blocked storage", () => {
  const store = new Map();
  const mockStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };

  assert.deepEqual(loadSavedPresets(mockStorage), []);

  const saved = savePreset(mockStorage, "My Refi Plan", DEFAULT_SCENARIO);
  assert.equal(saved.error, null);
  assert.equal(saved.presets.length, 1);
  assert.equal(saved.presets[0].name, "My Refi Plan");

  const loaded = loadSavedPresets(mockStorage);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].params, DEFAULT_SCENARIO);

  const deleted = deletePreset(mockStorage, saved.saved.id);
  assert.equal(deleted.error, null);
  assert.equal(deleted.presets.length, 0);

  // Corrupt JSON recovery
  store.set(STORAGE_KEY, "{not-valid-json");
  assert.deepEqual(loadSavedPresets(mockStorage), []);

  // Throwing SecurityError storage degrades gracefully
  const blockedStorage = {
    getItem: () => {
      throw new DOMException("Blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("Blocked", "SecurityError");
    },
  };
  assert.deepEqual(loadSavedPresets(blockedStorage), []);
  const blockedSave = savePreset(blockedStorage, "Test", DEFAULT_SCENARIO);
  assert.ok(blockedSave.error !== null);
});

test("recordsToCsv outputs exact 12-column header and formatted rows", () => {
  const result = calculateHelocTrajectory({
    initial_principal: 10000,
    credit_limit: 50000,
    margin: 2.0,
    intro_apr: 0.99,
    intro_duration_months: 12,
    prime_rate: 7.0,
    rate_scenario: "flat",
    draw_period_months: 120,
    repayment_period_months: 240,
    monthly_prepayment: 2000,
  });

  const csv = recordsToCsv(result.records);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  assert.equal(lines.length, 1 + result.records.length);
  assert.equal(lines[1].split(",").length, 12);
  assert.ok(lines[1].startsWith("1,1,draw,10000.00,0.9900,7.0000,"));
});

test("UI module exports load cleanly as ES modules", () => {
  assert.equal(typeof initThemeToggle, "function");
  assert.equal(typeof createAnnouncer, "function");
  assert.equal(typeof initFormValidation, "function");
  assert.equal(typeof initPopovers, "function");
  assert.equal(typeof renderCharts, "function");
  assert.equal(typeof renderScheduleTable, "function");
});

test("location-agnostic calendar date arithmetic works across year boundaries", () => {
  assert.deepEqual(parseYearMonth("2026-11"), { year: 2026, month: 11 });
  assert.equal(parseYearMonth("2026-13"), null);
  assert.equal(parseYearMonth("invalid"), null);

  assert.deepEqual(addMonthsToYearMonth({ year: 2026, month: 11 }, 2), { year: 2027, month: 1 });
  assert.equal(formatLoanMonthDate("2026-11", 1), "Nov 2026");
  assert.equal(formatLoanMonthDate("2026-11", 14), "Dec 2027");
  assert.equal(formatLoanMonthDate(null, 14), null);
  assert.equal(formatLoanYearSpan("2026-11", 1, 12), "Nov 2026–Oct 2027");
  assert.equal(formatLoanYearSpan("2026-11", 13, 13), "Nov 2027");
});

test("v2 URL query round-trip preserves draw rules, staged events, fees, dates, and HELoan comparison", () => {
  const v2Params = {
    ...DEFAULT_SCENARIO,
    intro_apr: null,
    draw_payment_mode: "pct_of_balance",
    draw_min_payment_pct: 1.5,
    draw_min_payment_floor: 150,
    cash_flow_events: [
      { month: 14, amount: 15000, event_type: "draw", label: "Kitchen Reno" },
      { month: 24, amount: 5000, event_type: "lump_sum", label: "Tax Refund" },
    ],
    closing_costs: 650,
    annual_fee: 75,
    early_closure_fee: 500,
    early_closure_months: 36,
    start_year_month: "2026-11",
    heloan_enabled: true,
    heloan_apr: 7.25,
    heloan_term_years: 15,
    heloan_closing_costs: 450,
  };

  const qs = serializeToQueryString(v2Params);
  const parsed = parseQueryString(`?${qs}`);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.params, v2Params);

  // Tampered v2 query params safely trigger warnings without throwing
  const bad = parseQueryString("?start=bad&drawMode=foo&events=draw:9999:5000:TooLate|draw:5:1000:OK");
  assert.ok(bad.warnings.length >= 3);
  assert.equal(bad.params.cash_flow_events.length, 1);
  assert.equal(bad.params.cash_flow_events[0].month, 5);
});

test("recordsToCsv appends calendar_month only when startYearMonth is supplied", () => {
  const result = calculateHelocTrajectory({
    initial_principal: 10000,
    credit_limit: 50000,
    monthly_prepayment: 2000,
  });
  const baseCsv = recordsToCsv(result.records);
  assert.equal(baseCsv.split("\r\n")[0].split(",").length, 12);

  const calCsv = recordsToCsv(result.records, { startYearMonth: "2026-11" });
  const lines = calCsv.trimEnd().split("\r\n");
  assert.equal(lines[0], `${CSV_COLUMNS.join(",")},calendar_month`);
  assert.ok(lines[1].endsWith(",2026-11"));
  assert.ok(lines[3].endsWith(",2027-01"));
});

test("HTML decimal numeric inputs use step='any' and helper drawers stay collapsed on initial load", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const html = fs.readFileSync(path.resolve(__dirname, "../index.html"), "utf-8");
  const decimalFields = [
    "initial_principal",
    "credit_limit",
    "monthly_prepayment",
    "prime_rate",
    "margin",
    "annual_rate_step",
    "intro_apr",
    "lifetime_rate_cap",
    "regulatory_ceiling",
    "draw_min_payment_pct",
    "draw_min_payment_floor",
    "closing_costs",
    "annual_fee",
    "early_closure_fee",
    "heloan_apr",
    "heloan_closing_costs",
  ];

  for (const name of decimalFields) {
    const tagMatch = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "s"));
    assert.ok(tagMatch, `Missing input tag for ${name}`);
    assert.match(tagMatch[0], /\bstep="any"/, `Input ${name} must use step="any"`);
  }

  for (const drawerId of [
    "drawer-cltv",
    "drawer-solver",
    "drawer-events",
    "drawer-draw-heloan",
    "drawer-dates-fees",
    "drawer-advanced",
  ]) {
    const tagMatch = html.match(new RegExp(`<details[^>]*id="${drawerId}"[^>]*>`));
    assert.ok(tagMatch, `Missing details drawer ${drawerId}`);
    assert.doesNotMatch(tagMatch[0], /\bopen\b/, `Drawer ${drawerId} must start collapsed`);
  }
});
