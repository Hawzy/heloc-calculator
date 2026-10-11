import os
import subprocess
import sys
from heloc.cli.main import main


def test_cli_help():
    result = subprocess.run(
        [sys.executable, "-m", "heloc", "--help"],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0
    assert "HELOC Simulation Engine" in result.stdout


def test_cli_run_execution():
    result = subprocess.run(
        [
            sys.executable, "-m", "heloc",
            "--balance", "50000",
            "--limit", "100000",
            "--prime", "8.5",
            "--margin", "2.0",
            "--intro-apr", "0.99",
            "--intro-months", "12",
            "--prepayment", "200"
        ],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0
    assert "HELOC LOAN TRAJECTORY SUMMARY" in result.stdout
    assert "Payment Shock" in result.stdout
    assert "PREPAYMENT ACCELERATION SAVINGS" in result.stdout


def test_cli_main_direct_invocation_with_csv(tmp_path):
    csv_file = str(tmp_path / "trajectory_output.csv")
    exit_code = main([
        "--balance", "60000",
        "--limit", "120000",
        "--prime", "8.5",
        "--margin", "1.5",
        "--csv", csv_file,
    ])
    assert exit_code == 0
    assert os.path.exists(csv_file)


def test_cli_balance_exceeds_limit_validation(capsys):
    exit_code = main(["--balance", "150000", "--limit", "100000"])
    assert exit_code == 1
    captured = capsys.readouterr()
    assert "Error:" in captured.err


def test_cli_annual_rate_step():
    exit_code = main([
        "--balance", "50000",
        "--limit", "100000",
        "--scenario", "rising",
        "--annual-rate-step", "0.75",
    ])
    assert exit_code == 0
