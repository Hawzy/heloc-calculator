"""Borrowing power, payoff goal solver, and fixed-rate HELoan comparison analytics."""

from __future__ import annotations

import math
from typing import Any

from heloc.core.formulas import amortized_monthly_installment
from heloc.core.models import HelocConfig, RateScenarioType, TrajectorySummary
from heloc.core.rates import generate_prime_rates
from heloc.core.simulator import _run_single_trajectory, simulate_heloc


def estimate_borrowing_power(
    home_value: float,
    first_mortgage_balance: float,
    max_cltv_pct: float = 80.0,
    planned_credit_limit: float | None = None,
    planned_initial_draw: float = 0.0,
) -> dict[str, Any]:
    """Estimate maximum HELOC line capacity and Combined Loan-to-Value (CLTV) metrics."""
    if home_value <= 0:
        raise ValueError("home_value must be greater than 0")
    if first_mortgage_balance < 0:
        raise ValueError("first_mortgage_balance must be 0 or higher")
    if max_cltv_pct <= 0 or max_cltv_pct > 100:
        raise ValueError("max_cltv_pct must be between 0 (exclusive) and 100")

    current_equity = round(max(0.0, home_value - first_mortgage_balance), 2)
    current_ltv_pct = round((first_mortgage_balance / home_value) * 100.0, 2)
    max_total_debt = round(home_value * (max_cltv_pct / 100.0), 2)
    max_heloc_limit = round(max(0.0, max_total_debt - first_mortgage_balance), 2)

    effective_limit = max_heloc_limit if planned_credit_limit is None else max(0.0, planned_credit_limit)
    projected_cltv_pct = round(((first_mortgage_balance + effective_limit) / home_value) * 100.0, 2)
    drawn_cltv_pct = round(
        ((first_mortgage_balance + max(0.0, planned_initial_draw)) / home_value) * 100.0, 2
    )
    exceeds_max_cltv = projected_cltv_pct > (max_cltv_pct + 1e-6)

    return {
        "home_value": round(home_value, 2),
        "first_mortgage_balance": round(first_mortgage_balance, 2),
        "max_cltv_pct": round(max_cltv_pct, 2),
        "current_equity": current_equity,
        "current_ltv_pct": current_ltv_pct,
        "max_total_debt": max_total_debt,
        "max_heloc_limit": max_heloc_limit,
        "projected_cltv_pct": projected_cltv_pct,
        "drawn_cltv_pct": drawn_cltv_pct,
        "exceeds_max_cltv": exceeds_max_cltv,
    }


def _resolve_prime_schedule(config: HelocConfig, prime_schedule: list[float] | None) -> list[float]:
    total_months = config.draw_period_months + config.repayment_period_months
    if prime_schedule is None:
        return generate_prime_rates(total_months, RateScenarioType.FLAT, base_prime=8.5)
    if len(prime_schedule) < total_months:
        return generate_prime_rates(
            total_months, RateScenarioType.CUSTOM, base_prime=8.5, custom_rates=prime_schedule
        )
    return list(prime_schedule[:total_months])


