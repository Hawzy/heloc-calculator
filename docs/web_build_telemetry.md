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
| `web/index.html` | 28,749 | 6,458 |
| `web/styles.css` | 35,481 | 6,401 |
| `web/js/app.js` | 30,058 | 7,514 |
| `web/js/engine/formulas.js` | 1,923 | 744 |
| `web/js/engine/index.js` | 511 | 293 |
| `web/js/engine/models.js` | 5,365 | 1,622 |
| `web/js/engine/rates.js` | 2,481 | 938 |
| `web/js/engine/rounding.js` | 1,858 | 761 |
| `web/js/engine/simulator.js` | 6,920 | 1,968 |
| `web/js/engine/trajectory.js` | 7,411 | 2,146 |
| `web/js/ui/a11y.js` | 7,457 | 1,945 |
| `web/js/ui/charts.js` | 23,319 | 6,300 |
| `web/js/ui/csv.js` | 1,974 | 935 |
| `web/js/ui/presets.js` | 3,439 | 1,141 |
| `web/js/ui/state.js` | 10,396 | 3,053 |
| `web/js/ui/table.js` | 7,163 | 2,035 |
| `web/js/ui/theme.js` | 2,768 | 1,023 |
| **Core JS Engine Subtotal (7 files)** | **26,469 (25.85 KiB)** | **8,472 (8.27 KiB)** |
| **Total Deployed Site (18 files)** | **177,273 (173.12 KiB)** | **45,297 (44.24 KiB)** |

---

## 2. Automated Test & Python ↔ JS Parity Gate Results

| Check | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| Python Unit, CLI, Tool & Benchmark Suites | `.venv\Scripts\pytest.exe -v` | **58 passed** (`0` failed) | All 8 `tests/test_*.py` modules passed on Python 3.12.7 |
| Golden Fixture Drift Check | `.venv\Scripts\python.exe scripts/generate_golden_fixtures.py --check` | **Passed** (exit `0`) | 12 benchmark & edge-case scenarios + 4 formula vector groups verified against live Python engine |
| Node Parity & UI Utility Suites | `node --test web/tests/parity.test.mjs web/tests/ui-utils.test.mjs` | **15 passed** (`0` failed) | Node `v24.21.0`; `6` parity tests + `9` UI utility/regression tests (including `step="any"` decimal-input regression guard) |
| Observed Max Parity Delta (Python vs. JS) | `web/tests/parity.test.mjs` | **`$0.0000` / `0.000000%`** | Exact cent and APR agreement across every summary field, annual aggregate, milestone, and monthly row of all 12 golden scenarios (`CI gate <= $0.01` currency, `<= 0.0001%` rate) |

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
