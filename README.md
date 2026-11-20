# HELOC Trajectory & Payment Shock Calculator

[![CI](https://github.com/Hawzy/heloc-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/Hawzy/heloc-calculator/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-0f6d50.svg)](LICENSE)

A deterministic Home Equity Line of Credit (HELOC) APR, draw-to-repayment payment shock, and amortization simulation engine available as:

- **Live 100% Client-Side Web Calculator:** [https://hawzy.github.io/heloc-calculator/](https://hawzy.github.io/heloc-calculator/)
- **Python Package & CLI (`heloc`):** Local engine, tabular reporting, and CSV export
- **Antigravity Agent Tool (`calculate_heloc_trajectory`):** Structured JSON + annual milestones for local AI agents

---

## Privacy & Architecture

- **Zero Backend, Zero API Keys, Zero Telemetry:** The web calculator executes entirely inside your browser via zero-dependency ES modules (`web/js/engine/`). Financial inputs never leave your machine, and there are zero cookies, analytics scripts, or external font/CDN requests.
- **Single-Source-of-Truth Python ↔ JS Parity:** `scripts/generate_golden_fixtures.py` exports deterministic golden JSON test vectors directly from Python, and CI asserts cent-level agreement (`<= $0.01`, targeting `$0.00` via binary64 round-half-to-even) between Python and JS across all benchmark and edge-case scenarios.

---

## Mathematical & Statutory Reference

### 1. Daily Periodic Rate (DPR) & Draw-Period Finance Charges

Under Regulation Z (`12 CFR 1026.40`), open-end HELOC APR disclosures correspond strictly to the periodic rate. Converting an annual percentage rate $\text{APR}$ into a Daily Periodic Rate depends on the lender's day-count basis $B \in \{365, 360\}$:

$$\text{DPR} = \frac{\text{APR}}{100 \times B}$$

For a billing cycle of $D$ days with daily closing balances $B_1, \dots, B_D$, the Average Daily Balance ($\text{ADB}$) and finance charge are:

$$\text{ADB} = \frac{1}{D}\sum_{d=1}^{D} B_d, \qquad \text{Finance Charge} = \text{ADB} \times \text{DPR} \times D$$

For example, across a 30-day cycle with 10 days at \$40,000, 10 days at \$45,000, and 10 days at \$43,000, the Average Daily Balance is \$42,666.67; at 7.25% APR on a 365-day basis ($\text{DPR} \approx 0.00019863$), the 30-day finance charge is approximately \$254. For uniform multi-decade monthly simulation, the engine uses $D = 365 / 12$ days per cycle and supports `average_daily_balance`, `adjusted_balance` (deducting prepayments prior to interest accrual), and `previous_balance` conventions.

### 2. Effective Rate Resolution & Statutory Ceilings

Each simulated month $m \ge 1$ resolves its active effective APR subject to both contractual caps and statutory simple-interest limits—such as the Washington Consumer Loan Act (`WAC 208-620-235`) 25.0% maximum rate:

$$C_{\text{applied}} = \min(C_{\text{lifetime}},\, C_{\text{regulatory}})$$

$$\text{APR}_{\text{eff}}(m) = \begin{cases} \max\big(0,\, \min(\text{APR}_{\text{intro}},\, C_{\text{applied}})\big), & \text{if intro teaser active and } m \le M_{\text{intro}} \\ \max\big(0,\, \min(\text{Prime}(m) + \text{Margin},\, C_{\text{applied}})\big), & \text{otherwise} \end{cases}$$

### 3. Repayment Phase Dynamic Re-Amortization & Payment Shock

When the draw period ends at month $M_{\text{draw}}$, revolving draws freeze and the remaining balance $P$ transitions to fully amortizing payments over $n = M_{\text{total}} - m + 1$ remaining months at monthly periodic rate $r = \text{APR}_{\text{eff}}(m) / 1200$:

$$M = \begin{cases} 0, & \text{if } P \le 0 \text{ or } n \le 0 \\ P / n, & \text{if } r \le 0 \\ P \cdot \dfrac{r(1 + r)^n}{(1 + r)^n - 1}, & \text{otherwise} \end{cases}$$

Because variable Prime movements alter $r$, $M$ is re-amortized each month using the live remaining principal $P$ and remaining term $n$. **Payment shock** measures the jump from the last draw-period required payment to the first repayment-period required payment, while **prepayment savings** compare total interest and payoff months against a twin `$0`-prepayment baseline simulation.

---

## Python Package, CLI & Agent Tool

### Installation

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

### CLI Usage

```bash
heloc --balance 50000 --limit 100000 --prime 6.0 --margin 2.0 \
      --intro-apr 0.99 --intro-months 12 --prepayment 300 \
      --scenario rising --annual-rate-step 0.5 --csv schedule.csv
```

Or via module invocation:

```bash
python -m heloc --balance 50000 --limit 100000 --scenario stress_test
```

### Python / Antigravity Agent Tool Usage

```python
from heloc.tools import calculate_heloc_trajectory

result = calculate_heloc_trajectory(
    initial_principal=50000.0,
    credit_limit=100000.0,
    margin=2.0,
    intro_apr=0.99,
    intro_duration_months=12,
    prime_rate=6.0,
    rate_scenario="rising",
    annual_rate_step=0.5,
    monthly_prepayment=300.0,
)
print(result["summary"])
print(result["milestones"])
```

---

## Development & Parity Verification

Run all Python unit and benchmark suites, check Python ↔ JS golden fixture drift, run Node parity/UI tests, and preview the static site locally:

```bash
# 1. Python test suite (8 test modules)
pytest -v

# 2. Verify golden parity fixtures match the live Python engine
python scripts/generate_golden_fixtures.py --check

# 3. Run JavaScript parity and UI utility tests (Node 24+)
node --test web/tests/*.test.mjs

# 4. Preview the 100% static web frontend locally
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

---

## Disclaimer

This software models Regulation Z (`12 CFR 1026.40`) open-end credit conventions and Washington Consumer Loan Act (`WAC 208-620-235`) usury caps strictly for **educational simulation and software demonstration**. It does not constitute financial, tax, or legal advice; verify actual HELOC terms with your lender's disclosures.

## License

Released under the [MIT License](LICENSE).
