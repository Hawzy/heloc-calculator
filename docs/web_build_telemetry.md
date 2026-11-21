# Web Build & Verification Telemetry

**Date:** 2026-11-21  
**Branch:** `main`  
**Target Repository:** `https://github.com/Hawzy/heloc-calculator`  
**Target GitHub Pages URL:** `https://hawzy.github.io/heloc-calculator/`  
**Architecture:** Zero-build vanilla ES modules + custom inline SVG charts (zero `node_modules`, zero external network dependencies)

---

## 1. Deployed Static Bundle Size (`web/`, excluding `web/tests/`)

Measured after final build edits using Python `pathlib` and `gzip.compress(..., compresslevel=9)`:

| File | Uncompressed (Bytes) | Gzipped (Bytes) |
| :--- | ---: | ---: |
| `web/.nojekyll` | 0 | 20 |
| `web/index.html` | 48,807 | 9,541 |
| `web/styles.css` | 44,096 | 7,746 |
| `web/js/app.js` | 59,220 | 13,677 |
| `web/js/engine/analytics.js` | 9,192 | 2,541 |
| `web/js/engine/formulas.js` | 1,923 | 744 |
| `web/js/engine/index.js` | 677 | 370 |
| `web/js/engine/models.js` | 10,099 | 2,603 |
| `web/js/engine/rates.js` | 2,481 | 938 |
| `web/js/engine/rounding.js` | 1,858 | 761 |
| `web/js/engine/simulator.js` | 11,911 | 3,016 |
| `web/js/engine/trajectory.js` | 8,310 | 2,404 |
| `web/js/ui/a11y.js` | 10,398 | 2,752 |
| `web/js/ui/charts.js` | 27,492 | 7,343 |
| `web/js/ui/csv.js` | 2,439 | 1,128 |
| `web/js/ui/dates.js` | 3,905 | 1,231 |
| `web/js/ui/presets.js` | 3,576 | 1,184 |
| `web/js/ui/state.js` | 16,777 | 4,475 |
| `web/js/ui/table.js` | 7,893 | 2,266 |
| `web/js/ui/theme.js` | 2,768 | 1,023 |
| **Core JS Engine Subtotal (8 files)** | **46,451 (45.36 KiB)** | **13,377 (13.06 KiB)** |
| **Total Deployed Site (20 files)** | **273,822 (267.40 KiB)** | **65,763 (64.22 KiB)** |

---

## 2. Automated Test & Python ↔ JS Parity Gate Results

| Check | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| Python Unit, CLI, Tool & Benchmark Suites | `.venv\Scripts\pytest.exe -v` | **66 passed** (`0` failed) | All 9 `tests/test_*.py` modules passed on Python 3.12.7 (`58` v1 + `8` v2 suites) |
| Golden Fixture Drift Check | `.venv\Scripts\python.exe scripts/generate_golden_fixtures.py --check` | **Passed** (exit `0`) | 17 benchmark & edge-case scenarios + 4 formula vector groups + 3 v2 analytics groups (`cltv`, `goal_solver`, `heloan`) verified against live Python engine |
| Node Parity & UI Utility Suites | `node --test web/tests/parity.test.mjs web/tests/ui-utils.test.mjs` | **19 passed** (`0` failed) | Node `v24.21.0`; `7` parity tests + `12` UI/date/CSV/regression tests |
| Observed Max Parity Delta (Python vs. JS) | `web/tests/parity.test.mjs` | **`$0.0000` / `0.000000%`** | Exact cent and APR agreement across every summary field, annual aggregate, milestone, and monthly row of all 17 golden scenarios (`CI gate <= $0.01` currency, `<= 0.0001%` rate) and all analytics vectors |

---

## 3. Real Headless Browser Verification (`http://127.0.0.1:8765/`)

Verified via the browser subagent against `python -m http.server 8765 --bind 127.0.0.1 --directory web`:

