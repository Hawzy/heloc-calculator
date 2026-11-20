# HELOC Calculator Static Web Frontend & Public Repo Implementation Plan

> **For agentic workers:** Execute this plan task-by-task in order, verifying every test and check before committing each task. **NEVER run `git push` automatically.**

**Goal:** Turn `c:\github\agy\heloc` into a public-ready `Hawzy/heloc-calculator` repo with a fast, 100% client-side, zero-telemetry static web calculator deployed via GitHub Actions to GitHub Pages (`https://hawzy.github.io/heloc-calculator/`), backed by a zero-dependency ES-module engine kept cent-identical to Python via CI golden fixtures, while keeping the Python package, CLI, Antigravity tool, and all 8 `pytest` suites intact.

**Architecture:** Zero-build static frontend under `web/` (`index.html`, `styles.css`, `js/engine/*.js`, `js/ui/*.js`, `js/app.js`, `.nojekyll`) using native ES modules, custom interactive inline SVG charts, and Node 24's built-in `node:test`. A Python script (`scripts/generate_golden_fixtures.py`) exports deterministic JSON test vectors directly from `heloc/`, and CI runs `pytest`, `--check` fixture drift detection, and `node --test`.

**Tech Stack:** Python 3.12 (`.venv`, Pydantic v2, Pandas, Pytest), Vanilla ES Modules (Node 24 `node:test`), Modern HTML5/CSS3 (`@layer`, `light-dark()`, `color-scheme`, `@container`, `subgrid`, `:user-invalid`), Inline SVG, GitHub Actions (`deploy-pages`).

**Spec:** `docs/superpowers/specs/2026-11-20-heloc-static-web-design.md`

---

## Global Constraints
1. **Never run `git push` automatically** and never create/modify a git remote automatically.
2. **Exclude untracked research doc & local envs:** `.gitignore` must exclude `Python HELOC APR Calculator.md`, `.venv/`, `venv/`, and `.superpowers/`.
3. **100% client-side, zero secrets, zero telemetry, zero outbound network requests:** No external font CDNs, no external scripts/CDNs, no analytics, `<meta name="referrer" content="no-referrer">`, zero `innerHTML` with untrusted strings, explicit privacy notice in UI, and Regulation Z (`12 CFR 1026.40`) / WA CLA (`WAC 208-620-235`) educational non-advice disclaimer.
4. **Keep Python package intact:** Preserve `heloc = "heloc.cli.main:main"`, `calculate_heloc_trajectory`, `simulate_heloc` returning `(TrajectorySummary, list[MonthlyRecord], pd.DataFrame)`, `pandas` dependency in `pyproject.toml`, and all 8 `tests/test_*.py` suites passing inside an isolated `.venv`.
5. **Windows PowerShell note:** Script execution policy blocks `.ps1` shims (`npm`, `npx`, `Activate.ps1`). Always invoke `.\.venv\Scripts\python.exe`, `.\.venv\Scripts\pytest.exe`, `node`, and `npx.cmd` directly.
6. **GitHub Pages subpath compatibility:** Every asset reference inside `web/` must be relative (`./styles.css`, `./js/app.js`), and shareable URLs must preserve `window.location.origin + window.location.pathname`.
7. **License:** MIT License with copyright holder `Hawzy` (from `git log`), `LICENSE` at repo root, `license = { file = "LICENSE" }` in `pyproject.toml`, and License section in `README.md`.
8. **CI parity gate:** Hard CI failure on `> $0.01` currency delta, `> 0.0001` APR/rate delta, or any integer/string/milestone mismatch; target `$0.00` exact parity via IEEE-754 binary64 round-half-to-even (`pyRound`) and record actual observed max delta in `docs/web_build_telemetry.md`.

