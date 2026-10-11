"""Unified tool implementation for Antigravity AI agents."""

import os
from typing import Any, Optional
from heloc.core.models import BalanceMethod, HelocConfig, RateScenarioType, YearBasis
from heloc.core.rates import generate_prime_rates, get_effective_rate
from heloc.core.simulator import simulate_heloc


def calculate_heloc_trajectory(
    initial_principal: float,
    credit_limit: float,
    margin: float = 2.0,
    intro_apr: Optional[float] = None,
    intro_duration_months: int = 12,
    prime_rate: float = 8.5,
    rate_scenario: str = "flat",
    annual_rate_step: float = 0.5,
    custom_rates: Optional[list[float]] = None,
    draw_period_years: int = 10,
    repayment_period_years: int = 20,
    lifetime_rate_cap: float = 18.0,
    regulatory_ceiling: float = 25.0,
    monthly_prepayment: float = 0.0,
    balance_method: str = "average_daily_balance",
    year_basis: int = 365,
    export_csv_path: Optional[str] = None,
) -> dict[str, Any]:
    """Calculates a comprehensive monthly HELOC amortization and APR trajectory.

    This function simulates both the interest-only revolving draw period and the
    subsequent fully amortizing repayment period. It accounts for introductory teaser
    rates, public index variations, Washington Consumer Loan Act usury limits (25% max),
    payment shock at transition, and principal prepayment savings.

    Args:
        initial_principal: The starting drawn balance on the credit line (e.g., 50000.0).
        credit_limit: The total approved revolving credit ceiling (e.g., 100000.0).
        margin: Fixed percentage added by the lender to the Prime rate (e.g., 2.0).
        intro_apr: Optional promotional introductory APR percentage (e.g., 0.99).
        intro_duration_months: Number of months the introductory APR remains active.
        prime_rate: Baseline macroeconomic Prime rate (e.g., 8.5).
        rate_scenario: Trajectory profile: 'flat', 'rising', 'stress_test', or 'custom'.
        annual_rate_step: Rate increment per year if using the 'rising' scenario.
        custom_rates: Optional list of explicit monthly Prime rates for custom scenario.
        draw_period_years: Number of years in the draw phase (default: 10).
        repayment_period_years: Number of years in the repayment phase (default: 20).
        lifetime_rate_cap: Contractual maximum interest rate ceiling (e.g., 18.0).
        regulatory_ceiling: Washington Consumer Loan Act usury limit percentage (default: 25.0).
        monthly_prepayment: Extra monthly principal payment beyond required amount.
        balance_method: 'average_daily_balance', 'adjusted_balance', or 'previous_balance'.
        year_basis: Year denominator convention: 365 or 360.
        export_csv_path: Optional file path to export the complete monthly schedule.

    Returns:
        dict: A structured summary dictionary containing KPI summaries, lifecycle
              milestones, annualized trajectory breakdown, and CSV export path.
    """
    total_months = (draw_period_years + repayment_period_years) * 12
    if custom_rates is not None and rate_scenario.lower() == "flat":
        scenario_enum = RateScenarioType.CUSTOM
    else:
        scenario_enum = RateScenarioType(rate_scenario.lower())

    prime_schedule = generate_prime_rates(
        total_months=total_months,
        scenario=scenario_enum,
        base_prime=prime_rate,
        annual_step=annual_rate_step,
        custom_rates=custom_rates,
    )

    config = HelocConfig(
        initial_principal=initial_principal,
        credit_limit=credit_limit,
        margin=margin,
        intro_apr=intro_apr,
        intro_duration_months=intro_duration_months,
        draw_period_months=draw_period_years * 12,
        repayment_period_months=repayment_period_years * 12,
        lifetime_rate_cap=lifetime_rate_cap,
        regulatory_ceiling=regulatory_ceiling,
        monthly_prepayment=monthly_prepayment,
        balance_method=BalanceMethod(balance_method.lower()),
        year_basis=YearBasis(year_basis),
    )

    summary, records, df = simulate_heloc(config, prime_schedule)

    if export_csv_path:
        out_dir = os.path.dirname(export_csv_path)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        df.to_csv(export_csv_path, index=False)

    # Compile annualized milestones
    annual_records: list[dict[str, Any]] = []
    if not df.empty:
        annual_df = (
            df.groupby("year")
            .agg({
                "starting_balance": "first",
                "ending_balance": "last",
                "effective_apr": "mean",
                "total_payment": "sum",
                "interest_paid": "sum",
                "principal_paid": "sum",
            })
            .reset_index()
        )

        for row in annual_df.to_dict(orient="records"):
            annual_records.append({
                "year": int(row["year"]),
                "start_balance": round(float(row["starting_balance"]), 2),
                "end_balance": round(float(row["ending_balance"]), 2),
                "avg_apr": round(float(row["effective_apr"]), 2),
                "total_payment": round(float(row["total_payment"]), 2),
                "interest_paid": round(float(row["interest_paid"]), 2),
                "principal_paid": round(float(row["principal_paid"]), 2),
            })

    milestones: list[dict[str, Any]] = [
        {"event": "Loan Origination", "month": 1, "balance": config.initial_principal}
    ]
    if config.intro_apr is not None and summary.actual_months_to_payoff > config.intro_duration_months:
        next_month = config.intro_duration_months + 1
        next_prime = (
            prime_schedule[config.intro_duration_months]
            if config.intro_duration_months < len(prime_schedule)
            else (prime_schedule[-1] if prime_schedule else 8.5)
        )
        next_rate = get_effective_rate(next_month, config, next_prime)
        milestones.append({
            "event": "Introductory Rate Expiration",
            "month": config.intro_duration_months,
            "next_rate": round(next_rate, 4),
        })

    if summary.actual_months_to_payoff > config.draw_period_months:
        milestones.append({
            "event": "Phase Shift: Repayment Period Begins",
            "month": config.draw_period_months + 1,
            "payment_shock_pct": summary.payment_shock_pct,
            "payment_shock_amount": summary.payment_shock_amount,
        })

    milestones.append({
        "event": "Loan Payoff",
        "month": summary.actual_months_to_payoff,
        "balance": 0.0,
    })

    milestones.sort(key=lambda m: m["month"])

    return {
        "summary": summary.model_dump(),
        "milestones": milestones,
        "annual_trajectory": annual_records,
        "csv_path": export_csv_path,
    }
