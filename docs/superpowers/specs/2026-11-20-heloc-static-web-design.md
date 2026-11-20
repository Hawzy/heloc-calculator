# Design Spec: HELOC Calculator Static Web Frontend & Public Repository (`Hawzy/heloc-calculator`)

**Date:** 2026-11-20
**Status:** Approved by User
**Target Repo:** `github.com/Hawzy/heloc-calculator`
**Target Pages URL:** `https://hawzy.github.io/heloc-calculator/`

## 1. Intent & Why

Publish `c:\github\agy\heloc` as a standalone public GitHub repository (`github.com/Hawzy/heloc-calculator`, MIT licensed) hosting a fast, 100% client-side, zero-telemetry static web HELOC simulator on GitHub Pages (`https://hawzy.github.io/heloc-calculator/`), ready to link from `hawzy.github.io/projects/`. Preserve the existing Python `heloc-calculator` package, `heloc` CLI, `calculate_heloc_trajectory` Antigravity agent tool, and all 8 `pytest` suites, with automated Python <-> JS parity enforced in CI.

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
1. **Pure ES-Module Engine Port (`web/js/engine/`):** Port `heloc/core/{formulas,models,rates,simulator}.py` and the milestone/annual aggregation logic from `heloc/tools/trajectory_tool.py` to zero-dependency ES modules with cent-level (`<= $0.01`, targeting `$0.00` via Python-matching round-half-to-even) parity against Python.
2. **Single-Source-of-Truth CI Parity Gate:** Generate deterministic golden JSON fixtures (`tests/fixtures/golden_parity_vectors.json`) from Python via `scripts/generate_golden_fixtures.py` (with `--check` drift detection) covering all 5 benchmark scenarios in `tests/test_benchmark_scenarios.py`, edge cases (`ADJUSTED_BALANCE` vs `AVERAGE_DAILY_BALANCE`, `0%` APR amortization, early payoff during draw period, `CUSTOM` prime schedule padding/truncation, and cent-rounding consistency), and unit formula vectors. Verify every vector in `web/tests/parity.test.mjs` via Node's built-in `node --test`.
3. **Standalone Precision Finance Static UI (`web/`):** Clean ledger/editorial design with `tabular-nums`, light + dark mode toggle, zero external network requests (system typography, inline SVG charts), explicit privacy stance, and Regulation Z (`12 CFR 1026.40`) / Washington CLA (`WAC 208-620-235`) educational non-advice disclaimer.
4. **Complete Feature Set:** Interactive inputs for all `HelocConfig` parameters and Prime scenarios (`flat`, `rising` + step, `stress_test`, `custom`), 6 KPI cards (initial draw payment, first repayment payment, payment shock `$` and `%`, total interest paid, actual payoff months/years, interest & months saved vs. `$0`-prepayment baseline), 3 interactive inline SVG charts (Remaining Balance vs. Baseline, Monthly Required vs. Total Payment with draw->repayment cliff and intro-rate expiration markers, Cumulative Interest vs. Baseline), milestone callouts, collapsible Annual/Monthly amortization table, 1-click CSV download, shareable URL query strings, and `localStorage` saved presets with load/delete/compare.
5. **GitHub Actions, Docs & Telemetry:** `.github/workflows/ci.yml` (`pytest` + fixture `--check` + `node --test`), `.github/workflows/deploy-pages.yml` (custom GitHub Actions Pages deploy of `web/` with `.nojekyll`), clean `README.md` with LaTeX math/statutory docs, MIT `LICENSE`, real headless browser verification across desktop & mobile viewports, and `docs/web_build_telemetry.md` with verified bundle sizes, test counts, and parity results for `c:\github\agy\blog-ops`.

### Non-Goals
- No backend server, no API keys, no FRED live Prime rate GitHub Action (hardcoded default Prime rate with manual UI override only).
- No Pyodide/WASM, no bundler, no `npm` runtime dependencies.
- No Monte Carlo simulation or mid-draw custom draw schedules beyond the Python engine's model.
- No automatic `git push` or GitHub remote creation.

