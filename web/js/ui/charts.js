/**
 * Custom interactive inline SVG charts for HELOC balance, payment shock, and cumulative interest
 * with synchronized 3-chart hover/keyboard inspection and scheduled event markers.
 */

import { formatLoanMonthDate } from "./dates.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyCentFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function svgEl(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) {
      node.setAttribute(k, String(v));
    }
  }
  if (text !== null) {
    node.textContent = text;
  }
  return node;
}

function htmlEl(tag, className = null, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function niceAxisMax(rawMax) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const fraction = rawMax / magnitude;
  let niceFrac;
  if (fraction <= 1) niceFrac = 1;
  else if (fraction <= 1.2) niceFrac = 1.2;
  else if (fraction <= 1.5) niceFrac = 1.5;
  else if (fraction <= 2) niceFrac = 2;
  else if (fraction <= 2.5) niceFrac = 2.5;
  else if (fraction <= 3) niceFrac = 3;
  else if (fraction <= 4) niceFrac = 4;
  else if (fraction <= 5) niceFrac = 5;
  else if (fraction <= 6) niceFrac = 6;
  else if (fraction <= 8) niceFrac = 8;
  else niceFrac = 10;
  return niceFrac * magnitude;
}

function formatAxisDollar(value) {
  if (value === 0) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) {
    const k = value / 1_000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `$${Math.round(value)}`;
}

function buildLinePath(points) {
  if (points.length === 0) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)}`;
  }
  return d;
}

function buildAreaPath(points, baseY) {
  if (points.length === 0) return "";
  const line = buildLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)} ${baseY.toFixed(2)} L ${first.x.toFixed(2)} ${baseY.toFixed(2)} Z`;
}

