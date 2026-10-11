"""Tests for Antigravity AI agent tool integration."""

import os
import pytest
from heloc.tools.trajectory_tool import calculate_heloc_trajectory
from heloc.tools import calculate_heloc_trajectory as reexported_tool


def test_calculate_heloc_trajectory_schema():
    """Verifies that the trajectory tool returns expected schema keys and metrics."""
    result = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        intro_apr=0.99,
        intro_duration_months=12,
        prime_rate=7.5,
        rate_scenario="flat",
        monthly_prepayment=300.0,
    )
    assert "summary" in result
    assert "milestones" in result
    assert "annual_trajectory" in result
    assert result["summary"]["initial_principal"] == 50000.0
    assert result["summary"]["interest_savings_vs_baseline"] > 0.0
    assert isinstance(result["milestones"], list)
    assert len(result["milestones"]) >= 3
    assert isinstance(result["annual_trajectory"], list)
    assert len(result["annual_trajectory"]) > 0


def test_calculate_heloc_trajectory_csv_export(tmp_path):
    """Verifies CSV generation when export_csv_path is supplied."""
    csv_file = str(tmp_path / "test_schedule.csv")
    result = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        export_csv_path=csv_file,
    )
    assert result["csv_path"] == csv_file
    assert os.path.exists(csv_file)


def test_calculate_heloc_trajectory_csv_export_nested_dir(tmp_path):
    """Verifies CSV generation when parent directory does not exist yet."""
    csv_file = str(tmp_path / "nested" / "reports" / "schedule.csv")
    result = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        export_csv_path=csv_file,
    )
    assert result["csv_path"] == csv_file
    assert os.path.exists(csv_file)


def test_calculate_heloc_trajectory_defaults():
    """Verifies default argument behavior and zero prepayment baseline."""
    result = calculate_heloc_trajectory(
        initial_principal=25000.0,
        credit_limit=50000.0,
    )
    assert result["summary"]["initial_principal"] == 25000.0
    assert result["summary"]["interest_savings_vs_baseline"] == 0.0
    assert result["csv_path"] is None
    # No intro_apr was passed, so intro milestone should not be in milestones
    events = [m["event"] for m in result["milestones"]]
    assert "Introductory Rate Expiration" not in events
    assert "Phase Shift: Repayment Period Begins" in events
    assert "Loan Payoff" in events


def test_calculate_heloc_trajectory_rising_scenario():
    """Verifies that the tool supports 'rising' scenario and annual trajectory aggregations."""
    result = calculate_heloc_trajectory(
        initial_principal=40000.0,
        credit_limit=80000.0,
        prime_rate=6.0,
        rate_scenario="rising",
        annual_rate_step=0.5,
        draw_period_years=5,
        repayment_period_years=10,
    )
    trajectory = result["annual_trajectory"]
    assert len(trajectory) > 1
    # Average APR in year 2 should be higher than year 1 under rising rates
    assert trajectory[1]["avg_apr"] > trajectory[0]["avg_apr"]


def test_calculate_heloc_trajectory_early_payoff_milestones():
    """Verifies early payoff during draw period omits repayment phase shift and sorts chronologically."""
    result = calculate_heloc_trajectory(
        initial_principal=10000.0,
        credit_limit=50000.0,
        monthly_prepayment=2000.0,
        draw_period_years=10,
        repayment_period_years=20,
    )
    milestones = result["milestones"]
    events = [m["event"] for m in milestones]
    assert "Phase Shift: Repayment Period Begins" not in events
    assert "Loan Payoff" in events

    # Check chronological ordering
    months = [m["month"] for m in milestones]
    assert months == sorted(months)
    assert result["summary"]["actual_months_to_payoff"] <= 120


def test_calculate_heloc_trajectory_intro_rate_cap_enforcement():
    """Verifies that next_rate on intro expiration enforces contractual caps."""
    result = calculate_heloc_trajectory(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=5.0,
        prime_rate=15.0,  # 15 + 5 = 20.0 > cap 18.0
        intro_apr=1.99,
        intro_duration_months=6,
        lifetime_rate_cap=18.0,
    )
    intro_milestone = next(m for m in result["milestones"] if m["event"] == "Introductory Rate Expiration")
    assert intro_milestone["next_rate"] == 18.0


def test_reexport():
    """Verifies that calculate_heloc_trajectory is re-exported from heloc.tools."""
    assert reexported_tool is calculate_heloc_trajectory
