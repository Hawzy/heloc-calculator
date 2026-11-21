/**
 * Main client-side application controller for the HELOC Trajectory Calculator.
 */

import { ConfigValidationError, calculateHelocTrajectory } from "./engine/index.js";
import { createAnnouncer, initFormValidation } from "./ui/a11y.js";
import { renderCharts } from "./ui/charts.js";
import { recordsToCsv, triggerCsvDownload } from "./ui/csv.js";
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

function main() {
  const form = document.getElementById("heloc-form");
  const announcer = createAnnouncer();
  const validation = initFormValidation(form, announcer);
  initThemeToggle(document.getElementById("theme-toggle"));

  // Form inputs
  const principalEl = document.getElementById("initial-principal");
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
  const marginEl = document.getElementById("margin-rate");
  const annualStepGroup = document.getElementById("annual-step-group");
  const annualStepEl = document.getElementById("annual-rate-step");
  const customRatesGroup = document.getElementById("custom-rates-group");
  const customRatesEl = document.getElementById("custom-rates-input");
  const introEnabledEl = document.getElementById("intro-enabled");
  const introAprEl = document.getElementById("intro-apr");
  const introMonthsEl = document.getElementById("intro-months");
  const capEl = document.getElementById("lifetime-cap");
  const usuryEl = document.getElementById("regulatory-ceiling");
  const methodEl = document.getElementById("balance-method");

  // Output elements
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
  const compareStrip = document.getElementById("compare-strip");
  const compareSubtitle = document.getElementById("compare-subtitle");
  const compareDeltas = document.getElementById("compare-deltas");
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
  let activeParams = { ...initialParams };
  let lastValidResult = calculateHelocTrajectory(activeParams);
  let savedPresets = loadSavedPresets();
  let activeBuiltinId = null;
  let rememberedIntroApr = activeParams.intro_apr ?? 0.99;
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
          return JSON.stringify(a) === JSON.stringify(b);
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

  function updateUtilizationMeter(principal, limit) {
    const ratio =
      Number.isFinite(principal) && Number.isFinite(limit) && limit > 0
        ? Math.max(0, (principal / limit) * 100)
        : 0;
    utilBarEl.value = Math.min(100, ratio);
    utilTextEl.textContent = `${ratio.toFixed(1)}%`;
  }

  function populateForm(params) {
    principalEl.value = String(params.initial_principal);
    limitEl.value = String(params.credit_limit);

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
    prepayRangeEl.value = String(Math.min(2500, Math.max(0, params.monthly_prepayment)));

    primeEl.value = String(params.prime_rate);
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

    updateConditionalVisibility(params.rate_scenario);
    updateUtilizationMeter(params.initial_principal, params.credit_limit);

    // Clear residual validation markers when programmatically populating
    form.querySelectorAll("input, select, textarea").forEach((ctrl) => {
      validation.clearFieldError(ctrl);
    });
    validationBanner.hidden = true;
  }

  function renderBuiltinPills() {
    builtinContainer.replaceChildren();
    for (const preset of BUILTIN_PRESETS) {
      const btn = el("button", "preset-pill", preset.label);
      btn.type = "button";
      btn.title = preset.description;
      btn.setAttribute("aria-pressed", String(activeBuiltinId === preset.id));
      btn.addEventListener("click", () => {
        activeParams = { ...preset.params };
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
        activeParams = { ...DEFAULT_SCENARIO, ...item.params };
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

  function renderDashboard(result) {
    const { config, summary, milestones, cap_stats: caps, records } = result;

    // 1. KPI Cards
    kpiDrawPayment.textContent = `${moneyFmt.format(summary.initial_draw_payment)}/mo`;
    kpiDrawSub.textContent = `Month 1 interest-only (${records[0]?.effective_apr.toFixed(2) ?? "0.00"}% APR)`;

    if (summary.actual_months_to_payoff > config.draw_period_months) {
      kpiRepayPayment.textContent = `${moneyFmt.format(summary.first_repayment_payment)}/mo`;
      kpiRepaySub.textContent = `Month ${config.draw_period_months + 1} dynamic amortization`;
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
    kpiTotalOutlay.textContent = `Total outlay: ${moneyFmt.format(summary.total_payments)}`;

    kpiPayoffMonths.textContent = formatMonthsAndYears(summary.actual_months_to_payoff);
    kpiPayoffSub.textContent = `of ${summary.total_months_scheduled} scheduled months`;

    kpiSavingsAmount.textContent = moneyFmt.format(summary.interest_savings_vs_baseline);
    if (config.monthly_prepayment > 0) {
      kpiSavingsMonths.textContent = `${summary.months_saved_vs_baseline} months faster`;
    } else {
      kpiSavingsMonths.textContent = "Baseline ($0 extra prepayment)";
    }

    // 2. Cap / Regulatory Status Strip
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

    capStatusStrip.dataset.capHit = String(caps.cap_hit);
    capStatusStrip.textContent = caps.cap_hit
      ? `Active Ceiling: ${capSourceLabel} clamped variable APR starting Month ${caps.first_cap_month}. Convention: ${methodLabels[config.balance_method]} · ${config.year_basis}-day DPR.`
      : `Effective Ceiling: ${capSourceLabel} (not exceeded in this projection). Convention: ${methodLabels[config.balance_method]} · ${config.year_basis}-day DPR.`;

    // 3. Charts
    renderCharts({
      balanceEl: chartBalanceEl,
      paymentEl: chartPaymentEl,
      interestEl: chartInterestEl,
      result,
    });

    // 4. Milestones
    milestonesList.replaceChildren();
    for (const ms of milestones) {
      const li = el("li", "milestone-card");
      li.append(
        el("span", "milestone-month", `Month ${ms.month} · Year ${Math.ceil(ms.month / 12)}`),
        el("span", "milestone-title", ms.event),
      );
      let detail = "";
      if (ms.event === "Loan Origination") {
        detail = `Initial draw: ${moneyFmt.format(ms.balance)}`;
      } else if (ms.event === "Introductory Rate Expiration") {
        detail = `Resets to ${ms.next_rate.toFixed(2)}% APR`;
      } else if (ms.event === "Phase Shift: Repayment Period Begins") {
        detail = `Payment shock: +${moneyFmt.format(ms.payment_shock_amount)} (+${ms.payment_shock_pct.toFixed(1)}%)`;
      } else if (ms.event === "Loan Payoff") {
        detail = "Balance reaches $0.00";
      }
      li.append(el("span", "milestone-detail tabular-nums", detail));
      milestonesList.append(li);
    }

    // 5. Schedule table & count
    renderScheduleSection(result);

    // 6. Comparison strip & preset buttons
    renderComparisonStrip();
    renderBuiltinPills();
  }

  function renderScheduleSection(result) {
    renderScheduleTable({
      containerEl: scheduleContainerEl,
      result,
      viewMode: scheduleView,
      phaseFilter,
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

    let hasError = false;
    let firstInvalidCtrl = null;
    form.querySelectorAll("input, select, textarea").forEach((ctrl) => {
      if (ctrl.disabled) return;
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
  }

  // Event listeners
  form.addEventListener("input", (e) => {
    if (e.target === prepayEl) {
      const num = Number(prepayEl.value);
      if (Number.isFinite(num) && num >= 0) {
        prepayRangeEl.value = String(Math.min(2500, num));
      }
    } else if (e.target === prepayRangeEl) {
      prepayEl.value = prepayRangeEl.value;
    }
    runAndRender(false);
  });

  form.addEventListener("change", (e) => {
    if (e.target.name === "rate_scenario") {
      updateConditionalVisibility(e.target.value);
    }
    if (e.target === introEnabledEl) {
      updateIntroFieldStates();
    }
    if (e.target === drawUnitEl) {
      const cur = Number(drawDurEl.value);
      if (Number.isFinite(cur) && cur >= 1) {
        drawDurEl.value =
          drawUnitEl.value === "years"
            ? String(Math.max(1, Math.round(cur / 12)))
            : String(Math.min(600, Math.round(cur * 12)));
      }
    }
    if (e.target === repayUnitEl) {
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
  });

  resetBtn.addEventListener("click", () => {
    activeParams = { ...DEFAULT_SCENARIO };
    activeBuiltinId = "blueprint_rising";
    populateForm(activeParams);
    runAndRender(true);
    announcer.announce("Reset to Blueprint default scenario.");
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
    const csv = recordsToCsv(lastValidResult.records);
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
