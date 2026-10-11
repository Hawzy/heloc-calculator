"""Data contracts, enums, and configuration schemas for HELOC simulations."""

from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator


class BalanceMethod(str, Enum):
    """Method used for interest accrual calculation during billing cycles."""

    AVERAGE_DAILY_BALANCE = "average_daily_balance"
    ADJUSTED_BALANCE = "adjusted_balance"
    PREVIOUS_BALANCE = "previous_balance"


class YearBasis(int, Enum):
    """Year basis convention for Daily Periodic Rate conversion."""

    DAYS_365 = 365
    DAYS_360 = 360


class RateScenarioType(str, Enum):
    """Macroeconomic Prime rate scenario trajectories."""

    FLAT = "flat"
    RISING = "rising"
    STRESS_TEST = "stress_test"
    CUSTOM = "custom"


class HelocConfig(BaseModel):
    """Configuration parameters for a Home Equity Line of Credit loan."""

    initial_principal: float = Field(..., gt=0, description="Initial drawn loan balance")
    credit_limit: float = Field(..., gt=0, description="Total revolving line limit")
    margin: float = Field(default=2.0, ge=0, description="Fixed margin added to Prime rate (%)")
    intro_apr: Optional[float] = Field(default=None, ge=0, description="Introductory teaser APR (%)")
    intro_duration_months: int = Field(default=12, ge=0, description="Duration of intro rate in months")
    draw_period_months: int = Field(default=120, ge=1, description="Draw period in months (default: 120 = 10 years)")
    repayment_period_months: int = Field(default=240, ge=1, description="Repayment period in months (default: 240 = 20 years)")
    lifetime_rate_cap: float = Field(default=18.0, gt=0, description="Contractual lifetime maximum interest ceiling (%)")
    regulatory_ceiling: float = Field(default=25.0, gt=0, description="Washington CLA simple interest usury limit (%) under WAC 208-620-235")
    monthly_prepayment: float = Field(default=0.0, ge=0, description="Optional extra monthly principal prepayment")
    balance_method: BalanceMethod = Field(default=BalanceMethod.AVERAGE_DAILY_BALANCE)
    year_basis: YearBasis = Field(default=YearBasis.DAYS_365)

    @model_validator(mode="after")
    def validate_principal_vs_limit(self) -> "HelocConfig":
        if self.initial_principal > self.credit_limit:
            raise ValueError("initial_principal cannot exceed credit_limit")
        return self


class MonthlyRecord(BaseModel):
    """Individual monthly amortization line item."""

    month: int
    year: int
    phase: Literal["draw", "repayment"]
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
    """Aggregated financial results and comparative metrics for a loan trajectory."""

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
