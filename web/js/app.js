/**
 * Main client-side application controller for the HELOC Trajectory Calculator.
 */

import {
  ConfigValidationError,
  calculateHelocTrajectory,
  compareFixedHomeEquityLoan,
  estimateBorrowingPower,
  generatePrimeRates,
  solveMonthlyPrepayment,
  validateConfig,
} from "./engine/index.js";
import { createAnnouncer, initFormValidation, initPopovers } from "./ui/a11y.js";
import { renderCharts } from "./ui/charts.js";
import { recordsToCsv, triggerCsvDownload } from "./ui/csv.js";
import { formatLoanMonthDate, formatYearMonthLabel, parseYearMonth } from "./ui/dates.js";
import { deletePreset, loadSavedPresets, savePreset } from "./ui/presets.js";
import {
  BUILTIN_PRESETS,
  DEFAULT_SCENARIO,
  buildShareUrl,
  expandCustomRates,
  parseQueryString,
} from "./ui/state.js";
import { renderScheduleTable } from "./ui/table.js";
import { initThemeToggle } from "./ui/theme.js";

const moneyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyWholeFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function el(tag, className = null, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function formatMonthsAndYears(months) {
  const yrs = (months / 12).toFixed(1);
  return `${months} mo${months === 1 ? "" : "s"} (${yrs} yrs)`;
}

function syncRangeStyles(rangeEl, value, textLabel) {
  const min = Number(rangeEl.min || 0);
  const max = Number(rangeEl.max || 100);
  const clamped = Math.min(max, Math.max(min, Number(value) || 0));
  rangeEl.value = String(clamped);
  rangeEl.style.setProperty("--attr-min", String(min));
  rangeEl.style.setProperty("--attr-max", String(max));
  rangeEl.style.setProperty("--control-value", String(clamped));
  if (textLabel) {
    rangeEl.setAttribute("aria-valuetext", textLabel);
  }
}

function main() {
  const form = document.getElementById("heloc-form");
  const announcer = createAnnouncer();
  const validation = initFormValidation(form, announcer);
  initPopovers(document);
  initThemeToggle(document.getElementById("theme-toggle"));

  // Primary form inputs & sliders
  const principalEl = document.getElementById("initial-principal");
  const principalRangeEl = document.getElementById("principal-range");
  const limitEl = document.getElementById("credit-limit");
  const utilBarEl = document.getElementById("utilization-bar");
  const utilTextEl = document.getElementById("utilization-text");
  const drawDurEl = document.getElementById("draw-duration");
  const drawUnitEl = document.getElementById("draw-unit");
  const repayDurEl = document.getElementById("repay-duration");
  const repayUnitEl = document.getElementById("repay-unit");
  const prepayEl = document.getElementById("monthly-prepayment");
  const prepayRangeEl = document.getElementById("prepayment-range");
  const primeEl = document.getElementById("prime-rate");
  const primeRangeEl = document.getElementById("prime-range");
  const marginEl = document.getElementById("margin-rate");
  const annualStepGroup = document.getElementById("annual-step-group");
  const annualStepEl = document.getElementById("annual-rate-step");
  const customRatesGroup = document.getElementById("custom-rates-group");
  const customRatesEl = document.getElementById("custom-rates-input");

  // Advanced / caps
  const introEnabledEl = document.getElementById("intro-enabled");
  const introAprEl = document.getElementById("intro-apr");
  const introMonthsEl = document.getElementById("intro-months");
  const capEl = document.getElementById("lifetime-cap");
  const usuryEl = document.getElementById("regulatory-ceiling");
  const methodEl = document.getElementById("balance-method");
  const badgeAdvanced = document.getElementById("badge-advanced");

  // Drawer 1: CLTV Estimator
  const homeValueEl = document.getElementById("home-value");
  const firstMortgageEl = document.getElementById("first-mortgage");
  const maxCltvEl = document.getElementById("max-cltv");
  const cltvReadoutEl = document.getElementById("cltv-readout");
  const applyCltvLimitBtn = document.getElementById("apply-cltv-limit-btn");
  const badgeCltv = document.getElementById("badge-cltv");

  // Drawer 2: Target Payoff Goal Solver
  const goalTargetValEl = document.getElementById("goal-target-val");
  const goalTargetUnitEl = document.getElementById("goal-target-unit");
  const solveGoalBtn = document.getElementById("solve-goal-btn");
  const solveZeroShockBtn = document.getElementById("solve-zero-shock-btn");
  const solverResultEl = document.getElementById("solver-result");
  const solverResultTextEl = document.getElementById("solver-result-text");
  const applySolverBtn = document.getElementById("apply-solver-btn");
  const badgeSolver = document.getElementById("badge-solver");

  // Drawer 3: Planned Draws & Lump Sums
  const eventTypeEl = document.getElementById("event-type");
  const eventMonthEl = document.getElementById("event-month");
  const eventAmountEl = document.getElementById("event-amount");
  const eventLabelEl = document.getElementById("event-label");
  const addEventBtn = document.getElementById("add-event-btn");
  const clearEventsBtn = document.getElementById("clear-events-btn");
  const eventDraftErrorEl = document.getElementById("event-draft-error");
  const eventsListEl = document.getElementById("events-list");
  const badgeEvents = document.getElementById("badge-events");

  // Drawer 4: Draw Min Rules & Fixed HELoan Compare
  const drawModeEl = document.getElementById("draw-payment-mode");
  const drawMinPctGroup = document.getElementById("draw-min-pct-group");
  const drawMinPctEl = document.getElementById("draw-min-pct");
  const drawMinFloorGroup = document.getElementById("draw-min-floor-group");
  const drawMinFloorEl = document.getElementById("draw-min-floor");
  const heloanEnabledEl = document.getElementById("heloan-enabled");
  const heloanFieldsGroup = document.getElementById("heloan-fields-group");
  const heloanAprEl = document.getElementById("heloan-apr");
  const heloanTermYearsEl = document.getElementById("heloan-term-years");
  const heloanClosingCostsEl = document.getElementById("heloan-closing-costs");
  const badgeDrawHeloan = document.getElementById("badge-draw-heloan");

  // Drawer 5: Start Date & Fees
  const startMonthEl = document.getElementById("start-month");
  const startYearEl = document.getElementById("start-year");
  const closingCostsEl = document.getElementById("closing-costs");
  const annualFeeEl = document.getElementById("annual-fee");
  const earlyClosureFeeEl = document.getElementById("early-closure-fee");
  const earlyClosureMonthsEl = document.getElementById("early-closure-months");
  const badgeDatesFees = document.getElementById("badge-dates-fees");

  // Output elements
  const printSummaryBanner = document.getElementById("print-summary-banner");
  const validationBanner = document.getElementById("validation-banner");
  const validationBannerText = document.getElementById("validation-banner-text");
  const urlWarningBanner = document.getElementById("url-warning-banner");
  const urlWarningText = document.getElementById("url-warning-text");

  const kpiDrawPayment = document.getElementById("kpi-draw-payment");
  const kpiDrawSub = document.getElementById("kpi-draw-sub");
  const kpiRepayPayment = document.getElementById("kpi-repay-payment");
  const kpiRepaySub = document.getElementById("kpi-repay-sub");
  const kpiShockCard = document.getElementById("kpi-shock-card");
  const kpiShockAmount = document.getElementById("kpi-shock-amount");
  const kpiShockBadge = document.getElementById("kpi-shock-badge");
  const kpiShockPct = document.getElementById("kpi-shock-pct");
  const kpiTotalInterest = document.getElementById("kpi-total-interest");
  const kpiTotalOutlay = document.getElementById("kpi-total-outlay");
  const kpiPayoffMonths = document.getElementById("kpi-payoff-months");
  const kpiPayoffSub = document.getElementById("kpi-payoff-sub");
  const kpiSavingsAmount = document.getElementById("kpi-savings-amount");
  const kpiSavingsMonths = document.getElementById("kpi-savings-months");

  const capStatusStrip = document.getElementById("cap-status-strip");
  const feeSummaryStrip = document.getElementById("fee-summary-strip");
  const compareStrip = document.getElementById("compare-strip");
  const compareSubtitle = document.getElementById("compare-subtitle");
  const compareDeltas = document.getElementById("compare-deltas");
  const heloanCompareSection = document.getElementById("heloan-compare-section");
  const heloanCompareSubtitle = document.getElementById("heloan-compare-subtitle");
  const heloanCompareGrid = document.getElementById("heloan-compare-grid");
  const milestonesList = document.getElementById("milestones-list");

  const chartBalanceEl = document.getElementById("chart-balance");
  const chartPaymentEl = document.getElementById("chart-payment");
  const chartInterestEl = document.getElementById("chart-interest");

  // Presets & schedule controls
  const builtinContainer = document.getElementById("builtin-presets");
  const savedRow = document.getElementById("saved-presets-row");
  const savedContainer = document.getElementById("saved-presets-list");
  const presetNameEl = document.getElementById("preset-name-input");
  const savePresetBtn = document.getElementById("save-preset-btn");
  const compareSelectEl = document.getElementById("compare-select");
  const resetBtn = document.getElementById("reset-btn");
  const shareBtn = document.getElementById("share-btn");
  const shareBtnLabel = document.getElementById("share-btn-label");
  const printBtn = document.getElementById("print-btn");

  const viewAnnualBtn = document.getElementById("view-annual-btn");
  const viewMonthlyBtn = document.getElementById("view-monthly-btn");
  const phaseFilterEl = document.getElementById("phase-filter");
  const downloadCsvBtn = document.getElementById("download-csv-btn");
  const scheduleRowCountEl = document.getElementById("schedule-row-count");
  const scheduleContainerEl = document.getElementById("schedule-container");

  // App state
  const { params: initialParams, warnings: urlWarnings } = parseQueryString(
    window.location.search,
    DEFAULT_SCENARIO,
  );
  let activeParams = {
    ...DEFAULT_SCENARIO,
    ...initialParams,
    cash_flow_events: (initialParams.cash_flow_events ?? []).map((ev) => ({ ...ev })),
  };
  let lastValidResult = calculateHelocTrajectory(activeParams);
  let savedPresets = loadSavedPresets();
  let activeBuiltinId = null;
  let rememberedIntroApr = activeParams.intro_apr ?? DEFAULT_SCENARIO.intro_apr;
  let scheduleView = "annual";
  let phaseFilter = "all";
  let shareResetTimer = null;

  if (urlWarnings.length > 0) {
    urlWarningBanner.hidden = false;
    urlWarningText.textContent = `Adjusted URL parameters: ${urlWarnings.join(" ")}`;
  }

  function detectMatchingBuiltin(params) {
    for (const preset of BUILTIN_PRESETS) {
      const keys = Object.keys(preset.params);
      const matches = keys.every((k) => {
        const a = params[k];
        const b = preset.params[k];
        if (Array.isArray(a) || Array.isArray(b)) {
          return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
        }
        return a === b;
      });
      if (matches) return preset.id;
    }
    return null;
  }

  function updateConditionalVisibility(scenario) {
    annualStepGroup.hidden = scenario !== "rising";
    customRatesGroup.hidden = scenario !== "custom";
  }

  function updateIntroFieldStates() {
    const enabled = introEnabledEl.checked;
    introAprEl.disabled = !enabled;
    introMonthsEl.disabled = !enabled;
  }

  function updateDrawModeStates() {
    const mode = drawModeEl.value;
    const needsPct = mode === "pct_of_balance";
    const needsFloor = mode === "pct_of_balance" || mode === "fixed_floor";
    drawMinPctGroup.hidden = !needsPct;
    drawMinPctEl.disabled = !needsPct;
    drawMinFloorGroup.hidden = !needsFloor;
    drawMinFloorEl.disabled = !needsFloor;
  }

  function updateHeloanFieldStates() {
    const enabled = heloanEnabledEl.checked;
    heloanFieldsGroup.hidden = !enabled;
    heloanAprEl.disabled = !enabled;
    heloanTermYearsEl.disabled = !enabled;
    heloanClosingCostsEl.disabled = !enabled;
  }

  function updateStartDateFieldState() {
    startYearEl.disabled = startMonthEl.value === "";
  }

  function updateUtilizationMeter(principal, limit) {
    const ratio =
      Number.isFinite(principal) && Number.isFinite(limit) && limit > 0
        ? Math.max(0, (principal / limit) * 100)
        : 0;
    utilBarEl.value = Math.min(100, ratio);
    utilTextEl.textContent = `${ratio.toFixed(1)}%`;
  }

  function syncPrincipalRangeBounds(principal, limit) {
    const maxVal = Number.isFinite(limit) && limit >= 1000 ? limit : 350000;
    principalRangeEl.max = String(maxVal);
    principalRangeEl.step = String(maxVal >= 250000 ? 2500 : maxVal >= 50000 ? 1000 : 250);
    const val = Number.isFinite(principal) ? principal : activeParams.initial_principal;
    syncRangeStyles(principalRangeEl, val, moneyWholeFmt.format(Math.max(0, val)));
  }

  function updateCltvReadout() {
    const hv = Number(homeValueEl.value);
    const mtg = Number(firstMortgageEl.value);
    const maxCltv = Number(maxCltvEl.value);
    cltvReadoutEl.replaceChildren();

    if (
      !Number.isFinite(hv) ||
      hv <= 0 ||
      !Number.isFinite(mtg) ||
      mtg < 0 ||
      !Number.isFinite(maxCltv) ||
      maxCltv <= 0 ||
      maxCltv > 100
    ) {
      cltvReadoutEl.dataset.warning = "true";
      cltvReadoutEl.append(el("p", null, "Enter valid home value (> $0), mortgage (≥ $0), and max CLTV (1%–100%)."));
      applyCltvLimitBtn.disabled = true;
      badgeCltv.textContent = "CLTV";
      return null;
    }

    const cltv = estimateBorrowingPower(
      hv,
      mtg,
      maxCltv,
      activeParams.credit_limit,
      activeParams.initial_principal,
    );
    cltvReadoutEl.dataset.warning = String(cltv.exceeds_max_cltv || cltv.max_heloc_limit <= 0);
    cltvReadoutEl.append(
      el(
        "p",
        null,
        `Current Equity: ${moneyWholeFmt.format(cltv.current_equity)} · Current LTV: ${cltv.current_ltv_pct.toFixed(1)}%`,
      ),
      el(
        "p",
        null,
        `Max Eligible Line (@ ${cltv.max_cltv_pct.toFixed(1)}% CLTV): ${moneyWholeFmt.format(cltv.max_heloc_limit)}`,
      ),
      el(
        "p",
        null,
        `Projected CLTV (Limit / Drawn): ${cltv.projected_cltv_pct.toFixed(1)}% / ${cltv.drawn_cltv_pct.toFixed(1)}%${cltv.exceeds_max_cltv ? " [!] Exceeds Max CLTV" : ""}`,
      ),
    );
    badgeCltv.textContent = `${cltv.max_cltv_pct.toFixed(0)}% · Max ${moneyWholeFmt.format(cltv.max_heloc_limit)}`;
    applyCltvLimitBtn.disabled = cltv.max_heloc_limit <= 0;
    return cltv;
  }

  function renderEventsList() {
    const events = activeParams.cash_flow_events ?? [];
    eventsListEl.replaceChildren();
    clearEventsBtn.hidden = events.length === 0;
    badgeEvents.textContent = events.length > 0 ? `${events.length} active` : "None";

    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      const li = el("li", "event-row");
      const meta = el("div", "event-row-meta");
      const isDrawEv = ev.event_type === "draw";
      meta.append(
        el(
          "span",
          `event-tag ${isDrawEv ? "event-tag--draw" : "event-tag--lump"}`,
          isDrawEv ? "+Draw" : "−Lump",
        ),
      );
      const calStr = formatLoanMonthDate(activeParams.start_year_month, ev.month);
      const when = calStr ? `Mo ${ev.month} (${calStr})` : `Mo ${ev.month}`;
      const labelPart = ev.label ? ` · ${ev.label}` : "";
      meta.append(el("span", "tabular-nums", `${when}: ${moneyWholeFmt.format(ev.amount)}${labelPart}`));

      const delBtn = el("button", "event-remove-btn", "×");
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", `Remove ${isDrawEv ? "draw" : "lump sum"} in month ${ev.month}`);
      delBtn.addEventListener("click", () => {
        activeParams = {
          ...activeParams,
          cash_flow_events: activeParams.cash_flow_events.filter((_, idx) => idx !== i),
        };
        activeBuiltinId = detectMatchingBuiltin(activeParams);
        runAndRender(true);
        renderEventsList();
        announcer.announce(`Removed scheduled event in month ${ev.month}.`);
      });

      li.append(meta, delBtn);
      eventsListEl.append(li);
    }
  }

  function updateDrawerBadges(params, result) {
    const { config, summary } = result;
    const introTag =
      config.intro_apr !== null && config.intro_apr !== undefined
        ? `${config.intro_apr}% intro`
        : "No intro";
    badgeAdvanced.textContent = `${introTag} · ${config.lifetime_rate_cap}% cap · ${config.year_basis}d`;

    const modeBadgeMap = {
      interest_only: "Interest-only",
      pct_of_balance: `${config.draw_min_payment_pct}% min`,
      fixed_floor: `${moneyWholeFmt.format(config.draw_min_payment_floor)} floor`,
    };
    const heloanTag = params.heloan_enabled ? ` vs ${params.heloan_apr}% Fixed` : "";
    badgeDrawHeloan.textContent = `${modeBadgeMap[config.draw_payment_mode]}${heloanTag}`;

    const startYm = parseYearMonth(params.start_year_month);
    const startTag = startYm ? formatYearMonthLabel(startYm) : "Relative mos";
    const feeTag = summary.total_fees > 0 ? `${moneyWholeFmt.format(summary.total_fees)} fees` : "$0 fees";
    badgeDatesFees.textContent = `${startTag} · ${feeTag}`;
  }

  function populateForm(params) {
    principalEl.value = String(params.initial_principal);
    limitEl.value = String(params.credit_limit);
    syncPrincipalRangeBounds(params.initial_principal, params.credit_limit);

    if (params.draw_period_months % 12 === 0) {
      drawUnitEl.value = "years";
      drawDurEl.value = String(params.draw_period_months / 12);
    } else {
      drawUnitEl.value = "months";
      drawDurEl.value = String(params.draw_period_months);
    }

    if (params.repayment_period_months % 12 === 0) {
      repayUnitEl.value = "years";
      repayDurEl.value = String(params.repayment_period_months / 12);
    } else {
      repayUnitEl.value = "months";
      repayDurEl.value = String(params.repayment_period_months);
    }

    prepayEl.value = String(params.monthly_prepayment);
    syncRangeStyles(
      prepayRangeEl,
      params.monthly_prepayment,
      `${moneyWholeFmt.format(params.monthly_prepayment)} per month`,
    );

    primeEl.value = String(params.prime_rate);
    syncRangeStyles(primeRangeEl, params.prime_rate, `${params.prime_rate}%`);
    marginEl.value = String(params.margin);

    const scenarioRadio = form.querySelector(
      `input[name="rate_scenario"][value="${params.rate_scenario}"]`,
    );
    if (scenarioRadio) scenarioRadio.checked = true;
    annualStepEl.value = String(params.annual_rate_step);

    let customMode = params.custom_rates_mode === "monthly" ? "monthly" : "annual";
    let displayRates = Array.isArray(params.custom_rates) ? params.custom_rates : null;
    if (displayRates && customMode === "annual") {
      const canCollapse =
        displayRates.length > 0 &&
        displayRates.length % 12 === 0 &&
        Array.from({ length: displayRates.length / 12 }, (_, y) =>
          displayRates.slice(y * 12, (y + 1) * 12).every((v) => v === displayRates[y * 12]),
        ).every(Boolean);
      if (canCollapse) {
        displayRates = Array.from(
          { length: displayRates.length / 12 },
          (_, y) => displayRates[y * 12],
        );
      } else {
        customMode = "monthly";
      }
    }
    const modeRadio = form.querySelector(`input[name="custom_rates_mode"][value="${customMode}"]`);
    if (modeRadio) modeRadio.checked = true;
    customRatesEl.value = displayRates ? displayRates.join(", ") : "";

    const hasIntro = params.intro_apr !== null && params.intro_apr !== undefined;
    introEnabledEl.checked = hasIntro;
    if (hasIntro) {
      rememberedIntroApr = params.intro_apr;
    }
    introAprEl.value = String(hasIntro ? params.intro_apr : rememberedIntroApr);
    introMonthsEl.value = String(params.intro_duration_months);
    updateIntroFieldStates();

    capEl.value = String(params.lifetime_rate_cap);
    usuryEl.value = String(params.regulatory_ceiling);
    methodEl.value = params.balance_method;

    const basisRadio = form.querySelector(`input[name="year_basis"][value="${params.year_basis}"]`);
    if (basisRadio) basisRadio.checked = true;

    // v2 Draw payment rule & HELoan comparison
    drawModeEl.value = params.draw_payment_mode ?? "interest_only";
    drawMinPctEl.value = String(params.draw_min_payment_pct ?? 1.0);
    drawMinFloorEl.value = String(params.draw_min_payment_floor ?? 0);
    updateDrawModeStates();

    heloanEnabledEl.checked = Boolean(params.heloan_enabled);
    heloanAprEl.value = String(params.heloan_apr ?? DEFAULT_SCENARIO.heloan_apr);
    heloanTermYearsEl.value = String(params.heloan_term_years ?? DEFAULT_SCENARIO.heloan_term_years);
    heloanClosingCostsEl.value = String(params.heloan_closing_costs ?? 0);
    updateHeloanFieldStates();

    // v2 Calendar start date & fee ledger
    const parsedStart = parseYearMonth(params.start_year_month);
    if (parsedStart) {
      startMonthEl.value = String(parsedStart.month).padStart(2, "0");
      startYearEl.value = String(parsedStart.year);
    } else {
      startMonthEl.value = "";
      if (!startYearEl.value) startYearEl.value = "2026";
    }
    updateStartDateFieldState();

    closingCostsEl.value = String(params.closing_costs ?? 0);
    annualFeeEl.value = String(params.annual_fee ?? 0);
    earlyClosureFeeEl.value = String(params.early_closure_fee ?? 0);
    earlyClosureMonthsEl.value = String(params.early_closure_months ?? 36);

    updateConditionalVisibility(params.rate_scenario);
    updateUtilizationMeter(params.initial_principal, params.credit_limit);

    // Clear residual validation markers when programmatically populating
    form.querySelectorAll("input, select, textarea").forEach((ctrl) => {
      if (validation.isMainControl(ctrl)) {
        validation.clearFieldError(ctrl);
      }
    });
    validationBanner.hidden = true;
    eventDraftErrorEl.hidden = true;
    solverResultEl.hidden = true;
    badgeSolver.textContent = "Solve prepay";
    renderEventsList();
  }

  function renderBuiltinPills() {
    builtinContainer.replaceChildren();
    for (const preset of BUILTIN_PRESETS) {
      const btn = el("button", "preset-pill", preset.label);
      btn.type = "button";
      btn.title = preset.description;
      btn.setAttribute("aria-pressed", String(activeBuiltinId === preset.id));
      btn.addEventListener("click", () => {
        activeParams = {
          ...DEFAULT_SCENARIO,
          ...preset.params,
          cash_flow_events: (preset.params.cash_flow_events ?? []).map((ev) => ({ ...ev })),
        };
        activeBuiltinId = preset.id;
        populateForm(activeParams);
        runAndRender(true);
        announcer.announce(`Loaded benchmark scenario: ${preset.label}`);
      });
      builtinContainer.append(btn);
    }
  }

  function renderSavedPresetsList() {
    savedContainer.replaceChildren();
    savedRow.hidden = savedPresets.length === 0;
    for (const item of savedPresets) {
      const chip = el("div", "saved-chip");
      const loadBtn = el("button", "saved-chip-load", item.name);
      loadBtn.type = "button";
      loadBtn.setAttribute("aria-label", `Load saved scenario ${item.name}`);
      loadBtn.addEventListener("click", () => {
        activeParams = {
          ...DEFAULT_SCENARIO,
          ...item.params,
          cash_flow_events: (item.params.cash_flow_events ?? []).map((ev) => ({ ...ev })),
        };
        activeBuiltinId = detectMatchingBuiltin(activeParams);
        populateForm(activeParams);
        runAndRender(true);
        announcer.announce(`Loaded saved scenario: ${item.name}`);
      });

      const delBtn = el("button", "saved-chip-delete", "×");
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", `Delete saved scenario ${item.name}`);
      delBtn.addEventListener("click", () => {
        const res = deletePreset(undefined, item.id);
        savedPresets = res.presets;
        renderSavedPresetsList();
        renderCompareOptions();
        renderComparisonStrip();
        announcer.announce(`Deleted saved scenario: ${item.name}`);
      });

      chip.append(loadBtn, delBtn);
      savedContainer.append(chip);
    }
  }

  function renderCompareOptions() {
    const previous = compareSelectEl.value;
    compareSelectEl.replaceChildren();
    compareSelectEl.append(new Option("None (Active only)", ""));

    const builtinGroup = document.createElement("optgroup");
    builtinGroup.label = "Benchmarks";
    for (const preset of BUILTIN_PRESETS) {
      builtinGroup.append(new Option(preset.label, `builtin:${preset.id}`));
    }
    compareSelectEl.append(builtinGroup);

    if (savedPresets.length > 0) {
      const savedGroup = document.createElement("optgroup");
      savedGroup.label = "Saved Locally";
      for (const item of savedPresets) {
        savedGroup.append(new Option(item.name, `saved:${item.id}`));
      }
      compareSelectEl.append(savedGroup);
    }

    if (Array.from(compareSelectEl.options).some((opt) => opt.value === previous)) {
      compareSelectEl.value = previous;
    } else {
      compareSelectEl.value = "";
    }
  }

  function resolveComparisonTarget() {
    const val = compareSelectEl.value;
    if (!val) return null;
    if (val.startsWith("builtin:")) {
      const id = val.slice("builtin:".length);
      const found = BUILTIN_PRESETS.find((p) => p.id === id);
      return found ? { label: found.label, params: found.params } : null;
    }
    if (val.startsWith("saved:")) {
      const id = val.slice("saved:".length);
      const found = savedPresets.find((p) => p.id === id);
      return found ? { label: found.name, params: found.params } : null;
    }
    return null;
  }

  function renderComparisonStrip() {
    const target = resolveComparisonTarget();
    if (!target) {
      compareStrip.hidden = true;
      compareDeltas.replaceChildren();
      return;
    }

    const baseRes = calculateHelocTrajectory({ ...DEFAULT_SCENARIO, ...target.params });
    const cur = lastValidResult.summary;
    const ref = baseRes.summary;

    const intDelta = cur.total_interest_paid - ref.total_interest_paid;
    const monthsDelta = cur.actual_months_to_payoff - ref.actual_months_to_payoff;
    const shockDelta = cur.payment_shock_amount - ref.payment_shock_amount;
    const drawDelta = cur.initial_draw_payment - ref.initial_draw_payment;

    const fmtSignedMoney = (v) => `${v >= 0 ? "+" : "-"}${moneyFmt.format(Math.abs(v))}`;
    const fmtSignedMonths = (v) => `${v >= 0 ? "+" : ""}${v} mos`;

    compareSubtitle.textContent = `Active scenario minus "${target.label}"`;
    compareDeltas.replaceChildren();

    const items = [
      { label: "Total Interest Delta", val: fmtSignedMoney(intDelta) },
      { label: "Payoff Horizon Delta", val: fmtSignedMonths(monthsDelta) },
      { label: "Payment Shock Delta", val: fmtSignedMoney(shockDelta) },
      { label: "Initial Draw Pmt Delta", val: fmtSignedMoney(drawDelta) },
    ];
    for (const item of items) {
      const card = el("div", "delta-card");
      card.append(
        el("span", "delta-label", item.label),
        el("span", "delta-value tabular-nums", item.val),
      );
      compareDeltas.append(card);
    }
    compareStrip.hidden = false;
  }

  function renderHeloanComparison(result) {
    heloanCompareGrid.replaceChildren();
    if (!activeParams.heloan_enabled) {
      heloanCompareSection.hidden = true;
      return;
    }

    const { summary } = result;
    const heloan = compareFixedHomeEquityLoan(
      summary.initial_principal,
      Number(activeParams.heloan_apr),
      Number(activeParams.heloan_term_years) * 12,
      summary,
      Number(activeParams.heloan_closing_costs ?? 0),
    );

    const drawNote =
      summary.total_additional_draws > 0
        ? ` · Fixed HELoan models initial ${moneyWholeFmt.format(summary.initial_principal)} lump sum only`
        : "";
    heloanCompareSubtitle.textContent =
      `Fixed ${heloan.fixed_apr.toFixed(2)}% APR for ${activeParams.heloan_term_years} yrs vs. Active HELOC${drawNote}`;

    const fmtDeltaInterest =
      heloan.interest_delta_vs_heloc >= 0
        ? `Fixed saves ${moneyFmt.format(heloan.interest_delta_vs_heloc)}`
        : `HELOC saves ${moneyFmt.format(Math.abs(heloan.interest_delta_vs_heloc))}`;
    const fmtDeltaCost =
      heloan.total_cost_delta_vs_heloc >= 0
        ? `Fixed saves ${moneyFmt.format(heloan.total_cost_delta_vs_heloc)}`
        : `HELOC saves ${moneyFmt.format(Math.abs(heloan.total_cost_delta_vs_heloc))}`;

    const cards = [
      {
        label: "Fixed Monthly Payment",
        val: `${moneyFmt.format(heloan.monthly_payment)}/mo (level)`,
      },
      {
        label: "Fixed Total Interest",
        val: `${moneyFmt.format(heloan.total_interest_paid)} (${fmtDeltaInterest})`,
      },
      {
        label: "Total Cost (incl. fees)",
        val: `${moneyFmt.format(heloan.total_cost_with_fees)} (${fmtDeltaCost})`,
      },
      {
        label: "Repayment Shock Avoided",
        val: moneyFmt.format(heloan.payment_shock_avoided),
      },
    ];

    for (const item of cards) {
      const card = el("div", "delta-card");
      card.append(
        el("span", "delta-label", item.label),
        el("span", "delta-value tabular-nums", item.val),
      );
      heloanCompareGrid.append(card);
    }
    heloanCompareSection.hidden = false;
  }

  function renderPrintSummaryBanner(result) {
    const { config, summary } = result;
    const startLabel = formatLoanMonthDate(activeParams.start_year_month, 1);
    const payoffDate = formatLoanMonthDate(
      activeParams.start_year_month,
      summary.actual_months_to_payoff,
    );
    printSummaryBanner.replaceChildren();
    printSummaryBanner.append(
      el(
        "strong",
        null,
        `HELOC Simulation Report — Balance ${moneyWholeFmt.format(config.initial_principal)} / Limit ${moneyWholeFmt.format(config.credit_limit)}`,
      ),
      el(
        "span",
        "tabular-nums",
        `Rate Scenario: ${activeParams.rate_scenario} (Prime ${activeParams.prime_rate}% + Margin ${config.margin}%) · Draw/Repay: ${config.draw_period_months}/${config.repayment_period_months} mos · Extra Prepay: ${moneyFmt.format(config.monthly_prepayment)}/mo${startLabel ? ` · Start: ${startLabel} · Payoff: ${payoffDate}` : ""}`,
      ),
      el(
        "span",
        "tabular-nums",
        `Total Interest: ${moneyFmt.format(summary.total_interest_paid)} · Non-APR Fees: ${moneyFmt.format(summary.total_fees)} · Total Cost w/ Fees: ${moneyFmt.format(summary.total_cost_with_fees)}`,
      ),
    );
  }

  function renderDashboard(result) {
    const { config, summary, milestones, cap_stats: caps, records, clipped_draws: clipped } = result;
    const startYM = activeParams.start_year_month;

    // 1. KPI Cards
    kpiDrawPayment.textContent = `${moneyFmt.format(summary.initial_draw_payment)}/mo`;
    const drawModeLabel =
      config.draw_payment_mode === "pct_of_balance"
        ? `${config.draw_min_payment_pct}% bal min`
        : config.draw_payment_mode === "fixed_floor"
          ? `${moneyWholeFmt.format(config.draw_min_payment_floor)} floor`
          : "interest-only";
    kpiDrawSub.textContent = `Month 1 ${drawModeLabel} (${records[0]?.effective_apr.toFixed(2) ?? "0.00"}% APR)`;

    if (summary.actual_months_to_payoff > config.draw_period_months) {
      kpiRepayPayment.textContent = `${moneyFmt.format(summary.first_repayment_payment)}/mo`;
      const repayCal = formatLoanMonthDate(startYM, config.draw_period_months + 1);
      kpiRepaySub.textContent = repayCal
        ? `Month ${config.draw_period_months + 1} (${repayCal})`
        : `Month ${config.draw_period_months + 1} dynamic amortization`;
    } else {
      kpiRepayPayment.textContent = "$0.00";
      kpiRepaySub.textContent = "Paid off during draw period";
    }

    kpiShockAmount.textContent = `${summary.payment_shock_amount > 0 ? "+" : ""}${moneyFmt.format(summary.payment_shock_amount)}/mo`;
    kpiShockPct.textContent = `${summary.payment_shock_pct > 0 ? "+" : ""}${summary.payment_shock_pct.toFixed(1)}%`;

    if (summary.payment_shock_pct >= 75) {
      kpiShockCard.dataset.shockLevel = "high";
      kpiShockBadge.className = "shock-badge shock-badge--high";
      kpiShockBadge.textContent = "[!] High shock";
    } else if (summary.payment_shock_amount > 0) {
      kpiShockCard.dataset.shockLevel = "moderate";
      kpiShockBadge.className = "shock-badge shock-badge--moderate";
      kpiShockBadge.textContent = "[~] Step-up";
    } else {
      kpiShockCard.dataset.shockLevel = "none";
      kpiShockBadge.className = "shock-badge shock-badge--none";
      kpiShockBadge.textContent = "[OK] None";
    }

    kpiTotalInterest.textContent = moneyFmt.format(summary.total_interest_paid);
    kpiTotalOutlay.textContent =
      summary.total_fees > 0
        ? `Outlay: ${moneyFmt.format(summary.total_payments)} + ${moneyFmt.format(summary.total_fees)} fees`
        : `Total outlay: ${moneyFmt.format(summary.total_payments)}`;

    kpiPayoffMonths.textContent = formatMonthsAndYears(summary.actual_months_to_payoff);
    const payoffCal = formatLoanMonthDate(startYM, summary.actual_months_to_payoff);
    kpiPayoffSub.textContent = payoffCal
      ? `of ${summary.total_months_scheduled} scheduled · Est. ${payoffCal}`
      : `of ${summary.total_months_scheduled} scheduled months`;

    kpiSavingsAmount.textContent = moneyFmt.format(summary.interest_savings_vs_baseline);
    if (config.monthly_prepayment > 0 || summary.total_lump_sum_payments > 0) {
      const lumpNote = summary.total_lump_sum_payments > 0 ? " (incl. lump sums)" : "";
      kpiSavingsMonths.textContent = `${summary.months_saved_vs_baseline} months faster${lumpNote}`;
    } else {
      kpiSavingsMonths.textContent = "Baseline ($0 extra prepayment)";
    }

    // 2. Cap / Regulatory & Fee Status Strips
    const capSourceLabel =
      caps.binding_cap_source === "regulatory_ceiling"
        ? `WA CLA Usury Ceiling (${config.regulatory_ceiling.toFixed(2)}%)`
        : caps.binding_cap_source === "lifetime_rate_cap"
          ? `Contractual Lifetime Cap (${config.lifetime_rate_cap.toFixed(2)}%)`
          : `Contractual & Usury Cap (${caps.applied_ceiling.toFixed(2)}%)`;

    const methodLabels = {
      average_daily_balance: "Average Daily Balance",
      adjusted_balance: "Adjusted Balance",
      previous_balance: "Previous Balance",
    };

    const clipNote =
      Array.isArray(clipped) && clipped.length > 0
        ? ` [!] Clipped ${clipped.length} draw(s) at ${moneyWholeFmt.format(config.credit_limit)} credit limit.`
        : "";

    capStatusStrip.dataset.capHit = String(caps.cap_hit || clipNote.length > 0);
    capStatusStrip.textContent =
      (caps.cap_hit
        ? `Active Ceiling: ${capSourceLabel} clamped variable APR starting Month ${caps.first_cap_month}. Convention: ${methodLabels[config.balance_method]} · ${config.year_basis}-day DPR.`
        : `Effective Ceiling: ${capSourceLabel} (not exceeded in this projection). Convention: ${methodLabels[config.balance_method]} · ${config.year_basis}-day DPR.`) +
      clipNote;

    if (summary.total_fees > 0) {
      const yearsAssessed = Math.ceil(summary.actual_months_to_payoff / 12);
      const annualPart =
        config.annual_fee > 0
          ? `${moneyFmt.format(config.annual_fee * yearsAssessed)} annual (${yearsAssessed} yrs)`
          : "$0.00 annual";
      const closurePart =
        config.early_closure_fee > 0
          ? summary.early_closure_fee_triggered
            ? `${moneyFmt.format(config.early_closure_fee)} early closure (triggered <= Mo ${config.early_closure_months})`
            : `$0.00 early closure (paid off > Mo ${config.early_closure_months})`
          : "$0.00 early closure";
      feeSummaryStrip.hidden = false;
      feeSummaryStrip.dataset.earlyClosure = String(summary.early_closure_fee_triggered);
      feeSummaryStrip.textContent =
        `Non-APR Fee Ledger (separate from Reg Z APR): Closing ${moneyFmt.format(config.closing_costs)} + ${annualPart} + ${closurePart} = ${moneyFmt.format(summary.total_fees)} fees · Total Cost w/ Fees: ${moneyFmt.format(summary.total_cost_with_fees)}.`;
    } else {
      feeSummaryStrip.hidden = true;
      feeSummaryStrip.textContent = "";
    }

    // 3. Charts
    renderCharts({
      balanceEl: chartBalanceEl,
      paymentEl: chartPaymentEl,
      interestEl: chartInterestEl,
      result,
      startYearMonth: startYM,
    });

    // 4. Milestones
    milestonesList.replaceChildren();
    for (const ms of milestones) {
      const li = el("li", "milestone-card");
      const calLabel = formatLoanMonthDate(startYM, ms.month);
      const monthHeading = calLabel
        ? `Month ${ms.month} · ${calLabel} · Year ${Math.ceil(ms.month / 12)}`
        : `Month ${ms.month} · Year ${Math.ceil(ms.month / 12)}`;
      li.append(
        el("span", "milestone-month", monthHeading),
        el("span", "milestone-title", ms.event),
      );
      let detail = "";
      if (ms.event === "Loan Origination") {
        detail = `Initial draw: ${moneyFmt.format(ms.balance)}`;
      } else if (ms.event === "Introductory Rate Expiration") {
        detail = `Resets to ${ms.next_rate.toFixed(2)}% APR`;
      } else if (ms.event === "Phase Shift: Repayment Period Begins") {
        detail = `Payment shock: +${moneyFmt.format(ms.payment_shock_amount)} (+${ms.payment_shock_pct.toFixed(1)}%)`;
      } else if (ms.event === "Scheduled Draw") {
        detail = `Draw +${moneyFmt.format(ms.amount)}${ms.label ? ` · ${ms.label}` : ""}`;
      } else if (ms.event === "One-Time Lump Sum") {
        detail = `Lump paydown −${moneyFmt.format(ms.amount)}${ms.label ? ` · ${ms.label}` : ""}`;
      } else if (ms.event === "Loan Payoff") {
        detail = "Balance reaches $0.00";
      }
      li.append(el("span", "milestone-detail tabular-nums", detail));
      milestonesList.append(li);
    }

    // 5. Schedule table & count
    renderScheduleSection(result);

    // 6. Comparisons, print banner, badges, CLTV & presets
    renderComparisonStrip();
    renderHeloanComparison(result);
    renderPrintSummaryBanner(result);
    renderBuiltinPills();
    updateDrawerBadges(activeParams, result);
    updateCltvReadout();
  }

  function renderScheduleSection(result) {
    renderScheduleTable({
      containerEl: scheduleContainerEl,
      result,
      viewMode: scheduleView,
      phaseFilter,
      startYearMonth: activeParams.start_year_month,
    });

    const filteredMonthly =
      phaseFilter === "all"
        ? result.records
        : result.records.filter((r) => r.phase === phaseFilter);

    if (scheduleView === "annual") {
      const years = new Set(filteredMonthly.map((r) => r.year));
      scheduleRowCountEl.textContent = `${years.size} year${years.size === 1 ? "" : "s"}`;
    } else {
      scheduleRowCountEl.textContent = `${filteredMonthly.length} month${filteredMonthly.length === 1 ? "" : "s"}`;
    }
  }

  function validateAndReadForm({ isCommit = false } = {}) {
    validation.clearFieldError(principalEl);
    validation.clearFieldError(limitEl);
    validation.clearFieldError(customRatesEl);

    const principal = Number(principalEl.value);
    const limit = Number(limitEl.value);
    updateUtilizationMeter(principal, limit);
    syncPrincipalRangeBounds(principal, limit);

    let hasError = false;
    let firstInvalidCtrl = null;
    form.querySelectorAll("input, select, textarea").forEach((ctrl) => {
      if (!validation.isMainControl(ctrl) || ctrl.disabled) return;
      if (ctrl.validity.valid) {
        if (ctrl !== principalEl && ctrl !== customRatesEl) {
          ctrl.classList.remove("user-invalid-fallback");
        }
        return;
      }
      hasError = true;
      if (!firstInvalidCtrl) firstInvalidCtrl = ctrl;
      if (isCommit) {
        ctrl.classList.add("user-invalid-fallback");
      }
    });

    if (
      Number.isFinite(principal) &&
      Number.isFinite(limit) &&
      principal > 0 &&
      limit > 0 &&
      principal > limit
    ) {
      validation.setCustomFieldError(
        principalEl,
        "Initial drawn balance cannot exceed credit limit.",
        { forceShow: true, announce: isCommit },
      );
      firstInvalidCtrl ??= principalEl;
      hasError = true;
    }

    const scenario =
      form.querySelector('input[name="rate_scenario"]:checked')?.value ?? "flat";
    const customMode =
      form.querySelector('input[name="custom_rates_mode"]:checked')?.value ?? "annual";

    let customRates = null;
    if (scenario === "custom") {
      const rawCustom = customRatesEl.value.trim();
      if (rawCustom.length > 0) {
        const expanded = expandCustomRates(rawCustom, customMode);
        if (expanded.error) {
          validation.setCustomFieldError(customRatesEl, expanded.error, {
            forceShow: isCommit,
            announce: isCommit,
          });
          firstInvalidCtrl ??= customRatesEl;
          hasError = true;
        } else {
          customRates = expanded.rates;
        }
      }
    }

    if (hasError) {
      if (isCommit) {
        validation.syncAll(true);
      }
      const fieldLabel = firstInvalidCtrl?.labels?.[0]?.textContent?.trim();
      validationBannerText.textContent = fieldLabel
        ? `Fix "${fieldLabel}" to update results; displaying last valid trajectory.`
        : "Fix highlighted parameter errors to update results; displaying last valid trajectory.";
      return { ok: false, params: null };
    }

    validationBannerText.textContent =
      "Fix highlighted parameter errors to update results; displaying last valid trajectory.";

    const drawRaw = Math.trunc(Number(drawDurEl.value));
    const repayRaw = Math.trunc(Number(repayDurEl.value));
    const drawMonths = drawUnitEl.value === "years" ? drawRaw * 12 : drawRaw;
    const repayMonths = repayUnitEl.value === "years" ? repayRaw * 12 : repayRaw;

    const introEnabled = introEnabledEl.checked;
    const introApr = introEnabled ? Number(introAprEl.value) : null;
    if (introEnabled && Number.isFinite(introApr)) {
      rememberedIntroApr = introApr;
    }

    const totalMonths = drawMonths + repayMonths;
    const validExistingEvents = (activeParams.cash_flow_events ?? []).filter(
      (ev) =>
        ev.month >= 1 &&
        ev.month <= totalMonths &&
        (ev.event_type !== "draw" || ev.month <= drawMonths),
    );

    const startMonth = startMonthEl.value;
    const startYearRaw = Math.trunc(Number(startYearEl.value || 2026));
    const startYearMonth = startMonth
      ? `${String(startYearRaw).padStart(4, "0")}-${startMonth}`
      : null;

    const candidate = {
      initial_principal: principal,
      credit_limit: limit,
      prime_rate: Number(primeEl.value),
      margin: Number(marginEl.value),
      intro_apr: introApr,
      intro_duration_months: Math.trunc(Number(introMonthsEl.value)),
      draw_period_months: drawMonths,
      repayment_period_months: repayMonths,
      lifetime_rate_cap: Number(capEl.value),
      regulatory_ceiling: Number(usuryEl.value),
      monthly_prepayment: Number(prepayEl.value),
      balance_method: methodEl.value,
      year_basis: Number(form.querySelector('input[name="year_basis"]:checked')?.value ?? 365),
      rate_scenario: scenario,
      annual_rate_step: Number(annualStepEl.value),
      custom_rates: customRates,
      custom_rates_mode: customMode,
      draw_payment_mode: drawModeEl.value,
      draw_min_payment_pct: Number(drawMinPctEl.value || 1.0),
      draw_min_payment_floor: Number(drawMinFloorEl.value || 0),
      cash_flow_events: validExistingEvents,
      closing_costs: Number(closingCostsEl.value || 0),
      annual_fee: Number(annualFeeEl.value || 0),
      early_closure_fee: Number(earlyClosureFeeEl.value || 0),
      early_closure_months: Math.trunc(Number(earlyClosureMonthsEl.value || 36)),
      start_year_month: startYearMonth,
      heloan_enabled: heloanEnabledEl.checked,
      heloan_apr: Number(heloanAprEl.value || 7.5),
      heloan_term_years: Math.trunc(Number(heloanTermYearsEl.value || 15)),
      heloan_closing_costs: Number(heloanClosingCostsEl.value || 0),
    };

    try {
      const result = calculateHelocTrajectory(candidate);
      return { ok: true, params: candidate, result };
    } catch (err) {
      if (err instanceof ConfigValidationError && err.errors.length > 0) {
        validationBannerText.textContent = `${err.errors[0].message} Displaying last valid trajectory.`;
      }
      return { ok: false, params: null };
    }
  }

  function runAndRender(alreadyComputed = false) {
    if (alreadyComputed) {
      lastValidResult = calculateHelocTrajectory(activeParams);
      validationBanner.hidden = true;
      renderDashboard(lastValidResult);
      renderEventsList();
      return;
    }
    const check = validateAndReadForm({ isCommit: false });
    if (!check.ok) {
      validationBanner.hidden = false;
      return;
    }
    validationBanner.hidden = true;
    activeParams = check.params;
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    lastValidResult = check.result;
    renderDashboard(lastValidResult);
    renderEventsList();
  }

  function runGoalSolver(targetMonths) {
    const cfg = validateConfig(activeParams);
    const totalMonths = cfg.draw_period_months + cfg.repayment_period_months;
    const clampedTarget = Math.max(1, Math.min(totalMonths, Math.trunc(targetMonths)));
    const prime = generatePrimeRates({
      totalMonths,
      scenario: activeParams.rate_scenario,
      basePrime: activeParams.prime_rate,
      annualStep: activeParams.annual_rate_step,
      customRates: activeParams.custom_rates,
    });

    const solved = solveMonthlyPrepayment(cfg, clampedTarget, prime);
    solverResultEl.hidden = false;

    if (!solved.achievable) {
      solverResultEl.dataset.warning = "true";
      solverResultTextEl.textContent = solved.reason ?? "Target cannot be achieved.";
      applySolverBtn.hidden = true;
      badgeSolver.textContent = "Blocked";
      return;
    }

    solverResultEl.dataset.warning = "false";
    const payDate = formatLoanMonthDate(activeParams.start_year_month, solved.actual_months_to_payoff);
    const payStr = payDate
      ? `Mo ${solved.actual_months_to_payoff} (${payDate})`
      : `Mo ${solved.actual_months_to_payoff}`;

    if (solved.already_met) {
      solverResultTextEl.textContent = `Target reached with $0/mo extra prepayment (payoff ${payStr}, interest ${moneyFmt.format(solved.total_interest_paid)}, shock ${moneyFmt.format(solved.payment_shock_amount)}).`;
      applySolverBtn.hidden = activeParams.monthly_prepayment === 0;
      applySolverBtn.dataset.solvedAmount = "0";
      applySolverBtn.textContent = "Apply $0/mo";
      badgeSolver.textContent = "$0/mo needed";
      return;
    }

    solverResultTextEl.textContent = `Requires ${moneyFmt.format(solved.required_monthly_prepayment)}/mo extra -> payoff ${payStr}, total interest ${moneyFmt.format(solved.total_interest_paid)}, shock ${moneyFmt.format(solved.payment_shock_amount)}.`;
    applySolverBtn.hidden = false;
    applySolverBtn.dataset.solvedAmount = String(solved.required_monthly_prepayment);
    applySolverBtn.textContent = `Apply ${moneyFmt.format(solved.required_monthly_prepayment)}/mo`;
    badgeSolver.textContent = `${moneyWholeFmt.format(solved.required_monthly_prepayment)}/mo`;
  }

  // Main form listeners (skip helper inputs for main simulation triggers)
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t === principalEl) {
      const num = Number(principalEl.value);
      if (Number.isFinite(num) && num >= 0) {
        syncRangeStyles(principalRangeEl, num, moneyWholeFmt.format(num));
      }
    } else if (t === principalRangeEl) {
      principalEl.value = principalRangeEl.value;
      syncRangeStyles(
        principalRangeEl,
        principalRangeEl.value,
        moneyWholeFmt.format(Number(principalRangeEl.value)),
      );
    } else if (t === prepayEl) {
      const num = Number(prepayEl.value);
      if (Number.isFinite(num) && num >= 0) {
        syncRangeStyles(prepayRangeEl, num, `${moneyWholeFmt.format(num)} per month`);
      }
    } else if (t === prepayRangeEl) {
      prepayEl.value = prepayRangeEl.value;
      syncRangeStyles(
        prepayRangeEl,
        prepayRangeEl.value,
        `${moneyWholeFmt.format(Number(prepayRangeEl.value))} per month`,
      );
    } else if (t === primeEl) {
      const num = Number(primeEl.value);
      if (Number.isFinite(num) && num >= 0) {
        syncRangeStyles(primeRangeEl, num, `${num}%`);
      }
    } else if (t === primeRangeEl) {
      primeEl.value = primeRangeEl.value;
      syncRangeStyles(primeRangeEl, primeRangeEl.value, `${primeRangeEl.value}%`);
    } else if (!validation.isMainControl(t)) {
      return;
    }
    runAndRender(false);
  });

  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t !== principalRangeEl && t !== prepayRangeEl && t !== primeRangeEl && !validation.isMainControl(t)) {
      return;
    }

    if (t.name === "rate_scenario") {
      updateConditionalVisibility(t.value);
    }
    if (t === introEnabledEl) {
      updateIntroFieldStates();
    }
    if (t === drawModeEl) {
      updateDrawModeStates();
    }
    if (t === heloanEnabledEl) {
      updateHeloanFieldStates();
    }
    if (t === startMonthEl) {
      updateStartDateFieldState();
    }
    if (t === drawUnitEl) {
      const cur = Number(drawDurEl.value);
      if (Number.isFinite(cur) && cur >= 1) {
        drawDurEl.value =
          drawUnitEl.value === "years"
            ? String(Math.max(1, Math.round(cur / 12)))
            : String(Math.min(600, Math.round(cur * 12)));
      }
    }
    if (t === repayUnitEl) {
      const cur = Number(repayDurEl.value);
      if (Number.isFinite(cur) && cur >= 1) {
        repayDurEl.value =
          repayUnitEl.value === "years"
            ? String(Math.max(1, Math.round(cur / 12)))
            : String(Math.min(600, Math.round(cur * 12)));
      }
    }

    const check = validateAndReadForm({ isCommit: true });
    if (!check.ok) {
      validationBanner.hidden = false;
      return;
    }
    validationBanner.hidden = true;
    activeParams = check.params;
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    lastValidResult = check.result;
    renderDashboard(lastValidResult);
    renderEventsList();
  });

  // CLTV Helper events
  [homeValueEl, firstMortgageEl, maxCltvEl].forEach((input) => {
    input.addEventListener("input", updateCltvReadout);
    input.addEventListener("change", updateCltvReadout);
  });

  applyCltvLimitBtn.addEventListener("click", () => {
    const cltv = updateCltvReadout();
    if (!cltv || cltv.max_heloc_limit <= 0) return;
    const newLimit = cltv.max_heloc_limit;
    const clampedPrincipal = Math.min(activeParams.initial_principal, newLimit);
    limitEl.value = String(newLimit);
    principalEl.value = String(clampedPrincipal);
    activeParams = {
      ...activeParams,
      credit_limit: newLimit,
      initial_principal: clampedPrincipal,
    };
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    syncPrincipalRangeBounds(clampedPrincipal, newLimit);
    updateUtilizationMeter(clampedPrincipal, newLimit);
    runAndRender(true);
    announcer.announce(`Applied CLTV eligible credit limit of ${moneyWholeFmt.format(newLimit)}.`);
  });

  // Goal Solver events
  solveGoalBtn.addEventListener("click", () => {
    const raw = Math.trunc(Number(goalTargetValEl.value));
    if (!Number.isFinite(raw) || raw < 1) {
      solverResultEl.hidden = false;
      solverResultEl.dataset.warning = "true";
      solverResultTextEl.textContent = "Enter a target horizon of 1 or more.";
      applySolverBtn.hidden = true;
      return;
    }
    const targetMonths = goalTargetUnitEl.value === "years" ? raw * 12 : raw;
    runGoalSolver(targetMonths);
  });

  solveZeroShockBtn.addEventListener("click", () => {
    const drawMonths = lastValidResult.config.draw_period_months;
    if (drawMonths % 12 === 0) {
      goalTargetUnitEl.value = "years";
      goalTargetValEl.value = String(drawMonths / 12);
    } else {
      goalTargetUnitEl.value = "months";
      goalTargetValEl.value = String(drawMonths);
    }
    runGoalSolver(drawMonths);
  });

  applySolverBtn.addEventListener("click", () => {
    const amount = Number(applySolverBtn.dataset.solvedAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    prepayEl.value = String(amount);
    syncRangeStyles(prepayRangeEl, amount, `${moneyWholeFmt.format(amount)} per month`);
    activeParams = { ...activeParams, monthly_prepayment: amount };
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    runAndRender(true);
    announcer.announce(`Applied solved monthly prepayment of ${moneyFmt.format(amount)}.`);
  });

  // Planned Draws & Lump Sums helper events
  const addScheduledEvent = (ev) => {
    const totalMonths = activeParams.draw_period_months + activeParams.repayment_period_months;
    if (!Number.isInteger(ev.month) || ev.month < 1 || ev.month > totalMonths) {
      eventDraftErrorEl.hidden = false;
      eventDraftErrorEl.textContent = `Event month must be between 1 and ${totalMonths}.`;
      return false;
    }
    if (ev.event_type === "draw" && ev.month > activeParams.draw_period_months) {
      eventDraftErrorEl.hidden = false;
      eventDraftErrorEl.textContent = `Scheduled draws must occur during the draw period (Months 1–${activeParams.draw_period_months}).`;
      return false;
    }
    if (!Number.isFinite(ev.amount) || ev.amount <= 0) {
      eventDraftErrorEl.hidden = false;
      eventDraftErrorEl.textContent = "Amount must be greater than $0.";
      return false;
    }
    eventDraftErrorEl.hidden = true;
    const nextEvents = [...(activeParams.cash_flow_events ?? []), ev].sort((a, b) => a.month - b.month);
    activeParams = { ...activeParams, cash_flow_events: nextEvents };
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    runAndRender(true);
    return true;
  };

  addEventBtn.addEventListener("click", () => {
    const ev = {
      event_type: eventTypeEl.value,
      month: Math.trunc(Number(eventMonthEl.value)),
      amount: Number(eventAmountEl.value),
      label: eventLabelEl.value.trim().slice(0, 60),
    };
    if (addScheduledEvent(ev)) {
      eventLabelEl.value = "";
      announcer.announce(`Added scheduled ${ev.event_type === "draw" ? "draw" : "lump sum"} in month ${ev.month}.`);
    }
  });

  document.querySelectorAll("[data-sample-event]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-sample-event");
      const drawMos = activeParams.draw_period_months;
      const totMos = drawMos + activeParams.repayment_period_months;
      if (kind === "reno") {
        addScheduledEvent({
          event_type: "draw",
          month: Math.min(14, drawMos),
          amount: 15000,
          label: "Kitchen Reno",
        });
      } else {
        addScheduledEvent({
          event_type: "lump_sum",
          month: Math.min(12, totMos),
          amount: 5000,
          label: "Annual Bonus",
        });
      }
    });
  });

  clearEventsBtn.addEventListener("click", () => {
    activeParams = { ...activeParams, cash_flow_events: [] };
    activeBuiltinId = detectMatchingBuiltin(activeParams);
    eventDraftErrorEl.hidden = true;
    runAndRender(true);
    announcer.announce("Cleared all scheduled draws and lump sums.");
  });

  // Toolbar, compare, share & export
  resetBtn.addEventListener("click", () => {
    activeParams = { ...DEFAULT_SCENARIO, cash_flow_events: [] };
    activeBuiltinId = "default_terms";
    populateForm(activeParams);
    runAndRender(true);
    announcer.announce("Reset to default HELOC terms.");
  });

  savePresetBtn.addEventListener("click", () => {
    const res = savePreset(undefined, presetNameEl.value, activeParams);
    if (res.error) {
      announcer.announce(res.error);
      presetNameEl.focus();
      return;
    }
    savedPresets = res.presets;
    presetNameEl.value = "";
    renderSavedPresetsList();
    renderCompareOptions();
    announcer.announce(`Saved scenario ${res.saved.name} locally.`);
  });

  compareSelectEl.addEventListener("change", () => {
    renderComparisonStrip();
  });

  shareBtn.addEventListener("click", async () => {
    const shareUrl = buildShareUrl(activeParams, window.location);
    try {
      window.history.replaceState(null, "", shareUrl);
    } catch {
      // Ignore if running in restricted context
    }
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      }
    } catch {
      copied = false;
    }
    clearTimeout(shareResetTimer);
    shareBtnLabel.textContent = copied ? "Link Copied!" : "URL Updated!";
    shareResetTimer = setTimeout(() => {
      shareBtnLabel.textContent = "Copy Share Link";
    }, 2000);
    announcer.announce(
      copied ? "Shareable URL copied to clipboard." : "Browser address bar updated with share URL.",
    );
  });

  printBtn.addEventListener("click", () => {
    window.print();
  });

  viewAnnualBtn.addEventListener("click", () => {
    scheduleView = "annual";
    viewAnnualBtn.setAttribute("aria-pressed", "true");
    viewMonthlyBtn.setAttribute("aria-pressed", "false");
    renderScheduleSection(lastValidResult);
  });

  viewMonthlyBtn.addEventListener("click", () => {
    scheduleView = "monthly";
    viewAnnualBtn.setAttribute("aria-pressed", "false");
    viewMonthlyBtn.setAttribute("aria-pressed", "true");
    renderScheduleSection(lastValidResult);
  });

  phaseFilterEl.addEventListener("change", () => {
    phaseFilter = phaseFilterEl.value;
    renderScheduleSection(lastValidResult);
  });

  downloadCsvBtn.addEventListener("click", () => {
    const csv = recordsToCsv(lastValidResult.records, {
      startYearMonth: activeParams.start_year_month,
    });
    triggerCsvDownload(csv, "heloc_amortization_schedule.csv");
    announcer.announce("Downloaded HELOC monthly amortization schedule CSV.");
  });

  // Initial boot render
  activeBuiltinId = detectMatchingBuiltin(activeParams);
  populateForm(activeParams);
  renderSavedPresetsList();
  renderCompareOptions();
  renderDashboard(lastValidResult);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
