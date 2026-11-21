"""Tests for HELOC v2 features: draw modes, staged events, fees, CLTV, goal solver, and HELoan comparison."""

import pytest
from pydantic import ValidationError

from heloc.core.analytics import (
    compare_fixed_home_equity_loan,
    estimate_borrowing_power,
    solve_monthly_prepayment,
)
from heloc.core.models import CashFlowEvent, DrawPaymentMode, HelocConfig, RateScenarioType
from heloc.core.rates import generate_prime_rates
from heloc.core.simulator import simulate_heloc
from heloc.tools.trajectory_tool import calculate_heloc_trajectory


def test_draw_payment_pct_of_balance_reduces_principal_during_draw():
    cfg = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        draw_period_months=60,
        repayment_period_months=120,
        draw_payment_mode=DrawPaymentMode.PCT_OF_BALANCE,
        draw_min_payment_pct=1.5,
        draw_min_payment_floor=100.0,
    )
    summary, records, df = simulate_heloc(cfg, [6.0] * 180)
    assert set(df.columns) == {
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
    assert records[0].required_payment == 750.0
    assert records[0].principal_paid > 0.0
    assert records[0].ending_balance < 50000.0
    for r in records:
        assert round(r.interest_paid + r.principal_paid, 2) == r.total_payment
        assert round(r.required_payment + r.prepayment, 2) == r.total_payment
    assert summary.total_principal_paid == 50000.0


def test_draw_payment_fixed_floor_applies_floor_and_pays_early():
    cfg = HelocConfig(
        initial_principal=25000.0,
        credit_limit=50000.0,
        margin=2.0,
        draw_period_months=60,
        repayment_period_months=120,
        draw_payment_mode=DrawPaymentMode.FIXED_FLOOR,
        draw_min_payment_floor=500.0,
    )
    summary, records, _ = simulate_heloc(cfg, [6.0] * 180)
    assert records[0].required_payment == 500.0
    assert records[59].ending_balance < 1000.0
    assert summary.first_repayment_payment < 10.0
    assert summary.payment_shock_amount == 0.0

    cfg_fast = cfg.model_copy(update={"draw_min_payment_floor": 700.0})
    fast_summary, fast_records, _ = simulate_heloc(cfg_fast, [6.0] * 180)
    assert fast_summary.actual_months_to_payoff < 60
    assert fast_records[-1].ending_balance == 0.0


def test_cash_flow_events_validation_and_reopen_after_zero():
    with pytest.raises(ValidationError):
        HelocConfig(
            initial_principal=20000.0,
            credit_limit=50000.0,
            draw_period_months=12,
            repayment_period_months=12,
            cash_flow_events=[CashFlowEvent(month=15, amount=5000.0, event_type="draw")],
        )

    cfg = HelocConfig(
        initial_principal=10000.0,
        credit_limit=25000.0,
        draw_period_months=24,
        repayment_period_months=24,
        monthly_prepayment=2500.0,
        cash_flow_events=[
            CashFlowEvent(month=10, amount=30000.0, event_type="draw", label="Oversized Draw"),
        ],
    )
    summary, records, _ = simulate_heloc(cfg, [7.0] * 48)
    # Initial $10k paid off in month 4 -> months 5..9 wait at $0 -> month 10 clips $30k draw to $25k limit
    assert records[4].starting_balance == 0.0
    assert records[4].total_payment == 0.0
    assert records[9].starting_balance == 25000.0
    assert summary.total_additional_draws == 25000.0
    assert summary.peak_balance == 25000.0
    assert summary.total_principal_paid == 35000.0


def test_lump_sum_baseline_savings_and_milestones():
    result = calculate_heloc_trajectory(
        initial_principal=30000.0,
        credit_limit=100000.0,
        margin=2.0,
        prime_rate=6.5,
        rate_scenario="rising",
        annual_rate_step=0.5,
        draw_period_years=5,
        repayment_period_years=10,
        monthly_prepayment=200.0,
        cash_flow_events=[
            {"month": 14, "amount": 15000.0, "event_type": "draw", "label": "Kitchen Reno"},
            {"month": 24, "amount": 8000.0, "event_type": "lump_sum", "label": "Annual Bonus"},
        ],
    )
    summary = result["summary"]
    assert summary["total_additional_draws"] == 15000.0
    assert summary["total_lump_sum_payments"] == 8000.0
    assert summary["total_principal_paid"] == 45000.0
    assert summary["interest_savings_vs_baseline"] > 0.0
    assert summary["months_saved_vs_baseline"] > 0

    events = [m["event"] for m in result["milestones"]]
    assert "Scheduled Draw" in events
    assert "One-Time Lump Sum" in events
    assert [m["month"] for m in result["milestones"]] == sorted(m["month"] for m in result["milestones"])


def test_fee_ledger_and_early_closure_threshold():
    base_cfg = HelocConfig(
        initial_principal=40000.0,
        credit_limit=80000.0,
        draw_period_months=60,
        repayment_period_months=120,
        monthly_prepayment=1500.0,
    )
    fee_cfg = base_cfg.model_copy(
        update={
            "closing_costs": 650.0,
            "annual_fee": 75.0,
            "early_closure_fee": 500.0,
            "early_closure_months": 36,
        }
    )
    prime = [7.0] * 180
    base_sum, _, _ = simulate_heloc(base_cfg, prime)
    fee_sum, _, _ = simulate_heloc(fee_cfg, prime)

    # Fees must never alter APR / principal / interest
    assert fee_sum.total_interest_paid == base_sum.total_interest_paid
    assert fee_sum.actual_months_to_payoff == base_sum.actual_months_to_payoff
    assert fee_sum.actual_months_to_payoff <= 36
    assert fee_sum.early_closure_fee_triggered is True
    assert fee_sum.total_fees == round(650.0 + 75.0 * 3 + 500.0, 2)
    assert fee_sum.total_cost_with_fees == round(fee_sum.total_payments + fee_sum.total_fees, 2)

    no_penalty_cfg = fee_cfg.model_copy(update={"early_closure_months": 12})
    np_sum, _, _ = simulate_heloc(no_penalty_cfg, prime)
    assert np_sum.early_closure_fee_triggered is False
    assert np_sum.total_fees == round(650.0 + 75.0 * 3, 2)


def test_estimate_borrowing_power_analytics():
    res = estimate_borrowing_power(600000.0, 350000.0, 80.0, planned_credit_limit=100000.0, planned_initial_draw=50000.0)
    assert res["current_equity"] == 250000.0
    assert res["max_heloc_limit"] == 130000.0
    assert res["projected_cltv_pct"] == 75.0
    assert res["drawn_cltv_pct"] == 66.67
    assert res["exceeds_max_cltv"] is False

    over = estimate_borrowing_power(600000.0, 350000.0, 85.0, planned_credit_limit=200000.0)
    assert over["max_heloc_limit"] == 160000.0
    assert over["exceeds_max_cltv"] is True


def test_solve_monthly_prepayment_target_and_impossible_case():
    cfg = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        intro_apr=0.99,
        intro_duration_months=12,
        draw_period_months=120,
        repayment_period_months=240,
    )
    prime = generate_prime_rates(360, RateScenarioType.RISING, base_prime=6.0, annual_step=0.5)
    solved = solve_monthly_prepayment(cfg, 60, prime)
    assert solved["achievable"] is True
    assert solved["actual_months_to_payoff"] <= 60
    assert solved["required_monthly_prepayment"] > 0

    zero_shock = solve_monthly_prepayment(cfg, 120, prime)
    assert zero_shock["achievable"] is True
    assert zero_shock["payment_shock_amount"] == 0.0

    draw_late = HelocConfig(
        initial_principal=20000.0,
        credit_limit=100000.0,
        draw_period_months=60,
        repayment_period_months=120,
        cash_flow_events=[CashFlowEvent(month=24, amount=5000.0, event_type="draw")],
    )
    blocked = solve_monthly_prepayment(draw_late, 12)
    assert blocked["achievable"] is False
    assert blocked["required_monthly_prepayment"] is None


def test_compare_fixed_home_equity_loan():
    cfg = HelocConfig(initial_principal=50000.0, credit_limit=100000.0, monthly_prepayment=300.0)
    summary, _, _ = simulate_heloc(cfg)
    comp = compare_fixed_home_equity_loan(50000.0, 7.5, 180, summary, fixed_closing_costs=500.0)
    assert comp["monthly_payment"] == 463.51
    assert comp["total_principal_paid"] == 50000.0
    assert comp["fixed_closing_costs"] == 500.0
    assert comp["total_cost_with_fees"] == round(comp["total_payments"] + 500.0, 2)
    assert comp["payment_shock_avoided"] == summary.payment_shock_amount

    zero_apr = compare_fixed_home_equity_loan(24000.0, 0.0, 24, summary)
    assert zero_apr["monthly_payment"] == 1000.0
    assert zero_apr["total_interest_paid"] == 0.0