### Desktop Viewport (`1440×900`)
- **Console / Page Errors:** `0` across initial load, interactions, and re-verification reload.
- **Network Requests:** `17` initial same-origin HTTP `200 OK` requests (`127.0.0.1:8765`), `0` failed requests, `0` external requests.
- **Layout & `[hidden]` State:** Root `html`/`body` width `1424.67px <= 1440px` (zero horizontal overflow); after CSS `[hidden]` and `<summary>` fixes, `#validation-banner`, `#url-warning-banner`, `#compare-strip`, `#saved-presets-row` (empty), and `#custom-rates-group` verified absent/hidden visually and via bounding boxes.
- **Inline SVG Charts:** All 3 SVG charts (`#chart-balance`, `#chart-payment`, `#chart-interest`) rendered cleanly with 3 `<path>` elements each, with milestone labels (`Intro Ends (Mo 12)`, `Repay Starts (Mo 121)`) cleanly positioned above the top gridline (`y = 330.19` vs. top gridline `y = 342.08` on `#chart-balance`).
- **Blueprint Default KPI Parity:** Rendered `$41.25/mo`, `$164.02/mo`, `+$15.06/mo` (`+10.1%`), `$31,699.80`, `166 mos (13.8 yrs)`, `$134,309.88` (`194 months faster`) — exact cent match against `blueprint_rising_prepay` golden fixture.
- **Benchmark Presets & Edge Cases:**
  - `WA 25% Usury Cap`: `#cap-status-strip` reported WA CLA `25.00%` clamping starting Month 1; rendered `$416.67/mo`, `$1,900.89/mo`, `+$1,484.22/mo` (`+356.2%`), `$7,810.61`, `24 mos`.
  - `Early Draw Payoff`: rendered `5 mos (0.4 yrs)`, `$0.00/mo` shock, and omitted `Phase Shift: Repayment Period Begins` milestone.
- **Cross-Field Validation:** Setting `#initial-principal` to `150000` (> limit) set `aria-invalid="true"`, showed `#validation-banner`, and kept all 3 SVG charts intact; `#reset-btn` cleanly restored defaults.
- **Theme Toggle & `localStorage` Presets + Compare:** Theme toggle updated `<meta name="color-scheme">` (`"light dark"` <-> `"dark"`) and persisted across reload; saved `Browser Test Plan` persisted across reload and loaded cleanly; comparing against `Flat Baseline` rendered `#compare-strip` (`-$71,267.31` interest, `-194 mos`, `-$59.80` shock, `-$333.75` initial draw).
- **CSV Export:** `#download-csv-btn` triggered client-side `blob:` download of `heloc_amortization_schedule.csv` (`13,467` bytes).
- **URL Query Restore:** Loading `?principal=60000&limit=120000&prime=6.5&margin=2.5&scenario=stress_test&drawMonths=60&repayMonths=120&prepay=0&introApr=` restored all inputs and rendered `$450.00/mo`, `$913.65/mo`, `+$238.65/mo` (`+35.4%`), `$85,412.49`, `180 mos (15.0 yrs)` — exact cent match against `stress_test_15yr`.

### Mobile Viewport (`390×844`)
- **Console Errors & Horizontal Overflow:** `0` console errors; `html`, `body`, and `main` width `374.67px <= 390px` (zero horizontal overflow).
- **SVG Charts:** All 3 SVG charts scaled cleanly within viewport (`right = 302.00px <= 390px`).
- **Responsive `@container` Table:** `.schedule-table thead` hidden (`isVisible() === false`), rendering rows as stacked labeled cards.

### Post-QA Multi-Viewport Verification (`1440×900`, `768×1024`, `390×844`, `320×568`)
Verified after the QA fixes (`step="any"` decimal inputs, named field error banners, `<figure>` margin reset, `.schedule-controls` inline layout, `@container (width < 780px)` card breakpoint, `#save-preset-btn` `nowrap`, and SVG backdrop pills):