### Anti-Goals
- Any outbound third-party network request (font CDN, analytics, trackers) or leaking query-string financial inputs via HTTP `Referer`.
- Any divergence between Python and JS math (e.g., wrong billing days constant, wrong rounding mode, mismatched shock calculation).
- Breaking any Python test, CLI flag, or `calculate_heloc_trajectory` contract.
- Committing `Python HELOC APR Calculator.md` or `.venv/`.

## 3. Hard Constraints & Invariants

1. Never run `git push` automatically and never modify or create git remotes automatically.
2. `.gitignore` excludes `Python HELOC APR Calculator.md`, `.venv/`, `venv/`, and `.superpowers/`.
3. 100% client-side execution, zero secrets, zero telemetry, `<meta name="referrer" content="no-referrer">`, zero `innerHTML` with untrusted input, explicit privacy badge/footer statement, and Regulation Z (`12 CFR 1026.40`) / WA CLA (`WAC 208-620-235`) educational non-advice disclaimer.
4. Preserve `heloc` CLI, `calculate_heloc_trajectory`, `simulate_heloc` returning `(TrajectorySummary, list[MonthlyRecord], pd.DataFrame)`, and all 8 `pytest` suites (verified locally in an isolated `.venv`; `pandas` stays in `pyproject.toml` because `test_simulator.py` explicitly asserts `isinstance(df, pd.DataFrame)`).
5. All asset paths in `web/` are relative (`./styles.css`, `./js/app.js`) so the app works both at `/` locally and at `/heloc-calculator/` on GitHub Pages, and shareable URLs preserve `origin + pathname`.
6. CI parity gate triggers hard failure at `> $0.01` currency delta, `> 0.0001` APR/rate delta, or any mismatch in integer counts/phases/milestones, while recording actual observed max delta in `docs/web_build_telemetry.md`.
7. Open-source MIT License (`Hawzy` copyright holder), `LICENSE` file at root, and `license = { file = "LICENSE" }` in `pyproject.toml`.

## 4. Approaches Considered & Selected

- **Approach A (Selected):** Zero-build vanilla ES modules + custom interactive inline SVG charts (`web/` deployed directly to GitHub Pages, tested with `node --test`). Smallest payload (~40-60 KB uncompressed), zero `node_modules`, zero external requests, native CSS `light-dark()` & SVG accessibility.
- **Approach B (Rejected):** Zero-build vanilla ES modules + vendored chart library (`uPlot` / `Chart.js`). Adds 50-200 KB of third-party code and canvas theming/a11y glue while still needing custom HELOC cliff/intro annotations.
- **Approach C (Rejected):** Vite + TypeScript build pipeline. Adds `package.json`/lockfiles/`node_modules` and CI build complexity for an ~18 KB core engine.

## 5. Component Design

### 5.1 JS Core Engine (`web/js/engine/`)
- `rounding.js`: `pyRound(value, ndigits = 2)` implementing IEEE-754 binary64 round-half-to-even matching Python `round(x, ndigits)`.
- `models.js`: `BalanceMethod`, `YearBasis`, `RateScenarioType` enums + `validateConfig(raw)` mirroring `HelocConfig` constraints.
- `formulas.js`: `dailyPeriodicRate`, `averageDailyBalance`, `monthlyFinanceCharge` (default `daysInCycle = 30.4167`), `amortizedMonthlyInstallment`.
- `rates.js`: `getEffectiveRate(month, config, primeRate)`, `generatePrimeRates({ totalMonths, scenario, basePrime, annualStep, customRates })`.
- `simulator.js`: `runSingleTrajectory` & `simulateHeloc` preserving `365.0 / 12.0` days/month, `1e-4` early stop, `ADJUSTED_BALANCE` vs `AVERAGE_DAILY_BALANCE`/`PREVIOUS_BALANCE` draw-phase branching, dynamic re-amortization over `totalMonths - m + 1`, exact row-level rounding order (`tot = int + prin`, `req = tot - prep`), unrounded summary accumulation, and rounded payment shock delta.
- `trajectory.js`: `calculateHelocTrajectory` accepting months or years, returning `{ config, summary, milestones, annual_trajectory, records, baseline_records, prime_schedule, cap_stats }`.

