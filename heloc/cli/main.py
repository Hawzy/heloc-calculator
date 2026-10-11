"""Command Line Interface for running HELOC simulations."""

import argparse
import sys
from typing import Optional
from pydantic import ValidationError
from heloc.tools.trajectory_tool import calculate_heloc_trajectory


def main(args: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Localized HELOC Simulation Engine & APR Calculator (Regulation Z & WA CLA Compliant)"
    )
    parser.add_argument("--balance", type=float, required=True, help="Initial drawn principal balance ($)")
    parser.add_argument("--limit", type=float, required=True, help="Total credit line limit ($)")
    parser.add_argument("--prime", type=float, default=8.5, help="Current Prime rate (%%) (default: 8.5)")
    parser.add_argument("--margin", type=float, default=2.0, help="Lender margin added to Prime (%%) (default: 2.0)")
    parser.add_argument("--intro-apr", type=float, default=None, help="Introductory teaser APR (%%)")
    parser.add_argument("--intro-months", type=int, default=12, help="Introductory period duration in months (default: 12)")
    parser.add_argument("--annual-rate-step", type=float, default=0.5, help="Rate increment per year if using rising scenario (%%) (default: 0.5)")
    parser.add_argument("--draw-years", type=int, default=10, help="Draw period duration in years (default: 10)")
    parser.add_argument("--repay-years", type=int, default=20, help="Repayment period duration in years (default: 20)")
    parser.add_argument("--cap", type=float, default=18.0, help="Lifetime interest rate ceiling (%%) (default: 18.0)")
    parser.add_argument("--prepayment", type=float, default=0.0, help="Extra monthly principal prepayment ($) (default: 0.0)")
    parser.add_argument("--scenario", choices=["flat", "rising", "stress_test"], default="flat", help="Prime rate scenario")
    parser.add_argument(
        "--balance-method",
        choices=["average_daily_balance", "adjusted_balance", "previous_balance"],
        default="average_daily_balance",
        help="Balance method for interest calculation (default: average_daily_balance)",
    )
    parser.add_argument(
        "--year-basis",
        type=int,
        choices=[365, 360],
        default=365,
        help="Year basis convention for DPR calculation (365 or 360) (default: 365)",
    )
    parser.add_argument("--csv", type=str, default=None, help="File path to export monthly CSV schedule")

    parsed = parser.parse_args(args)

    try:
        result = calculate_heloc_trajectory(
            initial_principal=parsed.balance,
            credit_limit=parsed.limit,
            margin=parsed.margin,
            intro_apr=parsed.intro_apr,
            intro_duration_months=parsed.intro_months,
            prime_rate=parsed.prime,
            rate_scenario=parsed.scenario,
            annual_rate_step=parsed.annual_rate_step,
            draw_period_years=parsed.draw_years,
            repayment_period_years=parsed.repay_years,
            lifetime_rate_cap=parsed.cap,
            monthly_prepayment=parsed.prepayment,
            balance_method=parsed.balance_method,
            year_basis=parsed.year_basis,
            export_csv_path=parsed.csv,
        )
    except (ValueError, ValidationError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    s = result["summary"]
    print("=" * 70)
    print("           HELOC LOAN TRAJECTORY SUMMARY")
    print("=" * 70)
    print(f" Initial Balance:          ${s['initial_principal']:>12,.2f}")
    print(f" Credit Limit:             ${s['credit_limit']:>12,.2f}")
    print(f" Total Term Scheduled:      {s['total_months_scheduled']:>12} months")
    print(f" Actual Payoff Horizon:     {s['actual_months_to_payoff']:>12} months")
    print("-" * 70)
    print(f" Initial Draw Payment:     ${s['initial_draw_payment']:>12,.2f} /mo")
    print(f" First Repayment Payment:  ${s['first_repayment_payment']:>12,.2f} /mo")
    print(f" Payment Shock Spike:      +${s['payment_shock_amount']:>11,.2f} (+{s['payment_shock_pct']:.1f}%)")
    print("-" * 70)
    print(f" Total Interest Paid:      ${s['total_interest_paid']:>12,.2f}")
    print(f" Total Principal Paid:     ${s['total_principal_paid']:>12,.2f}")
    print(f" Total Cumulative Outlay:  ${s['total_payments']:>12,.2f}")

    if s["interest_savings_vs_baseline"] > 0:
        print("=" * 70)
        print("           PREPAYMENT ACCELERATION SAVINGS")
        print("=" * 70)
        print(f" Monthly Prepayment:       ${parsed.prepayment:>12,.2f}")
        print(f" Interest Saved:           ${s['interest_savings_vs_baseline']:>12,.2f}")
        print(f" Tenure Shaved Off:         {s['months_saved_vs_baseline']:>12} months ({s['months_saved_vs_baseline']/12:.1f} years)")

    print("=" * 70)
    print(f"{'Year':<6}{'Start Bal':<14}{'End Bal':<14}{'Avg APR':<10}{'Total Paid':<14}{'Interest':<12}")
    print("-" * 70)
    for row in result["annual_trajectory"][:15]:  # print first 15 years in console
        apr_str = f"{row['avg_apr']:.2f}%"
        print(f"{row['year']:<6}${row['start_balance']:<13,.2f}${row['end_balance']:<13,.2f}{apr_str:<10}${row['total_payment']:<13,.2f}${row['interest_paid']:<11,.2f}")
    if len(result["annual_trajectory"]) > 15:
        print(f"... ({len(result['annual_trajectory']) - 15} additional years omitted from console preview)")

    if parsed.csv:
        print(f"\n[+] Full amortization schedule saved to: {parsed.csv}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
