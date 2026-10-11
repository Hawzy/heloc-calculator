"""Month-by-month trajectory simulation engine for HELOC amortization."""

import pandas as pd

from heloc.core.formulas import (
    amortized_monthly_installment,
    daily_periodic_rate,
    monthly_finance_charge,
)
from heloc.core.models import (
    BalanceMethod,
    HelocConfig,
    MonthlyRecord,
    RateScenarioType,
    TrajectorySummary,
)
from heloc.core.rates import generate_prime_rates, get_effective_rate


def _run_single_trajectory(
    config: HelocConfig, prime_schedule: list[float]
) -> tuple[list[MonthlyRecord], int, float, float]:
    """Simulates a single loan trajectory given a fixed configuration and Prime rate schedule.

    Args:
        config: HELOC configuration containing loan parameters.
        prime_schedule: List of macroeconomic Prime rates for each month.

    Returns:
        Tuple of (records, actual_months_to_payoff, total_interest_paid, total_principal_paid).
    """
    total_months = config.draw_period_months + config.repayment_period_months
    records: list[MonthlyRecord] = []
    current_balance = config.initial_principal
    total_interest = 0.0
    total_principal_paid = 0.0
    actual_months = total_months

    # Standard monthly day approximation: 365 / 12
    days_in_month = 365.0 / 12.0

    for m in range(1, total_months + 1):
        if current_balance <= 1e-4:
            actual_months = m - 1
            break

        year = ((m - 1) // 12) + 1
        is_draw = m <= config.draw_period_months
        phase = "draw" if is_draw else "repayment"
        prime_rate = prime_schedule[m - 1]
        effective_apr = get_effective_rate(m, config, prime_rate)
        starting_bal = current_balance

        if is_draw:
            dpr = daily_periodic_rate(effective_apr, config.year_basis)
            if config.balance_method == BalanceMethod.ADJUSTED_BALANCE:
                # In Adjusted Balance method, payments made during cycle reduce balance before finance charge
                prepayment = min(config.monthly_prepayment, starting_bal)
                calc_bal = max(0.0, starting_bal - prepayment)
                interest_due = monthly_finance_charge(calc_bal, dpr, days_in_month)
            else:
                interest_due = monthly_finance_charge(starting_bal, dpr, days_in_month)
                prepayment = min(config.monthly_prepayment, starting_bal)

            required_payment = interest_due
            total_payment = required_payment + prepayment
            principal_paid = prepayment
            ending_bal = max(0.0, starting_bal - principal_paid)
        else:
            remaining_repay_months = total_months - m + 1
            installment = amortized_monthly_installment(starting_bal, effective_apr, remaining_repay_months)
            r_monthly = (effective_apr / 100.0) / 12.0
            interest_due = starting_bal * r_monthly
            scheduled_principal = min(max(0.0, installment - interest_due), starting_bal)
            prepayment = min(config.monthly_prepayment, starting_bal - scheduled_principal)
            required_payment = interest_due + scheduled_principal
            total_payment = required_payment + prepayment
            principal_paid = scheduled_principal + prepayment
            ending_bal = max(0.0, starting_bal - principal_paid)

        if ending_bal < 1e-4:
            ending_bal = 0.0

        total_interest += interest_due
        total_principal_paid += principal_paid
        current_balance = ending_bal

        records.append(
            MonthlyRecord(
                month=m,
                year=year,
                phase=phase,
                starting_balance=round(starting_bal, 2),
                effective_apr=round(effective_apr, 4),
                prime_rate=round(prime_rate, 4),
                required_payment=round(required_payment, 2),
                prepayment=round(prepayment, 2),
                total_payment=round(total_payment, 2),
                interest_paid=round(interest_due, 2),
                principal_paid=round(principal_paid, 2),
                ending_balance=round(ending_bal, 2),
            )
        )

        if current_balance <= 1e-4:
            actual_months = m
            break

    return records, actual_months, total_interest, total_principal_paid


def simulate_heloc(
    config: HelocConfig,
    prime_schedule: list[float] | None = None,
) -> tuple[TrajectorySummary, list[MonthlyRecord], pd.DataFrame]:
    """Simulates a complete HELOC trajectory with baseline comparisons for prepayments.

    Calculates interest-only draw payments, dynamic re-amortization upon transition to
    the repayment period, payment shock metrics, and comparative interest/tenure savings.

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

    records, actual_months, total_interest, total_principal = _run_single_trajectory(config, prime_schedule)

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

    if config.monthly_prepayment > 0:
        baseline_config = config.model_copy(update={"monthly_prepayment": 0.0})
        _, base_months, base_interest, _ = _run_single_trajectory(baseline_config, prime_schedule)
        interest_savings = max(0.0, base_interest - total_interest)
        months_saved = max(0, base_months - actual_months)

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
    )

    df = pd.DataFrame([r.model_dump() for r in records]) if records else pd.DataFrame()
    return summary, records, df
