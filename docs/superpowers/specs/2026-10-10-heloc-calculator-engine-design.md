# Design Spec: Localized HELOC Simulation Engine & Antigravity Agent Tool

**Date:** 2026-10-10  
**Status:** Approved by User  
**Target Architecture:** Modular Layered Python Engine + CLI + Google Antigravity Agent Tool

---

## 1. Executive Summary & Objective

This specification defines the architecture, financial mechanics, and software design for a localized Home Equity Line of Credit (HELOC) simulation and Annual Percentage Rate (APR) calculation engine in Python, built from the research blueprint in `Python HELOC APR Calculator.md`.

The system models:
1. **Federal and State Regulatory Boundaries**: Regulation Z (12 CFR 1026.40) open-end APR periodic rate calculations, lifetime interest rate caps, and Washington Consumer Loan Act (WAC 208-620-235) simple interest usury ceilings (max 25.0%).
2. **Lifecycle Transitions**: 
   - A revolving **Draw Period** (e.g., 10 years) calculating interest-only minimum finance charges via Average Daily Balance (ADB), Adjusted Balance, or Previous Balance across 365 or 360-day conventions.
   - Transition to a fully amortizing **Repayment Period** (e.g., 20 years), explicitly modeling "payment shock" and dynamic re-amortization under variable Prime rate changes.
3. **Comparative Prepayment Tracking**: Quantifying the acceleration of principal payoff, lifetime interest savings, and tenure reduction resulting from user prepayments.
4. **Agentic Integration**: Providing an in-process, type-annotated custom tool callable by Google Antigravity AI agents (and MCP/local tools), alongside an interactive CLI.

---

## 2. System Architecture & Directory Layout

The codebase follows a modular layered architecture:

```
heloc/
├── __init__.py
├── __main__.py               # CLI entrypoint alias
├── core/
│   ├── __init__.py
│   ├── models.py             # Pydantic schemas, enums, and data contracts
│   ├── formulas.py           # Core financial formulas (DPR, ADB, amortization installment)
│   ├── rates.py              # Effective rate resolution, caps, and scenario generators
│   └── simulator.py          # Month-by-month stateful simulation engine
├── tools/
│   ├── __init__.py
│   └── trajectory_tool.py    # Antigravity agent tool callable with rich docstrings
├── cli/
│   ├── __init__.py
│   └── main.py               # CLI interface with tabular reporting & CSV export
└── tests/
    ├── __init__.py
    ├── test_formulas.py      # Unit tests for financial math
    ├── test_rates.py         # Tests for rate caps, intro resets, and usury limits
    ├── test_simulator.py     # Tests for 360-month lifecycle, shock, and prepayment savings
    └── test_tools.py         # Tests for agent tool invocation and schema contracts
```

---

## 3. Detailed Component Design

### 3.1 Core Data Models (`heloc/core/models.py`)

```python
from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field

class BalanceMethod(str, Enum):
    AVERAGE_DAILY_BALANCE = "average_daily_balance"
    ADJUSTED_BALANCE = "adjusted_balance"
    PREVIOUS_BALANCE = "previous_balance"

class YearBasis(int, Enum):
    DAYS_365 = 365
    DAYS_360 = 360

class RateScenarioType(str, Enum):
    FLAT = "flat"
    RISING = "rising"
    STRESS_TEST = "stress_test"
    CUSTOM = "custom"

class HelocConfig(BaseModel):
    initial_principal: float = Field(..., gt=0, description="Initial drawn loan balance")
    credit_limit: float = Field(..., gt=0, description="Total credit limit")
    margin: float = Field(default=2.0, ge=0, description="Fixed lender margin added to Prime (%)")
    intro_apr: Optional[float] = Field(default=None, ge=0, description="Introductory teaser APR (%)")
    intro_duration_months: int = Field(default=12, ge=0, description="Introductory rate period in months")
    draw_period_months: int = Field(default=120, ge=1, description="Draw period in months (e.g., 10 yrs = 120)")
    repayment_period_months: int = Field(default=240, ge=1, description="Repayment period in months (e.g., 20 yrs = 240)")
    lifetime_rate_cap: float = Field(default=18.0, gt=0, description="Contractual maximum rate ceiling (%)")
    regulatory_ceiling: float = Field(default=25.0, gt=0, description="Legal usury limit (%) under WAC 208-620-235")
    monthly_prepayment: float = Field(default=0.0, ge=0, description="Monthly principal prepayment amount")
    balance_method: BalanceMethod = Field(default=BalanceMethod.AVERAGE_DAILY_BALANCE)
    year_basis: YearBasis = Field(default=YearBasis.DAYS_365)

class MonthlyRecord(BaseModel):
    month: int
    year: int
    phase: str  # "draw" or "repayment"
    starting_balance: float
    effective_apr: float
    prime_rate: float
    required_payment: float
    prepayment: float
    total_payment: float
    interest_paid: float
    principal_paid: float
    ending_balance: float

class TrajectorySummary(BaseModel):
    initial_principal: float
    credit_limit: float
    total_months_scheduled: int
    actual_months_to_payoff: int
    total_interest_paid: float
    total_principal_paid: float
    total_payments: float
    initial_draw_payment: float
    first_repayment_payment: float
    payment_shock_amount: float
    payment_shock_pct: float
    interest_savings_vs_baseline: float = 0.0
    months_saved_vs_baseline: int = 0
```