| Viewport | Body Width / Overflow | Highlights Verified |
| :--- | :--- | :--- |
| **Desktop (`1440×900`)** | Zero horizontal overflow (`0` console, `0` failed/external requests) | Fresh-load editing of prepayment, principal, intro checkbox, draw unit, balance method, year basis, and decimals (`18.25`, `2.33`) updated immediately with zero freeze; invalid `#lifetime-cap = 0` flagged the control and surfaced `Fix "Lifetime Cap (%)" to update results; displaying last valid trajectory.`; `.schedule-controls` sat inline on one row (`439.52×49.33px`); SVG backdrop pills (`chart-band-pill`, `chart-callout-bg`) rendered cleanly without overlapping curves across `Blueprint Rising`, `Stress Test 15yr`, and `WA 25% Usury Cap`. |
| **Tablet (`768×1024`)** | `752.67px` (`0` overflow, `0` console errors) | Schedule cleanly switched to `@container (width < 780px)` stacked cards (`thead` hidden). |
| **Mobile (`390×844`)** | `374.67px` (`0` overflow, `0` console errors) | All 3 SVG charts widened from `229px` to `328.54px` after resetting `<figure>` margins. |
| **Small Mobile (`320×568`)** | `304.67px` (`0` overflow, `0` console errors) | All 3 SVG charts widened from `159px` to `258.54px`; `#save-preset-btn` stayed single-line (`97.95×48px`); Monthly `Mo 1` stacked card (`249.88×414.04px`) fit cleanly inside `.table-wrapper` (`266.54×454.40px`). |

### v2 Multi-Viewport Verification (`http://127.0.0.1:8787/`)
Verified across `1440×900`, `768×1024`, `390×844`, and `320×568` with **`0` console errors**, `19` same-origin `200 OK` initial requests, `0` failed requests, and `0` external requests:

- **Collapsed Quick-View & Blueprint Parity:** All 6 `<details>` drawers (`#drawer-cltv`, `#drawer-solver`, `#drawer-events`, `#drawer-draw-heloan`, `#drawer-dates-fees`, `#drawer-advanced`) loaded collapsed (`open === null`), while default KPIs matched Python Blueprint (`$41.25/mo`, `$164.02/mo`, `+$15.06/mo`, `$31,699.80`, `166 mos (13.8 yrs)`, `$134,309.88`).
- **Linked Sliders & Accessible Popover Toggletips:** Setting `#prime-range` to `7.5` updated `#prime-rate = "7.5"`, `aria-valuetext = "7.5%"`, and total interest to `$36,223.61`. Clicking `button[popovertarget="tip-margin"]` opened `#tip-margin` (`aria-expanded === "true"`) and `Escape` dismissed it cleanly (`aria-expanded === "false"`).
- **CLTV Borrowing Power Estimator:** `$600k` home / `$350k` mortgage / `85%` max CLTV computed `$160,000` eligible line (`75.0%` limit CLTV, `66.7%` drawn CLTV) and 1-click Apply updated `#credit-limit` to `160000` (`31.3%` utilization).
- **Target Payoff Goal Solver:** `"Zero Payment Shock"` solved `$416.67/mo` extra prepayment (`Mo 120`, `$20,431.47` interest, `$0.00` shock); clicking Apply updated active KPIs to `$0.00/mo` shock and `120 mos (10.0 yrs)`.
- **Staged Events, Synchronized Crosshair, Draw Rules, Dates, Fees, HELoan & URL Restore:** Added `+$15k Kitchen Reno` (Mo 14) + `-$5k Annual Bonus` (Mo 12) (`2` `.chart-event-line` markers & milestones); pressing `Home` then `5× ArrowRight` on `#chart-balance` moved all 3 chart readouts to `Mo 6`; enabled `1.5%` balance min rule, Fixed HELoan `7.5% / 15yr` comparison (`$463.51/mo`), Nov `2026` start date (`Est. Dec 2036` & `Yr 1 (Nov 2026–Oct 2027)` rows), and `$650 + $75/yr + $500` fee ledger (`$1,475.00` fees, `$85,516.96` total w/ fees); URL share round-trip restored all state with `#url-warning-banner` hidden.
- **4-Viewport Zero Overflow (`documentElement.scrollWidth <= innerWidth`):**
  - `1440×900`: `1424.67px <= 1440px` (SVGs: `923.33px`, `437px`, `437px`)
  - `768×1024`: `752.67px <= 768px` (SVGs: `673.27px` each)
  - `390×844`: `374.67px <= 390px` (SVGs: `328.54px` each)
  - `320×568`: `304.67px <= 320px` (SVGs: `258.54px` each)
