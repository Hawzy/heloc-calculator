"""Generate and verify deterministic Python golden parity fixtures for the JS engine.

Usage:
    python scripts/generate_golden_fixtures.py          # Write/update fixtures
    python scripts/generate_golden_fixtures.py --check  # Exit 1 if fixtures are stale
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from heloc.core.formulas import (
    amortized_monthly_installment,
    average_daily_balance,
    daily_periodic_rate,
    monthly_finance_charge,
)
from heloc.core.models import BalanceMethod, HelocConfig, RateScenarioType, YearBasis
from heloc.core.rates import generate_prime_rates, get_effective_rate
from heloc.core.simulator import simulate_heloc
from heloc.tools.trajectory_tool import calculate_heloc_trajectory

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "golden_parity_vectors.json"


SCENARIO_DEFINITIONS: list[tuple[str, dict[str, Any]]] = [
    (
        "blueprint_rising_prepay",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": 0.99,
            "intro_duration_months": 12,
            "prime_rate": 6.0,
            "rate_scenario": "rising",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 300.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "wa_usury_cap_25pct",
        {
            "initial_principal": 20000.0,
            "credit_limit": 50000.0,
            "margin": 3.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 25.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 12,
            "repayment_period_months": 12,
            "lifetime_rate_cap": 30.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "zero_prepayment_baseline",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 7.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "year_basis_365",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 8.5,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "year_basis_360",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 8.5,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 360,
        },
    ),
    (
        "stress_test_15yr",
        {
            "initial_principal": 60000.0,
            "credit_limit": 120000.0,
            "margin": 2.5,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 6.5,
            "rate_scenario": "stress_test",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 60,
            "repayment_period_months": 120,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "adjusted_balance_prepay",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 7.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 1000.0,
            "balance_method": "adjusted_balance",
            "year_basis": 365,
        },
    ),
    (
        "adb_balance_prepay",
        {
            "initial_principal": 50000.0,
            "credit_limit": 100000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 7.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 1000.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "zero_pct_apr_amortization",
        {
            "initial_principal": 24000.0,
            "credit_limit": 50000.0,
            "margin": 0.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 0.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 12,
            "repayment_period_months": 24,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 0.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "early_payoff_during_draw",
        {
            "initial_principal": 10000.0,
            "credit_limit": 50000.0,
            "margin": 2.0,
            "intro_apr": 0.99,
            "intro_duration_months": 12,
            "prime_rate": 7.0,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 2000.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "custom_prime_padded",
        {
            "initial_principal": 15000.0,
            "credit_limit": 50000.0,
            "margin": 2.0,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 5.0,
            "rate_scenario": "custom",
            "annual_rate_step": 0.5,
            "custom_rates": [5.0, 6.25, 7.5],
            "draw_period_months": 12,
            "repayment_period_months": 12,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 100.0,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
    (
        "cent_rounding_consistency",
        {
            "initial_principal": 43210.55,
            "credit_limit": 100000.0,
            "margin": 2.33,
            "intro_apr": None,
            "intro_duration_months": 12,
            "prime_rate": 8.5,
            "rate_scenario": "flat",
            "annual_rate_step": 0.5,
            "custom_rates": None,
            "draw_period_months": 120,
            "repayment_period_months": 240,
            "lifetime_rate_cap": 18.0,
            "regulatory_ceiling": 25.0,
            "monthly_prepayment": 123.45,
            "balance_method": "average_daily_balance",
            "year_basis": 365,
        },
    ),
]


def _build_formula_vectors() -> dict[str, Any]:
    dpr_365 = daily_periodic_rate(7.25, YearBasis.DAYS_365)
    dpr_360 = daily_periodic_rate(7.25, YearBasis.DAYS_360)
    adb_balances = [40000.0] * 10 + [45000.0] * 10 + [43000.0] * 10
    adb_blueprint = average_daily_balance(adb_balances)
    return {
        "daily_periodic_rate": [
            {"annual_rate_pct": 7.25, "year_basis": 365, "expected": dpr_365},
            {"annual_rate_pct": 7.25, "year_basis": 360, "expected": dpr_360},
        ],
        "average_daily_balance": [
            {"daily_balances": adb_balances, "expected": adb_blueprint},
            {"daily_balances": [], "expected": average_daily_balance([])},
        ],
        "monthly_finance_charge": [
            {
                "balance": adb_blueprint,
                "dpr": dpr_365,
                "days_in_cycle": 30,
                "expected": monthly_finance_charge(adb_blueprint, dpr_365, days_in_cycle=30),
            },
            {
                "balance": 10000.0,
                "dpr": dpr_365,
                "days_in_cycle": None,
                "expected": monthly_finance_charge(10000.0, dpr_365),
            },
        ],
        "amortized_monthly_installment": [
            {
                "principal": 50000.0,
                "annual_rate_pct": 7.25,
                "remaining_months": 240,
                "expected": amortized_monthly_installment(50000.0, 7.25, 240),
            },
            {
                "principal": 12000.0,
                "annual_rate_pct": 0.0,
                "remaining_months": 12,
                "expected": amortized_monthly_installment(12000.0, 0.0, 12),
            },
            {
                "principal": 0.0,
                "annual_rate_pct": 5.0,
                "remaining_months": 12,
                "expected": amortized_monthly_installment(0.0, 5.0, 12),
            },
            {
                "principal": 1000.0,
                "annual_rate_pct": 5.0,
                "remaining_months": 0,
                "expected": amortized_monthly_installment(1000.0, 5.0, 0),
            },
        ],
    }


def _build_scenario_vector(name: str, params: dict[str, Any]) -> dict[str, Any]:
    total_months = params["draw_period_months"] + params["repayment_period_months"]
    scenario_enum = RateScenarioType(params["rate_scenario"])
    prime_schedule = generate_prime_rates(
        total_months=total_months,
        scenario=scenario_enum,
        base_prime=params["prime_rate"],
        annual_step=params["annual_rate_step"],
        custom_rates=params["custom_rates"],
    )
    config = HelocConfig(
        initial_principal=params["initial_principal"],
        credit_limit=params["credit_limit"],
        margin=params["margin"],
        intro_apr=params["intro_apr"],
        intro_duration_months=params["intro_duration_months"],
        draw_period_months=params["draw_period_months"],
        repayment_period_months=params["repayment_period_months"],
        lifetime_rate_cap=params["lifetime_rate_cap"],
        regulatory_ceiling=params["regulatory_ceiling"],
        monthly_prepayment=params["monthly_prepayment"],
        balance_method=BalanceMethod(params["balance_method"]),
        year_basis=YearBasis(params["year_basis"]),
    )

    summary, records, df = simulate_heloc(config, prime_schedule)

    annual_records: list[dict[str, Any]] = []
    if not df.empty:
        annual_df = (
            df.groupby("year")
            .agg(
                {
                    "starting_balance": "first",
                    "ending_balance": "last",
                    "effective_apr": "mean",
                    "total_payment": "sum",
                    "interest_paid": "sum",
                    "principal_paid": "sum",
                }
            )
            .reset_index()
        )
        for row in annual_df.to_dict(orient="records"):
            annual_records.append(
                {
                    "year": int(row["year"]),
                    "start_balance": round(float(row["starting_balance"]), 2),
                    "end_balance": round(float(row["ending_balance"]), 2),
                    "avg_apr": round(float(row["effective_apr"]), 2),
                    "total_payment": round(float(row["total_payment"]), 2),
                    "interest_paid": round(float(row["interest_paid"]), 2),
                    "principal_paid": round(float(row["principal_paid"]), 2),
                }
            )

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
        milestones.append(
            {
                "event": "Introductory Rate Expiration",
                "month": config.intro_duration_months,
                "next_rate": round(next_rate, 4),
            }
        )
    if summary.actual_months_to_payoff > config.draw_period_months:
        milestones.append(
            {
                "event": "Phase Shift: Repayment Period Begins",
                "month": config.draw_period_months + 1,
                "payment_shock_pct": summary.payment_shock_pct,
                "payment_shock_amount": summary.payment_shock_amount,
            }
        )
    milestones.append(
        {
            "event": "Loan Payoff",
            "month": summary.actual_months_to_payoff,
            "balance": 0.0,
        }
    )
    milestones.sort(key=lambda m: m["month"])

    # Cross-check against calculate_heloc_trajectory for year-divisible scenarios
    if params["draw_period_months"] % 12 == 0 and params["repayment_period_months"] % 12 == 0:
        tool_result = calculate_heloc_trajectory(
            initial_principal=params["initial_principal"],
            credit_limit=params["credit_limit"],
            margin=params["margin"],
            intro_apr=params["intro_apr"],
            intro_duration_months=params["intro_duration_months"],
            prime_rate=params["prime_rate"],
            rate_scenario=params["rate_scenario"],
            annual_rate_step=params["annual_rate_step"],
            custom_rates=params["custom_rates"],
            draw_period_years=params["draw_period_months"] // 12,
            repayment_period_years=params["repayment_period_months"] // 12,
            lifetime_rate_cap=params["lifetime_rate_cap"],
            regulatory_ceiling=params["regulatory_ceiling"],
            monthly_prepayment=params["monthly_prepayment"],
            balance_method=params["balance_method"],
            year_basis=params["year_basis"],
        )
        assert tool_result["summary"] == summary.model_dump(), f"Summary mismatch in {name}"
        assert tool_result["milestones"] == milestones, f"Milestones mismatch in {name}"
        assert tool_result["annual_trajectory"] == annual_records, f"Annual trajectory mismatch in {name}"

    return {
        "name": name,
        "params": params,
        "summary": summary.model_dump(),
        "milestones": milestones,
        "annual_trajectory": annual_records,
        "records": [r.model_dump() for r in records],
    }


def generate_payload() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "formula_vectors": _build_formula_vectors(),
        "scenarios": [_build_scenario_vector(name, params) for name, params in SCENARIO_DEFINITIONS],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate or verify golden parity fixtures.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check whether committed fixtures match live Python engine without modifying files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_FIXTURE_PATH,
        help="Target path for golden_parity_vectors.json.",
    )
    args = parser.parse_args(argv)

    serialized = json.dumps(generate_payload(), indent=2, sort_keys=True) + "\n"

    if args.check:
        if not args.output.exists():
            print(f"ERROR: Golden fixture file missing: {args.output}", file=sys.stderr)
            return 1
        with args.output.open("r", encoding="utf-8") as fh:
            existing = fh.read()
        if existing != serialized:
            print(
                f"ERROR: Golden fixtures at {args.output} are out of date. "
                "Run `python scripts/generate_golden_fixtures.py` to regenerate.",
                file=sys.stderr,
            )
            return 1
        print("OK: golden parity fixtures match live Python engine.")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(serialized)
    print(f"Wrote {len(SCENARIO_DEFINITIONS)} scenarios to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