### 3.2 Mathematical Formulas (`heloc/core/formulas.py`)

* **Daily Periodic Rate (DPR)**:
  `dpr = (annual_rate / 100.0) / float(year_basis)`
* **Average Daily Balance Finance Charge**:
  `finance_charge = adb * dpr * days_in_cycle`
  (Standard billing cycle default: 30.4167 days for uniform monthly modeling, or explicit calendar day counts).
* **Amortizing Monthly Installment**:
  For remaining principal balance $P$, monthly rate $r = \frac{\text{effective\_apr}}{1200}$, and remaining months $n$:
  If $r == 0$: $M = P / n$
  Else:
  $$M = P \cdot \frac{r(1 + r)^n}{(1 + r)^n - 1}$$
  If $P \le 0$ or $n \le 0$: $M = 0.0$.

### 3.3 Rate Resolution & Scenarios (`heloc/core/rates.py`)

* **Regulatory Ceiling**:
  $\text{applied\_cap} = \min(\text{lifetime\_rate\_cap}, \text{regulatory\_ceiling})$
* **Monthly Effective Rate**:
  - If month $\le \text{intro\_duration\_months}$ and `intro_apr` is provided:
    $\text{effective\_rate} = \min(\text{intro\_apr}, \text{applied\_cap})$
  - Else:
    $\text{effective\_rate} = \min(\text{prime\_rate}(m) + \text{margin}, \text{applied\_cap})$
* **Scenario Engine**:
  - `flat`: Prime rate remains constant.
  - `rising`: Prime rate increases by `step` (e.g. +0.50%) every 12 months.
  - `stress_test`: Prime climbs rapidly (e.g. +1.0% every 6 months up to a peak).
  - `custom`: Supports an explicit array of length equal to total months.

### 3.4 Stateful Simulation Loop (`heloc/core/simulator.py`)

* Traverses months $m = 1 \dots \text{total\_months}$:
  1. Determine current phase: `draw` if $m \le \text{draw\_period\_months}$ else `repayment`.
  2. Compute active `effective_apr`.
  3. In Draw Phase:
     - `interest_paid = balance * dpr * days_in_cycle`
     - `required_payment = interest_paid`
     - `principal_paid = min(monthly_prepayment, balance)`
     - `ending_balance = balance - principal_paid`
  4. In Repayment Phase:
     - Recalculate amortized installment $M$ based on remaining balance and remaining tenure ($N - m + 1$).
     - `interest_paid = balance * (effective_apr / 1200)`
     - `scheduled_principal = min(max(0, M - interest_paid), balance)`
     - `extra_principal = min(monthly_prepayment, balance - scheduled_principal)`
     - `principal_paid = scheduled_principal + extra_principal`
     - `ending_balance = balance - principal_paid`
  5. Check termination: if `ending_balance == 0`, record milestone and finalize early.
* Baseline Comparison:
  When `monthly_prepayment > 0`, runs a twin simulation with `monthly_prepayment = 0` to compute `interest_savings` and `months_saved`.

### 3.5 Antigravity Agent Tool (`heloc/tools/trajectory_tool.py`)

Provides the callable tool entrypoint:
`calculate_heloc_trajectory(...)` returning:
```json
{
  "summary": {
    "initial_principal": 50000.0,
    "total_interest_paid": 42180.50,
    "payment_shock_amount": 285.40,
    "payment_shock_pct": 112.5,
    "interest_savings_vs_baseline": 14200.0,
    "months_saved_vs_baseline": 48
  },
  "annual_milestones": [...],
  "csv_path": "path/to/exported_heloc_schedule.csv"
}
```

### 3.6 Command Line Interface (`heloc/cli/main.py`)

Provides commands:
`python -m heloc --balance 50000 --limit 100000 --prime 6.5 --margin 2.0 --intro-apr 0.99 --intro-months 12 --prepayment 300 --scenario rising --csv schedule.csv`
Output includes:
- Loan configuration banner
- Key milestones (intro expiration, payment shock)
- Summary table comparing base vs prepayment savings
- Annual trajectory schedule

---

## 4. Verification & Testing Strategy

1. **`test_formulas.py`**:
   - Verify DPR for 365 vs 360 days against manual calculations.
   - Verify ADB weighted average with intra-month transactions matching example from `Python HELOC APR Calculator.md` ($42,666.67 ADB and ~$254 finance charge).
   - Verify amortized installment formula against standard mortgage benchmark tables.
2. **`test_rates.py`**:
   - Verify teaser rate applies only during months 1 through `intro_duration`.
   - Verify Washington State 25% usury cap clamps interest when Prime spikes to extreme levels.
   - Verify contractual lifetime cap clamps interest.
3. **`test_simulator.py`**:
   - Verify interest-only payments throughout draw period.
   - Verify payment shock calculation at month 121.
   - Verify dynamic re-amortization when Prime rate steps up during repayment.
   - Verify loan payoff and exact balance reduction with prepayments.
4. **`test_tools.py`**:
   - Test JSON output schema and type stability of `calculate_heloc_trajectory`.
   - Test CSV export generation.

---

## 5. Scope Boundaries (YAGNI)

- **Excluded from v1**: Full GUI desktop application (CLI and tabular console output provide sufficient visualization).
- **Excluded from v1**: Stochastic Monte Carlo rate distribution engines (deterministic scenario presets satisfy forecasting needs).
