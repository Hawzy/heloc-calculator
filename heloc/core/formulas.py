"""Core financial formulas for HELOC interest accrual and amortization.

Implements calculations for:
- Daily Periodic Rate (DPR) conversion based on 365 or 360 day basis
- Average Daily Balance (ADB) across billing cycle days
- Monthly finance charge from periodic rate and cycle length
- Standard fixed-rate amortized monthly installment
"""

from heloc.core.models import YearBasis


def daily_periodic_rate(
    annual_rate_pct: float,
    year_basis: YearBasis | int = YearBasis.DAYS_365,
) -> float:
    """Calculate the Daily Periodic Rate (DPR) from an annual percentage rate.

    Args:
        annual_rate_pct: Annual Percentage Rate as a percentage (e.g., 7.25 for 7.25%).
        year_basis: Year basis convention (DAYS_365 or DAYS_360).

    Returns:
        The daily interest rate as a decimal (e.g., 0.00019863...).

    Raises:
        ValueError: If year_basis is less than or equal to 0.
    """
    if int(year_basis) <= 0:
        raise ValueError("year_basis must be greater than 0")
    return (annual_rate_pct / 100.0) / int(year_basis)


def average_daily_balance(daily_balances: list[float]) -> float:
    """Calculate the Average Daily Balance (ADB) over a billing cycle.

    Args:
        daily_balances: Sequence of end-of-day balances for each day in the cycle.

    Returns:
        The arithmetic mean of daily balances, or 0.0 if the sequence is empty.
    """
    if not daily_balances:
        return 0.0
    return sum(daily_balances) / len(daily_balances)


def monthly_finance_charge(
    balance: float,
    dpr: float,
    days_in_cycle: float = 30.4167,
) -> float:
    """Calculate the monthly finance charge for a billing period.

    Args:
        balance: Relevant balance for the billing cycle (typically ADB).
        dpr: Daily Periodic Rate as a decimal.
        days_in_cycle: Number of days in the billing cycle (default: 365 / 12 = 30.4167).

    Returns:
        Finance charge (interest amount) for the period.
    """
    return balance * dpr * days_in_cycle


def amortized_monthly_installment(
    principal: float,
    annual_rate_pct: float,
    remaining_months: int,
) -> float:
    """Calculate the fully amortizing fixed monthly payment installment.

    Uses the standard amortization formula:
        M = P * [r(1 + r)^n] / [(1 + r)^n - 1]
    where P is principal, r is the monthly interest rate, and n is remaining months.

    Args:
        principal: Outstanding loan balance to amortize.
        annual_rate_pct: Annual interest rate as a percentage (e.g., 7.25 for 7.25%).
        remaining_months: Total remaining amortization periods in months.

    Returns:
        Monthly installment amount. Returns 0.0 if principal <= 0 or remaining_months <= 0.
        Returns principal / remaining_months if interest rate is 0%.
    """
    if principal <= 0.0 or remaining_months <= 0:
        return 0.0

    if annual_rate_pct <= 0.0:
        return principal / remaining_months

    monthly_rate = (annual_rate_pct / 100.0) / 12.0
    factor = (1.0 + monthly_rate) ** remaining_months
    return principal * (monthly_rate * factor) / (factor - 1.0)
