"""Month-by-month trajectory simulation engine for HELOC amortization."""

import math
from typing import Any
import pandas as pd

from heloc.core.formulas import (
    amortized_monthly_installment,
    daily_periodic_rate,
    monthly_finance_charge,
)
from heloc.core.models import (
    BalanceMethod,
    DrawPaymentMode,
    HelocConfig,
    MonthlyRecord,
    RateScenarioType,
    TrajectorySummary,
)
from heloc.core.rates import generate_prime_rates, get_effective_rate


def _run_trajectory_with_stats(
    config: HelocConfig, prime_schedule: list[float]
) -> tuple[list[MonthlyRecord], int, float, float, dict[str, Any]]:
    """Simulates a single trajectory plus v2 draw/lump-sum/peak diagnostics."""
    total_months = config.draw_period_months + config.repayment_period_months
    records: list[MonthlyRecord] = []
    current_balance = config.initial_principal
    total_interest = 0.0
    total_principal_paid = 0.0
    actual_months = total_months

    draws_by_month: dict[int, float] = {}
    lumps_by_month: dict[int, float] = {}
    for ev in config.cash_flow_events:
        if ev.event_type == "draw":
            draws_by_month[ev.month] = draws_by_month.get(ev.month, 0.0) + ev.amount
        else:
            lumps_by_month[ev.month] = lumps_by_month.get(ev.month, 0.0) + ev.amount

    last_draw_event_month = max(draws_by_month.keys(), default=0)
    total_additional_draws = 0.0
    total_lump_sum_payments = 0.0
    peak_balance = config.initial_principal

    # Standard monthly day approximation: 365 / 12
    days_in_month = 365.0 / 12.0

    for m in range(1, total_months + 1):
        if current_balance <= 1e-4 and m > last_draw_event_month:
            actual_months = m - 1
            break

        year = ((m - 1) // 12) + 1
        is_draw = m <= config.draw_period_months
        phase = "draw" if is_draw else "repayment"
        prime_rate = prime_schedule[m - 1]
        effective_apr = get_effective_rate(m, config, prime_rate)

        if is_draw and m in draws_by_month:
            requested_draw = draws_by_month[m]
            available_credit = max(0.0, config.credit_limit - current_balance)
            actual_draw = min(requested_draw, available_credit)
            current_balance += actual_draw
            total_additional_draws += actual_draw

        starting_bal = current_balance
        peak_balance = max(peak_balance, starting_bal)

        if starting_bal <= 1e-4:
            records.append(
                MonthlyRecord(
                    month=m,
                    year=year,
                    phase=phase,
                    starting_balance=0.0,
                    effective_apr=round(effective_apr, 4),
                    prime_rate=round(prime_rate, 4),
                    required_payment=0.0,
                    prepayment=0.0,
                    total_payment=0.0,
                    interest_paid=0.0,
                    principal_paid=0.0,
                    ending_balance=0.0,
                )
            )
            continue

        lump_sum = lumps_by_month.get(m, 0.0)
        extra_available = config.monthly_prepayment + lump_sum

        if is_draw:
            dpr = daily_periodic_rate(effective_apr, config.year_basis)
            if config.balance_method == BalanceMethod.ADJUSTED_BALANCE:
                # In Adjusted Balance method, payments made during cycle reduce balance before finance charge
                prepay_est = min(extra_available, starting_bal)
                calc_bal = max(0.0, starting_bal - prepay_est)
                interest_due = monthly_finance_charge(calc_bal, dpr, days_in_month)
            else:
                interest_due = monthly_finance_charge(starting_bal, dpr, days_in_month)

            if config.draw_payment_mode == DrawPaymentMode.PCT_OF_BALANCE:
                min_req = max(
                    interest_due,
                    starting_bal * (config.draw_min_payment_pct / 100.0),
                    config.draw_min_payment_floor,
                )
            elif config.draw_payment_mode == DrawPaymentMode.FIXED_FLOOR:
                min_req = max(interest_due, config.draw_min_payment_floor)
            else:
                min_req = interest_due

            min_req = min(min_req, starting_bal + interest_due)
            scheduled_principal = min(max(0.0, min_req - interest_due), starting_bal)
            remaining_principal = max(0.0, starting_bal - scheduled_principal)
            prepayment = min(extra_available, remaining_principal)
            actual_lump = min(
                lump_sum,
                max(0.0, remaining_principal - min(config.monthly_prepayment, remaining_principal)),
            )
            total_lump_sum_payments += actual_lump
            principal_paid = scheduled_principal + prepayment
            ending_bal = max(0.0, starting_bal - principal_paid)
        else:
            remaining_repay_months = total_months - m + 1
            installment = amortized_monthly_installment(starting_bal, effective_apr, remaining_repay_months)
            r_monthly = (effective_apr / 100.0) / 12.0
            interest_due = starting_bal * r_monthly
            scheduled_principal = min(max(0.0, installment - interest_due), starting_bal)
            remaining_principal = max(0.0, starting_bal - scheduled_principal)
            prepayment = min(extra_available, remaining_principal)
            actual_lump = min(
                lump_sum,
                max(0.0, remaining_principal - min(config.monthly_prepayment, remaining_principal)),
            )
            total_lump_sum_payments += actual_lump
            principal_paid = scheduled_principal + prepayment
            ending_bal = max(0.0, starting_bal - principal_paid)

        if ending_bal < 1e-4:
            ending_bal = 0.0

        total_interest += interest_due
        total_principal_paid += principal_paid
        current_balance = ending_bal

        int_paid = round(interest_due, 2)
        prin_paid = round(principal_paid, 2)
        tot_paid = round(int_paid + prin_paid, 2)
        prep_rounded = round(prepayment, 2)
        req_paid = round(tot_paid - prep_rounded, 2)
        if req_paid < 0.0:
            req_paid = 0.0
            prep_rounded = tot_paid

        records.append(
            MonthlyRecord(
                month=m,
                year=year,
                phase=phase,
                starting_balance=round(starting_bal, 2),
                effective_apr=round(effective_apr, 4),
                prime_rate=round(prime_rate, 4),
                required_payment=req_paid,
                prepayment=prep_rounded,
                total_payment=tot_paid,
                interest_paid=int_paid,
                principal_paid=prin_paid,
                ending_balance=round(ending_bal, 2),
            )
        )

        if current_balance <= 1e-4 and m >= last_draw_event_month:
            actual_months = m
            break

    stats = {
        "total_additional_draws": total_additional_draws,
        "total_lump_sum_payments": total_lump_sum_payments,
        "peak_balance": peak_balance,
    }
    return records, actual_months, total_interest, total_principal_paid, stats


def _run_single_trajectory(
    config: HelocConfig, prime_schedule: list[float]
) -> tuple[list[MonthlyRecord], int, float, float]:
    """Simulates a single loan trajectory given a fixed configuration and Prime rate schedule."""
    records, actual_months, total_interest, total_principal_paid, _ = _run_trajectory_with_stats(
        config, prime_schedule
    )
    return records, actual_months, total_interest, total_principal_paid


def simulate_heloc(
    config: HelocConfig,
    prime_schedule: list[float] | None = None,
) -> tuple[TrajectorySummary, list[MonthlyRecord], pd.DataFrame]:
    """Simulates a complete HELOC trajectory with baseline comparisons for prepayments.

    Calculates draw-phase payments, dynamic re-amortization upon transition to the
    repayment period, payment shock metrics, scheduled draw/lump-sum events, optional
    non-APR fee totals, and comparative interest/tenure savings.

    Args:
        config: HELOC loan configuration parameters.
        prime_schedule: Optional monthly sequence of Prime rates (%). Defaults to flat 8.5%.

    Returns:
        Tuple of:
            - TrajectorySummary: High-level KPI summary and baseline comparison metrics.
            - list[MonthlyRecord]: Detailed month-by-month amortization line items.
            - pd.DataFrame: Tabular DataFrame of the complete simulation records.
    """
    total_months = config.draw_period_months + config.repayment_period_months
    if prime_schedule is None:
        prime_schedule = generate_prime_rates(total_months, RateScenarioType.FLAT, base_prime=8.5)
    elif len(prime_schedule) < total_months:
        prime_schedule = generate_prime_rates(
            total_months, RateScenarioType.CUSTOM, base_prime=8.5, custom_rates=prime_schedule
        )
    else:
        prime_schedule = list(prime_schedule[:total_months])

    records, actual_months, total_interest, total_principal, stats = _run_trajectory_with_stats(
        config, prime_schedule
    )

    initial_draw_payment = round(records[0].required_payment, 2) if records else 0.0
    first_repay_idx = config.draw_period_months

    if len(records) > first_repay_idx:
        first_repay_record = records[first_repay_idx]
        last_draw_record = records[first_repay_idx - 1]
        first_repayment_payment = round(first_repay_record.required_payment, 2)
        last_draw_payment = round(last_draw_record.required_payment, 2)
        shock_amount = max(0.0, round(first_repayment_payment - last_draw_payment, 2))
        shock_pct = round((shock_amount / last_draw_payment * 100.0), 2) if last_draw_payment > 0 else 0.0
    else:
        first_repayment_payment = 0.0
        shock_amount = 0.0
        shock_pct = 0.0

    interest_savings = 0.0
    months_saved = 0
    has_lump_sums = any(ev.event_type == "lump_sum" for ev in config.cash_flow_events)

    if config.monthly_prepayment > 0 or has_lump_sums:
        baseline_config = config.model_copy(
            update={
                "monthly_prepayment": 0.0,
                "cash_flow_events": [ev for ev in config.cash_flow_events if ev.event_type == "draw"],
            }
        )
        _, base_months, base_interest, _ = _run_single_trajectory(baseline_config, prime_schedule)
        interest_savings = max(0.0, base_interest - total_interest)
        months_saved = max(0, base_months - actual_months)

    annual_fees_total = (
        round(config.annual_fee * math.ceil(actual_months / 12.0), 2)
        if (actual_months > 0 and config.annual_fee > 0)
        else 0.0
    )
    early_closure_triggered = bool(
        config.early_closure_fee > 0
        and config.early_closure_months > 0
        and actual_months <= config.early_closure_months
    )
    early_closure_applied = round(config.early_closure_fee, 2) if early_closure_triggered else 0.0
    total_fees = round(config.closing_costs + annual_fees_total + early_closure_applied, 2)
    total_cost_with_fees = round(total_interest + total_principal + total_fees, 2)

    summary = TrajectorySummary(
        initial_principal=config.initial_principal,
        credit_limit=config.credit_limit,
        total_months_scheduled=total_months,
        actual_months_to_payoff=actual_months,
        total_interest_paid=round(total_interest, 2),
        total_principal_paid=round(total_principal, 2),
        total_payments=round(total_interest + total_principal, 2),
        initial_draw_payment=initial_draw_payment,
        first_repayment_payment=first_repayment_payment,
        payment_shock_amount=round(shock_amount, 2),
        payment_shock_pct=round(shock_pct, 2),
        interest_savings_vs_baseline=round(interest_savings, 2),
        months_saved_vs_baseline=months_saved,
        total_additional_draws=round(stats["total_additional_draws"], 2),
        total_lump_sum_payments=round(stats["total_lump_sum_payments"], 2),
        peak_balance=round(stats["peak_balance"], 2),
        total_fees=total_fees,
        total_cost_with_fees=total_cost_with_fees,
        early_closure_fee_triggered=early_closure_triggered,
    )

    df = pd.DataFrame([r.model_dump() for r in records]) if records else pd.DataFrame()
    return summary, records, df