def solve_monthly_prepayment(
    config: HelocConfig,
    target_months: int,
    prime_schedule: list[float] | None = None,
) -> dict[str, Any]:
    """Solve for the minimum fixed monthly prepayment ($) needed to pay off by `target_months`."""
    total_months = config.draw_period_months + config.repayment_period_months
    if target_months < 1 or target_months > total_months:
        raise ValueError(f"target_months must be between 1 and {total_months}")

    resolved_prime = _resolve_prime_schedule(config, prime_schedule)
    draw_events = [ev for ev in config.cash_flow_events if ev.event_type == "draw"]
    last_draw_event_month = max((ev.month for ev in draw_events), default=0)

    if last_draw_event_month > target_months:
        return {
            "achievable": False,
            "already_met": False,
            "target_months": target_months,
            "required_monthly_prepayment": None,
            "actual_months_to_payoff": None,
            "total_interest_paid": None,
            "payment_shock_amount": None,
            "reason": (
                f"Scheduled draw in Month {last_draw_event_month} occurs after "
                f"target Month {target_months}."
            ),
        }

    cfg_zero = config.model_copy(update={"monthly_prepayment": 0.0})
    sum_zero, _, _ = simulate_heloc(cfg_zero, resolved_prime)
    if sum_zero.actual_months_to_payoff <= target_months:
        return {
            "achievable": True,
            "already_met": True,
            "target_months": target_months,
            "required_monthly_prepayment": 0.0,
            "actual_months_to_payoff": sum_zero.actual_months_to_payoff,
            "total_interest_paid": sum_zero.total_interest_paid,
            "payment_shock_amount": sum_zero.payment_shock_amount,
        }

    sum_draws = sum(ev.amount for ev in draw_events)
    hi = max((config.initial_principal + sum_draws) * 1.25, 100.0)
    while hi <= 1e9:
        cfg_hi = config.model_copy(update={"monthly_prepayment": hi})
        _, m_hi, _, _ = _run_single_trajectory(cfg_hi, resolved_prime)
        if m_hi <= target_months:
            break
        hi *= 2.0
    else:
        return {
            "achievable": False,
            "already_met": False,
            "target_months": target_months,
            "required_monthly_prepayment": None,
            "actual_months_to_payoff": None,
            "total_interest_paid": None,
            "payment_shock_amount": None,
            "reason": f"Could not reach payoff by Month {target_months} within search ceiling.",
        }

    lo_cents = 1
    hi_cents = math.ceil(hi * 100.0)
    while lo_cents < hi_cents:
        mid_cents = (lo_cents + hi_cents) // 2
        cfg_mid = config.model_copy(update={"monthly_prepayment": mid_cents / 100.0})
        _, m_mid, _, _ = _run_single_trajectory(cfg_mid, resolved_prime)
        if m_mid <= target_months:
            hi_cents = mid_cents
        else:
            lo_cents = mid_cents + 1

    best_prepay = round(lo_cents / 100.0, 2)
    cfg_best = config.model_copy(update={"monthly_prepayment": best_prepay})
    sum_best, _, _ = simulate_heloc(cfg_best, resolved_prime)

    return {
        "achievable": True,
        "already_met": False,
        "target_months": target_months,
        "required_monthly_prepayment": best_prepay,
        "actual_months_to_payoff": sum_best.actual_months_to_payoff,
        "total_interest_paid": sum_best.total_interest_paid,
        "payment_shock_amount": sum_best.payment_shock_amount,
    }


def compare_fixed_home_equity_loan(
    principal: float,
    fixed_apr: float,
    term_months: int,
    heloc_summary: TrajectorySummary | dict[str, Any],
    fixed_closing_costs: float = 0.0,
) -> dict[str, Any]:
    """Compare the simulated HELOC trajectory against a fixed-rate Home Equity Loan."""
    if principal <= 0:
        raise ValueError("principal must be greater than 0")
    if fixed_apr < 0:
        raise ValueError("fixed_apr must be 0 or higher")
    if term_months < 1:
        raise ValueError("term_months must be at least 1")
    if fixed_closing_costs < 0:
        raise ValueError("fixed_closing_costs must be 0 or higher")

    monthly_payment = amortized_monthly_installment(principal, fixed_apr, term_months)
    r_monthly = (fixed_apr / 100.0) / 12.0

    balance = principal
    total_interest = 0.0
    total_principal_paid = 0.0

    for m in range(1, term_months + 1):
        interest_due = balance * r_monthly
        if m == term_months:
            principal_paid = balance
        else:
            principal_paid = min(max(0.0, monthly_payment - interest_due), balance)
        total_interest += interest_due
        total_principal_paid += principal_paid
        balance = max(0.0, balance - principal_paid)

    fixed_interest = round(total_interest, 2)
    fixed_principal = round(total_principal_paid, 2)
    fixed_payments = round(total_interest + total_principal_paid, 2)
    fixed_fees = round(fixed_closing_costs, 2)
    fixed_total_cost = round(total_interest + total_principal_paid + fixed_closing_costs, 2)

    if isinstance(heloc_summary, TrajectorySummary):
        heloc_interest = heloc_summary.total_interest_paid
        heloc_total_cost = heloc_summary.total_cost_with_fees
        heloc_shock = heloc_summary.payment_shock_amount
    else:
        heloc_interest = float(heloc_summary["total_interest_paid"])
        heloc_total_cost = float(
            heloc_summary.get("total_cost_with_fees", heloc_summary["total_payments"])
        )
        heloc_shock = float(heloc_summary["payment_shock_amount"])

    return {
        "principal": round(principal, 2),
        "fixed_apr": round(fixed_apr, 4),
        "term_months": term_months,
        "monthly_payment": round(monthly_payment, 2),
        "total_interest_paid": fixed_interest,
        "total_principal_paid": fixed_principal,
        "total_payments": fixed_payments,
        "fixed_closing_costs": fixed_fees,
        "total_cost_with_fees": fixed_total_cost,
        "interest_delta_vs_heloc": round(heloc_interest - fixed_interest, 2),
        "total_cost_delta_vs_heloc": round(heloc_total_cost - fixed_total_cost, 2),
        "payment_shock_avoided": round(heloc_shock, 2),
    }
