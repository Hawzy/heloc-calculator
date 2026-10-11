import pytest
from pydantic import ValidationError
from heloc.core.models import (
    BalanceMethod,
    YearBasis,
    RateScenarioType,
    HelocConfig,
    MonthlyRecord,
    TrajectorySummary,
)


def test_heloc_config_defaults():
    config = HelocConfig(initial_principal=50000.0, credit_limit=100000.0)
    assert config.margin == 2.0
    assert config.intro_apr is None
    assert config.intro_duration_months == 12
    assert config.draw_period_months == 120
    assert config.repayment_period_months == 240
    assert config.lifetime_rate_cap == 18.0
    assert config.regulatory_ceiling == 25.0
    assert config.balance_method == BalanceMethod.AVERAGE_DAILY_BALANCE
    assert config.year_basis == YearBasis.DAYS_365


def test_heloc_config_validation():
    with pytest.raises(ValidationError):
        # Principal cannot be zero or negative
        HelocConfig(initial_principal=-100.0, credit_limit=100000.0)

    with pytest.raises(ValidationError):
        # Credit limit cannot be zero or negative
        HelocConfig(initial_principal=50000.0, credit_limit=0.0)


def test_monthly_record_instantiation():
    record = MonthlyRecord(
        month=1,
        year=1,
        phase="draw",
        starting_balance=50000.0,
        effective_apr=0.99,
        prime_rate=8.5,
        required_payment=41.25,
        prepayment=300.0,
        total_payment=341.25,
        interest_paid=41.25,
        principal_paid=300.0,
        ending_balance=49700.0,
    )
    assert record.ending_balance == 49700.0
    assert record.phase == "draw"


def test_trajectory_summary_instantiation():
    summary = TrajectorySummary(
        initial_principal=50000.0,
        credit_limit=100000.0,
        total_months_scheduled=360,
        actual_months_to_payoff=360,
        total_interest_paid=25000.0,
        total_principal_paid=50000.0,
        total_payments=75000.0,
        initial_draw_payment=354.17,
        first_repayment_payment=550.20,
        payment_shock_amount=196.03,
        payment_shock_pct=55.35,
    )
    assert summary.interest_savings_vs_baseline == 0.0
    assert summary.months_saved_vs_baseline == 0
    assert summary.payment_shock_amount == 196.03


def test_enum_values():
    assert BalanceMethod.AVERAGE_DAILY_BALANCE.value == "average_daily_balance"
    assert BalanceMethod.ADJUSTED_BALANCE.value == "adjusted_balance"
    assert BalanceMethod.PREVIOUS_BALANCE.value == "previous_balance"

    assert YearBasis.DAYS_365.value == 365
    assert YearBasis.DAYS_360.value == 360

    assert RateScenarioType.FLAT.value == "flat"
    assert RateScenarioType.RISING.value == "rising"
    assert RateScenarioType.STRESS_TEST.value == "stress_test"
    assert RateScenarioType.CUSTOM.value == "custom"
