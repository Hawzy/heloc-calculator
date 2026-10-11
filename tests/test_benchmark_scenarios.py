"""Benchmark scenario validation tests.

Validates the complete HELOC trajectory calculation engine against regulatory
and economic scenarios outlined in the mathematical blueprint and statutes.
"""

from heloc.core.models import HelocConfig
from heloc.core.simulator import simulate_heloc
from heloc.tools.trajectory_tool import calculate_heloc_trajectory


def test_full_document_blueprint_scenario():
    """Scenario from Python HELOC APR Calculator.md Section 5:

    $50,000 balance with 0.99% intro rate for 12 months.
    Prime plus 2% margin.
    Prime steadily climbs (+0.5% / yr).
    Extra $300 a month prepayment during draw period.
    """
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
    summary = result["summary"]
    assert summary["actual_months_to_payoff"] < summary["total_months_scheduled"]
    assert summary["interest_savings_vs_baseline"] > 5000.0
    assert summary["months_saved_vs_baseline"] > 24
    assert result["milestones"][0]["event"] == "Loan Origination"
    assert {
        "Loan Origination",
        "Introductory Rate Expiration",
        "Phase Shift: Repayment Period Begins",
        "Loan Payoff",
    }.issubset({m["event"] for m in result["milestones"]})


def test_washington_statutory_usury_cap_benchmark():
    """WAC 208-620-235: 25.0% simple interest ceiling.

    Prime 25.0% + Margin 3.0% = 28.0% nominal rate, capped at 25.0%.
    """
    config = HelocConfig(
        initial_principal=20000.0,
        credit_limit=50000.0,
        margin=3.0,
        lifetime_rate_cap=30.0,
        regulatory_ceiling=25.0,
        draw_period_months=12,
        repayment_period_months=12,
    )
    prime = [25.0] * 24
    summary, records, df = simulate_heloc(config, prime_schedule=prime)
    assert len(records) == 24
    for r in records:
        assert r.effective_apr == 25.0


def test_zero_prepayment_baseline_identity():
    """Validates baseline identity: with $0 prepayment, savings and months saved are exactly 0."""
    result = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        prime_rate=7.0,
        rate_scenario="flat",
        monthly_prepayment=0.0,
    )
    summary = result["summary"]
    assert summary["interest_savings_vs_baseline"] == 0.0
    assert summary["months_saved_vs_baseline"] == 0
    assert summary["actual_months_to_payoff"] == summary["total_months_scheduled"]


def test_year_basis_benchmark_impact():
    """360-day commercial basis yields higher daily rate than 365-day basis."""
    res_365 = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        year_basis=365,
    )
    res_360 = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        year_basis=360,
    )
    assert res_360["summary"]["total_interest_paid"] > res_365["summary"]["total_interest_paid"]


def test_stress_test_scenario_benchmark():
    """Validates that stress test scenario trajectory calculates correctly with volatility."""
    result = calculate_heloc_trajectory(
        initial_principal=60000.0,
        credit_limit=120000.0,
        margin=2.5,
        prime_rate=6.5,
        rate_scenario="stress_test",
        lifetime_rate_cap=18.0,
        draw_period_years=5,
        repayment_period_years=10,
    )
    summary = result["summary"]
    assert summary["total_interest_paid"] > 0
    assert summary["actual_months_to_payoff"] == 180
    assert len(result["annual_trajectory"]) == 15
