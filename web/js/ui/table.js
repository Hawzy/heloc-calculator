/**
 * Accessible, responsive Annual/Monthly amortization table with sticky headers
 * and @container card-stack labels.
 */

import { pyRound } from "../engine/index.js";

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

function buildFilteredAnnualRows(records, phaseFilter) {
  const filtered =
    phaseFilter === "all" ? records : records.filter((r) => r.phase === phaseFilter);
  const groups = new Map();
  for (const r of filtered) {
    let g = groups.get(r.year);
    if (!g) {
      g = {
        year: r.year,
        phases: new Set([r.phase]),
        start_balance: r.starting_balance,
        end_balance: r.ending_balance,
        aprSum: r.effective_apr,
        total_payment: r.total_payment,
        interest_paid: r.interest_paid,
        principal_paid: r.principal_paid,
        count: 1,
      };
      groups.set(r.year, g);
    } else {
      g.phases.add(r.phase);
      g.end_balance = r.ending_balance;
      g.aprSum += r.effective_apr;
      g.total_payment += r.total_payment;
      g.interest_paid += r.interest_paid;
      g.principal_paid += r.principal_paid;
      g.count += 1;
    }
  }

  return Array.from(groups.values()).map((g) => ({
    year: g.year,
    phaseLabel:
      g.phases.size > 1
        ? "Draw -> Repay"
        : g.phases.has("draw")
          ? "Draw"
          : "Repayment",
    hasTransition: g.phases.size > 1,
    start_balance: pyRound(g.start_balance, 2),
    avg_apr: pyRound(g.aprSum / g.count, 2),
    total_payment: pyRound(g.total_payment, 2),
    interest_paid: pyRound(g.interest_paid, 2),
    principal_paid: pyRound(g.principal_paid, 2),
    end_balance: pyRound(g.end_balance, 2),
  }));
}

/**
 * Render the amortization schedule table cleanly inside `containerEl`.
 *
 * @param {{
 *   containerEl: HTMLElement,
 *   result: ReturnType<import('../engine/index.js').calculateHelocTrajectory>,
 *   viewMode: "annual" | "monthly",
 *   phaseFilter: "all" | "draw" | "repayment"
 * }} opts
 */
export function renderScheduleTable({ containerEl, result, viewMode, phaseFilter }) {
  containerEl.replaceChildren();

  const { config, records } = result;
  const wrapper = el("div", "table-wrapper");
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-labelledby", "schedule-table-caption");

  const table = el("table", `schedule-table schedule-table--${viewMode}`);
  const caption = el(
    "caption",
    "visually-hidden",
    `HELOC ${viewMode} amortization schedule (${phaseFilter} phases)`,
  );
  caption.id = "schedule-table-caption";
  table.append(caption);

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const tbody = document.createElement("tbody");

  if (viewMode === "annual") {
    const columns = [
      "Year",
      "Phase",
      "Start Balance",
      "Avg APR",
      "Total Paid",
      "Interest Paid",
      "Principal Paid",
      "End Balance",
    ];
    columns.forEach((label, idx) => {
      const th = el("th", idx >= 2 ? "num" : null, label);
      th.scope = "col";
      headRow.append(th);
      if (idx > 0) {
        table.style.setProperty(`--label-${idx + 1}`, `"${label}"`);
      }
    });

    const rows = buildFilteredAnnualRows(records, phaseFilter);
    if (rows.length === 0) {
      const emptyTr = document.createElement("tr");
      const emptyTd = el("td", "table-empty", "No rows match the selected phase filter.");
      emptyTd.colSpan = columns.length;
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
    } else {
      for (const row of rows) {
        const tr = document.createElement("tr");
        if (row.hasTransition) tr.classList.add("row-phase-transition");

        const th = el("th", null, `Year ${row.year}`);
        th.scope = "row";

        const phaseTd = el("td");
        phaseTd.append(
          el(
            "span",
            `phase-pill ${row.phaseLabel === "Draw" ? "phase-pill--draw" : "phase-pill--repay"}`,
            row.phaseLabel,
          ),
        );

        tr.append(
          th,
          phaseTd,
          el("td", "num", moneyFmt.format(row.start_balance)),
          el("td", "num", `${row.avg_apr.toFixed(2)}%`),
          el("td", "num", moneyFmt.format(row.total_payment)),
          el("td", "num", moneyFmt.format(row.interest_paid)),
          el("td", "num", moneyFmt.format(row.principal_paid)),
          el("td", "num", moneyFmt.format(row.end_balance)),
        );
        tbody.append(tr);
      }
    }
  } else {
    const columns = [
      "Month",
      "Year",
      "Phase",
      "Start Bal",
      "Eff APR",
      "Prime",
      "Required",
      "Prepay",
      "Total Pmt",
      "Interest",
      "Principal",
      "End Bal",
    ];
    columns.forEach((label, idx) => {
      const th = el("th", idx === 1 || idx >= 3 ? "num" : null, label);
      th.scope = "col";
      headRow.append(th);
      if (idx > 0) {
        table.style.setProperty(`--label-${idx + 1}`, `"${label}"`);
      }
    });

    const rows = phaseFilter === "all" ? records : records.filter((r) => r.phase === phaseFilter);
    if (rows.length === 0) {
      const emptyTr = document.createElement("tr");
      const emptyTd = el("td", "table-empty", "No monthly rows match the selected phase filter.");
      emptyTd.colSpan = columns.length;
      emptyTr.append(emptyTd);
      tbody.append(emptyTr);
    } else {
      const frag = document.createDocumentFragment();
      for (const r of rows) {
        const tr = document.createElement("tr");
        if (r.month === config.draw_period_months + 1) {
          tr.classList.add("row-phase-transition");
        }

        const th = el("th", null, `Mo ${r.month}`);
        th.scope = "row";

        const phaseTd = el("td");
        phaseTd.append(
          el(
            "span",
            `phase-pill ${r.phase === "draw" ? "phase-pill--draw" : "phase-pill--repay"}`,
            r.phase === "draw" ? "Draw" : "Repay",
          ),
        );

        tr.append(
          th,
          el("td", "num", String(r.year)),
          phaseTd,
          el("td", "num", moneyFmt.format(r.starting_balance)),
          el("td", "num", `${r.effective_apr.toFixed(2)}%`),
          el("td", "num", `${r.prime_rate.toFixed(2)}%`),
          el("td", "num", moneyFmt.format(r.required_payment)),
          el("td", "num", moneyFmt.format(r.prepayment)),
          el("td", "num", moneyFmt.format(r.total_payment)),
          el("td", "num", moneyFmt.format(r.interest_paid)),
          el("td", "num", moneyFmt.format(r.principal_paid)),
          el("td", "num", moneyFmt.format(r.ending_balance)),
        );
        frag.append(tr);
      }
      tbody.append(frag);
    }
  }

  thead.append(headRow);
  table.append(thead, tbody);
  wrapper.append(table);
  containerEl.append(wrapper);
}