function buildBetweenAreaPath(upperPoints, lowerPoints) {
  if (upperPoints.length === 0 || lowerPoints.length === 0) return "";
  let d = `M ${upperPoints[0].x.toFixed(2)} ${upperPoints[0].y.toFixed(2)}`;
  for (let i = 1; i < upperPoints.length; i += 1) {
    d += ` L ${upperPoints[i].x.toFixed(2)} ${upperPoints[i].y.toFixed(2)}`;
  }
  for (let i = lowerPoints.length - 1; i >= 0; i -= 1) {
    d += ` L ${lowerPoints[i].x.toFixed(2)} ${lowerPoints[i].y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function buildXTicks(maxMonth) {
  if (maxMonth <= 24) {
    const step = maxMonth <= 8 ? 1 : maxMonth <= 14 ? 2 : 4;
    const ticks = [1];
    for (let m = step; m < maxMonth; m += step) {
      if (m > 1) ticks.push(m);
    }
    if (maxMonth > 1 && ticks[ticks.length - 1] !== maxMonth) ticks.push(maxMonth);
    return ticks.map((m) => ({ month: m, label: `Mo ${m}` }));
  }

  const totalYears = Math.ceil(maxMonth / 12);
  const yearStep = totalYears <= 10 ? 2 : totalYears <= 20 ? 4 : 5;
  const ticks = [{ month: 1, label: "Yr 1" }];
  for (let yr = yearStep; yr <= totalYears; yr += yearStep) {
    const m = Math.min(maxMonth, (yr - 1) * 12 + 1);
    ticks.push({ month: m, label: `Yr ${yr}` });
  }
  return ticks;
}

/**
 * Create a self-contained interactive SVG chart with crosshair scrubbing & keyboard navigation.
 */
function createInteractiveChart({
  containerEl,
  titleId,
  titleText,
  descText,
  width,
  height,
  maxMonth,
  yMax,
  drawPeriodMonths,
  introMonth,
  repayMonth,
  eventMarkers = [],
  series,
  legendItems,
  betweenArea = null,
  annotationCallout = null,
  bandLabelPosition = "top",
  formatReadout,
  onMonthChange = null,
}) {
  containerEl.replaceChildren();

  const headerRow = htmlEl("div", "chart-header");
  const legendList = htmlEl("ul", "chart-legend");
  for (const item of legendItems) {
    const li = htmlEl("li", "chart-legend-item");
    const swatch = htmlEl("span", `legend-swatch legend-swatch--${item.style || "solid"}`);
    swatch.style.setProperty("--swatch-color", item.color);
    swatch.setAttribute("aria-hidden", "true");
    li.append(swatch, htmlEl("span", null, item.label));
    legendList.append(li);
  }
  headerRow.append(legendList);

  const readoutEl = htmlEl("div", "chart-readout");
  readoutEl.setAttribute("aria-live", "off");

  const pad = { top: 36, right: 16, bottom: 32, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const yBase = pad.top + plotH;

  const xForMonth = (m) => {
    if (maxMonth <= 1) return pad.left + plotW / 2;
    return pad.left + ((m - 1) / (maxMonth - 1)) * plotW;
  };
  const yForVal = (v) => pad.top + plotH - (Math.max(0, v) / yMax) * plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    role: "img",
    "aria-labelledby": titleId,
    class: "chart-svg",
  });

  svg.append(svgEl("title", { id: titleId }, titleText));
  svg.append(svgEl("desc", {}, descText));

  // Shaded Draw Period region
  let hasDrawBandPill = false;
  if (drawPeriodMonths >= 1 && maxMonth > 1) {
    const drawEndMonth = Math.min(drawPeriodMonths, maxMonth);
    const bandW = Math.max(0, xForMonth(drawEndMonth) - pad.left);
    if (bandW > 0) {
      svg.append(
        svgEl("rect", {
          x: pad.left,
          y: pad.top,
          width: bandW,
          height: plotH,
          class: "chart-draw-band",
        }),
      );
      if (bandW > 94) {
        hasDrawBandPill = true;
        const pillW = 84;
        const pillH = 18;
        const pillX = pad.left + 6;
        const pillY = bandLabelPosition === "bottom" ? yBase - pillH - 6 : pad.top + 6;
        svg.append(
          svgEl("rect", {
            x: pillX,
            y: pillY,
            width: pillW,
            height: pillH,
            rx: 4,
            class: "chart-band-pill",
          }),
        );
        svg.append(
          svgEl(
            "text",
            {
              x: pillX + pillW / 2,
              y: pillY + 13,
              "text-anchor": "middle",
              class: "chart-band-label",
            },
            "Draw Period",
          ),
        );
      }
    }
  }

  // Horizontal gridlines & Y ticks
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i += 1) {
    const val = (yMax * i) / tickCount;
    const y = yForVal(val);
    svg.append(
      svgEl("line", {
        x1: pad.left,
        y1: y,
        x2: pad.left + plotW,
        y2: y,
        class: i === 0 ? "chart-axis-line" : "chart-grid-line",
      }),
    );
    svg.append(
      svgEl(
        "text",
        {
          x: pad.left - 8,
          y: y + 4,
          "text-anchor": "end",
          class: "chart-tick-label",
        },
        formatAxisDollar(val),
      ),
    );
  }

  // X ticks
  const xTicks = buildXTicks(maxMonth);
  for (const tick of xTicks) {
    const x = xForMonth(tick.month);
    svg.append(
      svgEl("line", {
        x1: x,
        y1: yBase,
        x2: x,
        y2: yBase + 5,
        class: "chart-axis-line",
      }),
    );
    svg.append(
      svgEl(
        "text",
        {
          x,
          y: yBase + 20,
          "text-anchor": "middle",
          class: "chart-tick-label",
        },
        tick.label,
      ),
    );
  }

  // Between-series savings fill (optional)
  if (betweenArea && betweenArea.upper.length > 0 && betweenArea.lower.length > 0) {
    const upPts = betweenArea.upper.map((p) => ({ x: xForMonth(p.month), y: yForVal(p.value) }));
    const loPts = betweenArea.lower.map((p) => ({ x: xForMonth(p.month), y: yForVal(p.value) }));
    svg.append(
      svgEl("path", {
        d: buildBetweenAreaPath(upPts, loPts),
        class: "chart-savings-area",
      }),
    );
  }

  // Scheduled cash-flow event vertical guides (drawn behind data series)
  if (Array.isArray(eventMarkers) && eventMarkers.length > 0) {
    const seenByMonthType = new Set();
    for (const ev of eventMarkers) {
      if (ev.month < 1 || ev.month > maxMonth) continue;
      const key = `${ev.month}:${ev.event_type}`;
      if (seenByMonthType.has(key)) continue;
      seenByMonthType.add(key);

      const ex = xForMonth(ev.month);
      const isDrawEv = ev.event_type === "draw";
      svg.append(
        svgEl("line", {
          x1: ex,
          y1: pad.top,
          x2: ex,
          y2: yBase,
          class: `chart-event-line ${isDrawEv ? "chart-event--draw" : "chart-event--lump"}`,
        }),
      );
      svg.append(
        svgEl("circle", {
          cx: ex,
          cy: pad.top + 8,
          r: 6.5,
          class: `chart-event-badge ${isDrawEv ? "chart-event--draw" : "chart-event--lump"}`,
        }),
      );
      svg.append(
        svgEl(
          "text",
          {
            x: ex,
            y: pad.top + 11.5,
            "text-anchor": "middle",
            class: "chart-event-symbol",
          },
          isDrawEv ? "+" : "−",
        ),
      );
    }
  }

  // Series paths
  const seriesDots = [];
  for (const s of series) {
    if (!s.points || s.points.length === 0) continue;
    const coords = s.points.map((p) => ({
      month: p.month,
      value: p.value,
      x: xForMonth(p.month),
      y: yForVal(p.value),
    }));

    if (s.areaClass) {
      svg.append(
        svgEl("path", {
          d: buildAreaPath(coords, yBase),
          class: s.areaClass,
        }),
      );
    }

    svg.append(
      svgEl("path", {
        d: buildLinePath(coords),
        fill: "none",
        stroke: s.color,
        "stroke-width": s.strokeWidth ?? 2.5,
        "stroke-dasharray": s.dashed ? "6 4" : undefined,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    );

    const dot = svgEl("circle", {
      cx: coords[0].x,
      cy: coords[0].y,
      r: 4.5,
      fill: s.color,
      class: "chart-focus-dot",
    });
    svg.append(dot);
    seriesDots.push({ series: s, dot, coords });
  }

  // Vertical milestone markers
  const markerSpecs = [];
  if (introMonth !== null && introMonth > 0 && introMonth < maxMonth) {
    markerSpecs.push({
      month: introMonth,
      label: `Intro Ends (Mo ${introMonth})`,
      className: "chart-marker--intro",
      yLabelOffset: pad.top - 8,
    });
  }
  if (repayMonth !== null && repayMonth > 1 && repayMonth <= maxMonth) {
    const closeToIntro =
      introMonth !== null && Math.abs(xForMonth(repayMonth) - xForMonth(introMonth)) < 135;
    markerSpecs.push({
      month: repayMonth,
      label: `Repay Starts (Mo ${repayMonth})`,
      className: "chart-marker--repay",
      yLabelOffset: closeToIntro ? pad.top - 22 : pad.top - 8,
    });
  }

  for (const mk of markerSpecs) {
    const mx = xForMonth(mk.month);
    svg.append(
      svgEl("line", {
        x1: mx,
        y1: pad.top,
        x2: mx,
        y2: yBase,
        class: `chart-marker-line ${mk.className}`,
      }),
    );
    const anchor = mx > pad.left + plotW * 0.72 ? "end" : "start";
    const tx = anchor === "end" ? mx - 5 : mx + 5;
    svg.append(
      svgEl(
        "text",
        {
          x: tx,
          y: mk.yLabelOffset,
          "text-anchor": anchor,
          class: `chart-marker-label ${mk.className}`,
        },
        mk.label,
      ),
    );
  }

  // Optional Shock Callout pill
  if (annotationCallout && annotationCallout.month <= maxMonth) {
    const labelStr = annotationCallout.label;
    const pillW = Math.min(plotW - 8, Math.max(114, Math.round(labelStr.length * 7.1 + 16)));
    const pillH = 20;
    const cx = xForMonth(annotationCallout.month);
    const rightSpace = pad.left + plotW - cx;
    const leftSpace = cx - pad.left;
    const rawX = rightSpace >= pillW + 12 && rightSpace >= leftSpace ? cx + 8 : cx - pillW - 8;
    const pillX = Math.max(pad.left + 4, Math.min(pad.left + plotW - pillW - 4, rawX));
    const rawY = yForVal(annotationCallout.value) - pillH - 10;
    let pillY = Math.max(pad.top + 6, Math.min(yBase - pillH - 6, rawY));
    if (
      hasDrawBandPill &&
      bandLabelPosition === "top" &&
      pillX < pad.left + 96 &&
      pillY < pad.top + 28
    ) {
      pillY = Math.min(yBase - pillH - 6, pad.top + 30);
    }

    svg.append(
      svgEl("rect", {
        x: pillX,
        y: pillY,
        width: pillW,
        height: pillH,
        rx: 5,
        class: "chart-callout-bg",
      }),
    );
    svg.append(
      svgEl(
        "text",
        {
          x: pillX + pillW / 2,
          y: pillY + 14,
          "text-anchor": "middle",
          class: "chart-shock-callout",
        },
        labelStr,
      ),
    );
  }

  // Crosshair vertical line
  const crosshair = svgEl("line", {
    x1: pad.left,
    y1: pad.top,
    x2: pad.left,
    y2: yBase,
    class: "chart-crosshair",
  });
  svg.append(crosshair);

  // Focusable / interactive hit overlay for mouse + keyboard scrubbing
  const hitRect = svgEl("rect", {
    x: pad.left,
    y: pad.top,
    width: plotW,
    height: plotH,
    fill: "transparent",
    tabindex: "0",
    role: "slider",
    "aria-label": `${titleText} month inspector. Use Left and Right arrow keys to inspect months.`,
    "aria-valuemin": "1",
    "aria-valuemax": String(maxMonth),
    "aria-valuenow": String(maxMonth),
    class: "chart-hit-area",
  });
  svg.append(hitRect);

  let activeMonth = Math.min(maxMonth, repayMonth ?? maxMonth);
  if (activeMonth < 1) activeMonth = 1;

  const setActiveMonth = (monthNum, { broadcast = false } = {}) => {
    const clamped = Math.max(1, Math.min(maxMonth, Math.round(monthNum)));
    activeMonth = clamped;
    const x = xForMonth(clamped);
    crosshair.setAttribute("x1", String(x));
    crosshair.setAttribute("x2", String(x));

    for (const entry of seriesDots) {
      const match =
        entry.coords[clamped - 1] ??
        entry.coords.find((c) => c.month === clamped) ??
        entry.coords[entry.coords.length - 1];
      if (match) {
        entry.dot.setAttribute("cx", String(match.x));
        entry.dot.setAttribute("cy", String(match.y));
        entry.dot.style.opacity = "1";
      } else {
        entry.dot.style.opacity = "0";
      }
    }

    const readoutText = formatReadout(clamped);
    readoutEl.textContent = readoutText;
    hitRect.setAttribute("aria-valuenow", String(clamped));
    hitRect.setAttribute("aria-valuetext", readoutText);

    if (broadcast && typeof onMonthChange === "function") {
      onMonthChange(clamped);
    }
  };

  const monthFromClientX = (clientX) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return activeMonth;
    const svgX = ((clientX - rect.left) / rect.width) * width;
    if (maxMonth <= 1) return 1;
    const ratio = Math.max(0, Math.min(1, (svgX - pad.left) / plotW));
    return Math.round(1 + ratio * (maxMonth - 1));
  };

  hitRect.addEventListener("pointermove", (e) => {
    setActiveMonth(monthFromClientX(e.clientX), { broadcast: true });
  });

  hitRect.addEventListener("click", (e) => {
    setActiveMonth(monthFromClientX(e.clientX), { broadcast: true });
  });

  hitRect.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 12 : 1;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveMonth(activeMonth + step, { broadcast: true });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveMonth(activeMonth - step, { broadcast: true });
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveMonth(1, { broadcast: true });
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveMonth(maxMonth, { broadcast: true });
    }
  });

  setActiveMonth(activeMonth, { broadcast: false });
  containerEl.append(headerRow, readoutEl, svg);

  return { maxMonth, setActiveMonth };
}

/**
 * Render all three HELOC interactive trajectory SVG charts with synchronized scrubbing.
 *
 * @param {{
 *   balanceEl: HTMLElement,
 *   paymentEl: HTMLElement,
 *   interestEl: HTMLElement,
 *   result: ReturnType<import('../engine/index.js').calculateHelocTrajectory>,
 *   startYearMonth?: string | null
 * }} opts
 */
export function renderCharts({ balanceEl, paymentEl, interestEl, result, startYearMonth = null }) {
  const { config, summary, records, baseline_records: baseRecords } = result;
  if (!records || records.length === 0) return;

  const hasPrepay = config.monthly_prepayment > 0 || summary.total_lump_sum_payments > 0;
  const maxMonth = Math.max(records.length, hasPrepay ? baseRecords.length : records.length);
  const introMonth =
    config.intro_apr !== null && summary.actual_months_to_payoff > config.intro_duration_months
      ? config.intro_duration_months
      : null;
  const repayMonth =
    summary.actual_months_to_payoff > config.draw_period_months
      ? config.draw_period_months + 1
      : null;

  const activeByMonth = new Map(records.map((r) => [r.month, r]));
  const baseByMonth = new Map(baseRecords.map((r) => [r.month, r]));
  const eventsByMonth = new Map();
  for (const ev of config.cash_flow_events ?? []) {
    const list = eventsByMonth.get(ev.month) ?? [];
    list.push(ev);
    eventsByMonth.set(ev.month, list);
  }

  const formatMonthPrefix = (m, year, phase = null) => {
    const cal = formatLoanMonthDate(startYearMonth, m);
    const calPart = cal ? ` · ${cal}` : "";
    const metaParts = [];
    if (year) metaParts.push(`Yr ${year}`);
    if (phase) metaParts.push(phase);
    const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
    return `Mo ${m}${calPart}${meta}`;
  };

  const formatEventsSuffix = (m) => {
    const list = eventsByMonth.get(m);
    if (!list || list.length === 0) return "";
    const tags = list.map((ev) => {
      const sign = ev.event_type === "draw" ? "+" : "−";
      const lbl = ev.label ? ` ${ev.label}` : "";
      return `[${sign}${currencyFmt.format(ev.amount)}${lbl}]`;
    });
    return ` · ${tags.join(" ")}`;
  };

  const chartHandles = [];
  let isSyncing = false;
  const syncFromChart = (sourceIndex, monthNum) => {
    if (isSyncing) return;
    isSyncing = true;
    try {
      for (let i = 0; i < chartHandles.length; i += 1) {
        if (i !== sourceIndex && chartHandles[i]) {
          const targetMonth = Math.min(monthNum, chartHandles[i].maxMonth);
          chartHandles[i].setActiveMonth(targetMonth, { broadcast: false });
        }
      }
    } finally {
      isSyncing = false;
    }
  };

  // 1. Remaining Balance vs. Baseline
  const activeBalPoints = records.map((r) => ({ month: r.month, value: r.ending_balance }));
  const baseBalPoints = hasPrepay
    ? baseRecords.map((r) => ({ month: r.month, value: r.ending_balance }))
    : [];
  const balMaxRaw = Math.max(
    config.initial_principal,
    summary.peak_balance ?? 0,
    ...records.map((r) => r.starting_balance),
    ...baseBalPoints.map((p) => p.value),
  );

  const balSeries = [
    ...(hasPrepay
      ? [
          {
            label: "$0-Prepay Baseline",
            points: baseBalPoints,
            color: "var(--chart-muted)",
            dashed: true,
            strokeWidth: 2,
          },
        ]
      : []),
    {
      label: "Active Balance",
      points: activeBalPoints,
      color: "var(--chart-cobalt)",
      areaClass: "chart-area-cobalt",
      strokeWidth: 2.75,
    },
  ];

  const hasDrawEvent = (config.cash_flow_events ?? []).some((e) => e.event_type === "draw");
  const hasLumpEvent = (config.cash_flow_events ?? []).some((e) => e.event_type === "lump_sum");

  chartHandles[0] = createInteractiveChart({
    containerEl: balanceEl,
    titleId: "chart-balance-title",
    titleText: "Remaining Principal Balance vs. Zero-Prepayment Baseline",
    descText: `Loan balance trajectory starting at ${currencyFmt.format(config.initial_principal)} and paying off in ${summary.actual_months_to_payoff} months.`,
    width: 640,
    height: 290,
    maxMonth,
    yMax: niceAxisMax(balMaxRaw),
    drawPeriodMonths: config.draw_period_months,
    introMonth,
    repayMonth,
    eventMarkers: config.cash_flow_events ?? [],
    bandLabelPosition: "bottom",
    series: balSeries,
    legendItems: [
      { label: "Active Balance", color: "var(--chart-cobalt)", style: "solid" },
      ...(hasPrepay
        ? [{ label: "$0-Prepay Baseline", color: "var(--chart-muted)", style: "dashed" }]
        : []),
      ...(hasDrawEvent
        ? [{ label: "+Draw Event", color: "var(--chart-cobalt)", style: "dashed" }]
        : []),
      ...(hasLumpEvent
        ? [{ label: "−Lump Sum", color: "var(--chart-emerald)", style: "dashed" }]
        : []),
    ],
    onMonthChange: (m) => syncFromChart(0, m),
    formatReadout: (m) => {
      const act = activeByMonth.get(m);
      const base = baseByMonth.get(m);
      if (!act && base) {
        return `${formatMonthPrefix(m, base.year)} · Paid Off! · Baseline Bal: ${currencyCentFmt.format(base.ending_balance)}`;
      }
      if (!act) return formatMonthPrefix(m, Math.ceil(m / 12));
      const basePart =
        hasPrepay && base ? ` · Baseline: ${currencyCentFmt.format(base.ending_balance)}` : "";
      return `${formatMonthPrefix(act.month, act.year, act.phase)} · Balance: ${currencyCentFmt.format(act.ending_balance)}${basePart} · APR: ${act.effective_apr.toFixed(2)}%${formatEventsSuffix(act.month)}`;
    },
  });

  // 2. Monthly Required vs. Total Payment (focuses on active horizon)
  const payMaxMonth = records.length;
  const reqPayPoints = records.map((r) => ({ month: r.month, value: r.required_payment }));
  const totPayPoints = hasPrepay
    ? records.map((r) => ({ month: r.month, value: r.total_payment }))
    : [];
  const payMaxRaw = Math.max(
    ...records.map((r) => r.total_payment),
    ...records.map((r) => r.required_payment),
  );

  const shockCallout =
    repayMonth !== null && summary.payment_shock_amount > 0
      ? {
          month: repayMonth,
          value: summary.first_repayment_payment,
          label: `Shock +${currencyFmt.format(summary.payment_shock_amount)} (+${summary.payment_shock_pct.toFixed(1)}%)`,
        }
      : null;

  chartHandles[1] = createInteractiveChart({
    containerEl: paymentEl,
    titleId: "chart-payment-title",
    titleText: "Monthly Required Payment vs. Total Monthly Outlay",
    descText: `Monthly payment profile starting at ${currencyCentFmt.format(summary.initial_draw_payment)} during draw and shifting to ${currencyCentFmt.format(summary.first_repayment_payment)} at repayment.`,
    width: 500,
    height: 280,
    maxMonth: payMaxMonth,
    yMax: niceAxisMax(payMaxRaw),
    drawPeriodMonths: config.draw_period_months,
    introMonth: introMonth !== null && introMonth < payMaxMonth ? introMonth : null,
    repayMonth,
    eventMarkers: config.cash_flow_events ?? [],
    bandLabelPosition: "top",
    series: [
      ...(hasPrepay
        ? [
            {
              label: "Total Payment (Req + Prepay)",
              points: totPayPoints,
              color: "var(--chart-emerald)",
              dashed: true,
              strokeWidth: 2,
            },
          ]
        : []),
      {
        label: "Required Payment",
        points: reqPayPoints,
        color: "var(--chart-amber)",
        areaClass: "chart-area-amber",
        strokeWidth: 2.5,
      },
    ],
    legendItems: [
      { label: "Required Pmt", color: "var(--chart-amber)", style: "solid" },
      ...(hasPrepay
        ? [{ label: "Total Pmt (+Extra)", color: "var(--chart-emerald)", style: "dashed" }]
        : []),
    ],
    annotationCallout: shockCallout,
    onMonthChange: (m) => syncFromChart(1, m),
    formatReadout: (m) => {
      const act = activeByMonth.get(m);
      if (!act) return formatMonthPrefix(m, Math.ceil(m / 12));
      const totPart = hasPrepay ? ` · Total: ${currencyCentFmt.format(act.total_payment)}` : "";
      return `${formatMonthPrefix(act.month, act.year, act.phase)} · Req: ${currencyCentFmt.format(act.required_payment)}${totPart} · APR: ${act.effective_apr.toFixed(2)}%${formatEventsSuffix(act.month)}`;
    },
  });

  // 3. Cumulative Interest Paid vs. Baseline
  let cumActive = 0;
  const cumActivePoints = [];
  for (let m = 1; m <= maxMonth; m += 1) {
    const rec = activeByMonth.get(m);
    if (rec) cumActive += rec.interest_paid;
    cumActivePoints.push({ month: m, value: cumActive });
  }

  let cumBase = 0;
  const cumBasePoints = [];
  if (hasPrepay) {
    for (let m = 1; m <= maxMonth; m += 1) {
      const rec = baseByMonth.get(m);
      if (rec) cumBase += rec.interest_paid;
      cumBasePoints.push({ month: m, value: cumBase });
    }
  }

  const intMaxRaw = Math.max(cumActive, cumBase, summary.total_interest_paid);

  chartHandles[2] = createInteractiveChart({
    containerEl: interestEl,
    titleId: "chart-interest-title",
    titleText: "Cumulative Interest Paid vs. Zero-Prepayment Baseline",
    descText: `Total interest paid of ${currencyCentFmt.format(summary.total_interest_paid)}, saving ${currencyCentFmt.format(summary.interest_savings_vs_baseline)} compared to $0 prepayment.`,
    width: 500,
    height: 280,
    maxMonth,
    yMax: niceAxisMax(intMaxRaw),
    drawPeriodMonths: config.draw_period_months,
    introMonth,
    repayMonth,
    bandLabelPosition: "top",
    betweenArea: hasPrepay ? { upper: cumBasePoints, lower: cumActivePoints } : null,
    series: [
      ...(hasPrepay
        ? [
            {
              label: "$0-Prepay Interest",
              points: cumBasePoints,
              color: "var(--chart-muted)",
              dashed: true,
              strokeWidth: 2,
            },
          ]
        : []),
      {
        label: "Active Cumulative Interest",
        points: cumActivePoints,
        color: "var(--chart-crimson)",
        strokeWidth: 2.75,
      },
    ],
    legendItems: [
      { label: "Active Interest", color: "var(--chart-crimson)", style: "solid" },
      ...(hasPrepay
        ? [
            { label: "$0-Prepay Interest", color: "var(--chart-muted)", style: "dashed" },
            { label: "Interest Saved", color: "var(--chart-emerald)", style: "area" },
          ]
        : []),
    ],
    onMonthChange: (m) => syncFromChart(2, m),
    formatReadout: (m) => {
      const actPt = cumActivePoints[m - 1]?.value ?? 0;
      const basePt = cumBasePoints[m - 1]?.value ?? 0;
      const rec = activeByMonth.get(m) ?? baseByMonth.get(m);
      const aprStr = rec ? ` · APR: ${rec.effective_apr.toFixed(2)}%` : "";
      if (hasPrepay) {
        const savedSoFar = Math.max(0, basePt - actPt);
        return `${formatMonthPrefix(m, rec?.year)} · Cum. Interest: ${currencyCentFmt.format(actPt)} · Baseline: ${currencyCentFmt.format(basePt)} · Saved: ${currencyCentFmt.format(savedSoFar)}${aprStr}`;
      }
      return `${formatMonthPrefix(m, rec?.year)} · Cum. Interest: ${currencyCentFmt.format(actPt)}${aprStr}`;
    },
  });
}