## Review Focus (Uncovered Failure Modes Pinned by Tests)
1. **Malformed/tampered URL query strings** (`?principal=-500&limit=abc&scenario=hack&introApr=NaN&customRates=foo,bar`) — must fall back cleanly to valid defaults without `NaN` outputs, crashes, or XSS (pinned in Task 4).
2. **Cross-field validation (`initial_principal > credit_limit`) during live editing** — must flag `aria-invalid="true"`, show inline error via `aria-describedby` + polite live announcer, and retain the last valid simulation state rather than crashing or blanking charts (pinned in Task 3 & Task 8).
3. **Early payoff during draw period / before intro expiration** (`$10k` balance, `$2k/mo` prepayment -> 5 months) — omits Repayment Phase Shift & Intro Expiration milestones, sets shock to `$0.00 (0.0%)`, and renders short-horizon SVG charts without zero-division or broken axes (pinned in Task 3 & Task 8).
4. **Blocked or corrupted `localStorage`** (`SecurityError` or invalid JSON in `heloc-calculator:presets:v1`) — theme toggle and preset storage degrade gracefully with zero uncaught errors (pinned in Task 4).
5. **Subpath URLs & zero external requests** — share URLs preserve `/heloc-calculator/` pathname, all assets resolve relatively, and headless browser network inspection confirms zero requests outside `127.0.0.1` (pinned in Task 4 & Task 8).

---

## Task 1: Save Design Spec & Plan, Update Repo Hygiene, & Verify Python `.venv`
- [x] Save `docs/superpowers/specs/2026-11-20-heloc-static-web-design.md`
- [x] Save `docs/superpowers/plans/2026-11-20-heloc-static-web-implementation.md`
- [ ] Create MIT `LICENSE` (`Copyright (c) 2026 Hawzy`)
- [ ] Update `.gitignore` and `pyproject.toml`
- [ ] Create isolated `.venv`, install `-e ".[dev]"`, run `pytest -v` across all 8 suites, verify `git status`
- [ ] Commit Task 1

## Task 2: Golden Parity Fixture Generator (`Python -> JSON`)
- [ ] Implement `scripts/generate_golden_fixtures.py` with `--check` support
- [ ] Generate `tests/fixtures/golden_parity_vectors.json` covering 12 scenarios + formula vectors
- [ ] Verify `--check` and `pytest -v`
- [ ] Commit Task 2

## Task 3: Pure ES-Module Financial Engine & Automated Parity Test Suite
- [ ] Write `web/tests/parity.test.mjs`
- [ ] Verify failure prior to implementation
- [ ] Implement `web/js/engine/{rounding,models,formulas,rates,simulator,trajectory,index}.js`
- [ ] Run `node --test web/tests/parity.test.mjs` and verify cent parity
- [ ] Commit Task 3

## Task 4: URL Query State, `localStorage` Presets, Built-in Scenarios, & CSV Exporter
- [ ] Write `web/tests/ui-utils.test.mjs`
- [ ] Verify failure prior to implementation
- [ ] Implement `web/js/ui/{state,presets,csv}.js`
- [ ] Run `node --test web/tests/*.test.mjs`
- [ ] Commit Task 4

## Task 5: Theme, Validation Accessibility, Interactive SVG Charts, & Responsive Schedule Table
- [ ] Implement `web/js/ui/{theme,a11y,charts,table}.js`
- [ ] Verify ES module syntax and tests
- [ ] Commit Task 5

## Task 6: Static Web Application Shell, Precision Finance Styles, & Main Controller
- [ ] Implement `web/.nojekyll`, `web/index.html`, `web/styles.css`, `web/js/app.js`
- [ ] Run `node --check web/js/app.js` and `node --test web/tests/*.test.mjs`
- [ ] Commit Task 6

## Task 7: GitHub Actions Workflows (`ci.yml` + `deploy-pages.yml`) & Public `README.md`
- [ ] Create `.github/workflows/ci.yml` and `.github/workflows/deploy-pages.yml`
- [ ] Create `README.md` with LaTeX formulas, statutory docs, Python/CLI/Tool usage, and MIT license
- [ ] Validate YAML workflows
- [ ] Commit Task 7

## Task 8: Real Headless Browser Verification, Build Telemetry, & Final Safety Audit
- [ ] Start local HTTP server daemon and verify in real headless browser at `1440x900` and `390x844`
- [ ] Stop daemon, measure exact uncompressed & gzipped bundle sizes, re-run all Python and Node test gates
- [ ] Write `docs/web_build_telemetry.md` and commit
- [ ] Final safety audit (`git status`, `git log`, `git ls-files`)
