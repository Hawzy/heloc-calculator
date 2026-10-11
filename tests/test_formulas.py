"""Unit tests for core financial formulas (DPR, ADB, amortization)."""

import pytest

from heloc.core.formulas import (
    amortized_monthly_installment,
    average_daily_balance,
    daily_periodic_rate,
    monthly_finance_charge,
)
from heloc.core.models import YearBasis


def test_daily_periodic_rate():
    """Verify daily periodic rate calculation for 365 and 360 day bases."""
    # 7.25% APR on 365 vs 360 day basis
    dpr_365 = daily_periodic_rate(7.25, YearBasis.DAYS_365)
    dpr_360 = daily_periodic_rate(7.25, YearBasis.DAYS_360)
    assert round(dpr_365, 8) == 0.00019863
    assert round(dpr_360, 8) == 0.00020139


def test_daily_periodic_rate_default_basis():
    """Verify daily periodic rate defaults to 365 days and accepts int."""
    dpr_default = daily_periodic_rate(7.25)
    dpr_365 = daily_periodic_rate(7.25, YearBasis.DAYS_365)
    dpr_int = daily_periodic_rate(7.25, 365)
    assert dpr_default == dpr_365 == dpr_int


def test_average_daily_balance_blueprint():
    """Verify ADB and monthly finance charge against the blueprint specification."""
    # Example from Python HELOC APR Calculator.md:
    # 10 days at 40,000; 10 days at 45,000; 10 days at 43,000 in a 30-day cycle
    balances = [40000.0] * 10 + [45000.0] * 10 + [43000.0] * 10
    adb = average_daily_balance(balances)
    assert round(adb, 2) == 42666.67

    # Finance charge at 7.25% APR over 30 days
    dpr = daily_periodic_rate(7.25, YearBasis.DAYS_365)
    charge = monthly_finance_charge(adb, dpr, days_in_cycle=30)
    assert round(charge, 0) == 254.0


def test_average_daily_balance_empty():
    """Verify ADB returns 0.0 for empty balance list."""
    assert average_daily_balance([]) == 0.0


def test_monthly_finance_charge_default_days():
    """Verify monthly finance charge uses default 30.4167 days in cycle."""
    dpr = daily_periodic_rate(7.25, YearBasis.DAYS_365)
    charge_default = monthly_finance_charge(10000.0, dpr)
    charge_explicit = monthly_finance_charge(10000.0, dpr, days_in_cycle=30.4167)
    assert charge_default == charge_explicit


def test_amortized_monthly_installment():
    """Verify standard amortization installment calculation."""
    # $50,000 loan at 7.25% APR over 240 months
    # Formula: M = 50000 * (r * (1 + r)^240) / ((1 + r)^240 - 1)
    # where r = 0.0725 / 12 -> payment = 395.18799... -> 395.19
    payment = amortized_monthly_installment(50000.0, 7.25, 240)
    assert round(payment, 2) == 395.19


def test_amortized_monthly_installment_zero_rate():
    """Verify amortization with 0% interest rate produces equal principal installments."""
    payment = amortized_monthly_installment(12000.0, 0.0, 12)
    assert payment == 1000.0


def test_amortized_monthly_installment_edge_cases():
    """Verify edge cases: zero/negative principal or months return 0.0 payment."""
    assert amortized_monthly_installment(0.0, 5.0, 12) == 0.0
    assert amortized_monthly_installment(-100.0, 5.0, 12) == 0.0
    assert amortized_monthly_installment(1000.0, 5.0, 0) == 0.0
    assert amortized_monthly_installment(1000.0, 5.0, -5) == 0.0