### 5.2 Parity Fixture Generator & Tests
- `scripts/generate_golden_fixtures.py` -> `tests/fixtures/golden_parity_vectors.json` (`--check` exits non-zero on drift).
- `web/tests/parity.test.mjs` (`node --test`): checks all benchmark & edge-case scenarios plus unit formula vectors (`<= $0.01` currency, `<= 0.0001` APR, exact integers/strings/milestones), plus config validation tests.

### 5.3 Static Frontend (`web/`)
- **Files:** `web/index.html`, `web/styles.css`, `web/.nojekyll`, `web/js/app.js`, `web/js/engine/*.js`, `web/js/ui/{charts,table,state,presets,csv,theme,a11y}.js`.
- **Precision Finance Theme & Modern Web Compliance:**
  - CSS `@layer reset, tokens, base, layout, components, utilities;` with logical properties, `:has()`, `tabular-nums`, light/dark tokens, `forced-colors: active` safe borders/outlines, and `prefers-reduced-motion`.
  - `<meta name="color-scheme" content="light dark">` + tiny synchronous inline FOUC-prevention script + two-state header toggle (System vs. Override, synced across tabs via `storage` event).
  - Semantic landmarks (`<header>`, `<main>`, `<footer>`), skip link, `<fieldset>`/`<legend>` parameter groups, radio buttons for `Rate Scenario` and `Year Basis`, hints placed above inputs, `:is(:user-invalid, .user-invalid-fallback)` + JS `aria-invalid`/`aria-describedby` sync + single polite live-region announcer.
- **Initial Landing Scenario:** Blueprint scenario (`$50,000` / `$100,000`, `6.00%` Prime + `2.00%` margin, `0.99%` 12-mo intro, `rising` `+0.50%/yr`, `+$300/mo` prepay) plus 5 one-click benchmark presets.
- **Outputs:**
  - **6 KPI cards** (CSS Grid + `subgrid`): Initial Draw Payment, First Repayment Payment, Payment Shock (`$` and `%` with non-color icon badge), Total Interest Paid (with Total Outlay), Actual Payoff Horizon, Savings vs. `$0` Prepayment Baseline—plus an active regulatory/cap status banner.
  - **3 Interactive Inline SVG Charts:** (1) Remaining Balance vs. Baseline (full-width hero), (2) Monthly Required vs. Total Payment with Intro Expiration and Draw -> Repayment Cliff markers, (3) Cumulative Interest vs. Baseline with effective APR callout—each with pointer + keyboard crosshair inspection, `<figure>/<figcaption>`, and `<svg role="img"><title>`.
  - **Milestones & Schedule:** Chronological milestone cards; collapsible responsive amortization table (`Annual` / `Monthly` toggle, Phase filter, sticky headers, `@container` mobile card stack) + **1-click CSV download** matching the exact 12 `MonthlyRecord` columns.
  - **Sharing & Presets:** Shareable URL query string (`?principal=...&margin=...`); `localStorage` (`heloc-calculator:presets:v1`) Save / Load / Delete + **Compare vs.** KPI delta strip.

### 5.4 CI, Pages, README & Build Telemetry
- `.github/workflows/ci.yml`: Python 3.12 + Node 24 running `pytest -v`, `python scripts/generate_golden_fixtures.py --check`, and `node --test web/tests/*.test.mjs`.
- `.github/workflows/deploy-pages.yml`: Parity gate + official `configure-pages@v5` / `upload-pages-artifact@v3` (`path: web`) / `deploy-pages@v4`.
- `LICENSE` (MIT, `Hawzy`), updated `pyproject.toml`, `README.md` (live demo link, GitHub LaTeX math & statutory reference, Python CLI/tool/dev guide), and `docs/web_build_telemetry.md` (per-file and total uncompressed/gzipped sizes, test counts, max parity delta, and headless browser desktop/mobile verification results).
