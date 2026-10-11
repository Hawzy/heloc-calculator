import pytest
import pandas as pd
from heloc.core.models import BalanceMethod, HelocConfig, RateScenarioType
from heloc.core.rates import generate_prime_rates
from heloc.core.simulator import simulate_heloc


def test_draw_period_interest_only():
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        intro_apr=1.0,
        intro_duration_months=12,
        draw_period_months=120,
        repayment_period_months=240,
        monthly_prepayment=0.0,
    )
    summary, records, df = simulate_heloc(config, prime_schedule=[7.0] * 360)

    # Months 1-120 must be draw period
    draw_records = [r for r in records if r.phase == "draw"]
    assert len(draw_records) == 120
    # With 0 prepayment, ending balance during draw period stays at $50,000
    for r in draw_records:
        assert r.ending_balance == 50000.0
        assert r.principal_paid == 0.0


def test_payment_shock_at_month_121():
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        draw_period_months=120,
        repayment_period_months=240,
        monthly_prepayment=0.0,
    )
    summary, records, df = simulate_heloc(config, prime_schedule=[7.0] * 360)
    month_120 = records[119]
    month_121 = records[120]

    assert month_120.phase == "draw"
    assert month_121.phase == "repayment"
    assert month_121.required_payment > month_120.required_payment
    assert summary.payment_shock_pct > 0.0
    assert summary.payment_shock_amount == round(month_121.required_payment - month_120.required_payment, 2)


def test_prepayment_accelerated_payoff_and_savings():
    base_config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        monthly_prepayment=0.0,
    )
    prep_config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        monthly_prepayment=300.0,
    )
    prime = [7.0] * 360
    base_summary, _, _ = simulate_heloc(base_config, prime)
    prep_summary, _, _ = simulate_heloc(prep_config, prime)

    assert prep_summary.actual_months_to_payoff < base_summary.actual_months_to_payoff
    assert prep_summary.total_interest_paid < base_summary.total_interest_paid
    assert prep_summary.interest_savings_vs_baseline > 0.0
    assert prep_summary.months_saved_vs_baseline > 0


def test_simulate_heloc_default_prime_schedule():
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
    )
    summary, records, df = simulate_heloc(config, prime_schedule=None)
    assert len(records) == 360
    assert isinstance(df, pd.DataFrame)
    assert not df.empty
    assert summary.actual_months_to_payoff == 360
    assert summary.total_principal_paid == 50000.0


def test_simulate_heloc_dataframe_contract():
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
    )
    summary, records, df = simulate_heloc(config)
    expected_columns = {
        "month",
        "year",
        "phase",
        "starting_balance",
        "effective_apr",
        "prime_rate",
        "required_payment",
        "prepayment",
        "total_payment",
        "interest_paid",
        "principal_paid",
        "ending_balance",
    }
    assert set(df.columns) == expected_columns
    assert len(df) == len(records)


def test_dynamic_reamortization_under_rising_rates():
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        draw_period_months=12,
        repayment_period_months=24,
    )
    rising_schedule = generate_prime_rates(
        total_months=36,
        scenario=RateScenarioType.RISING,
        base_prime=5.0,
        annual_step=1.0,
    )
    summary, records, df = simulate_heloc(config, rising_schedule)
    repay_records = [r for r in records if r.phase == "repayment"]
    assert len(repay_records) == 24
    # Rate changes from year 2 to year 3 (month 24 to month 25)
    month_24 = records[23]
    month_25 = records[24]
    assert month_25.effective_apr > month_24.effective_apr
    # Final month ending balance must reach zero
    assert records[-1].ending_balance == 0.0
    assert summary.actual_months_to_payoff == 36


def test_early_payoff_during_draw_period():
    config = HelocConfig(
        initial_principal=10000.0,
        credit_limit=50000.0,
        draw_period_months=120,
        repayment_period_months=240,
        monthly_prepayment=2000.0,
    )
    summary, records, df = simulate_heloc(config, prime_schedule=[7.0] * 360)
    # At $2000/mo prepayment, $10,000 is paid off in 5 months
    assert summary.actual_months_to_payoff == 5
    assert len(records) == 5
    assert records[-1].ending_balance == 0.0
    assert summary.first_repayment_payment == 0.0
    assert summary.payment_shock_amount == 0.0


def test_adjusted_balance_method():
    base_config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        monthly_prepayment=1000.0,
        balance_method=BalanceMethod.AVERAGE_DAILY_BALANCE,
    )
    adj_config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        monthly_prepayment=1000.0,
        balance_method=BalanceMethod.ADJUSTED_BALANCE,
    )
    prime = [7.0] * 360
    base_summary, base_records, _ = simulate_heloc(base_config, prime)
    adj_summary, adj_records, _ = simulate_heloc(adj_config, prime)

    # In month 1 of draw, adjusted balance subtracts prepayment before interest calculation
    assert adj_records[0].interest_paid < base_records[0].interest_paid
    assert adj_summary.total_interest_paid < base_summary.total_interest_paid
