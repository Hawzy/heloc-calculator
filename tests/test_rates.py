"""Tests for rate resolution, macroeconomic scenarios, and regulatory caps."""

import pytest
from heloc.core.models import HelocConfig, RateScenarioType
from heloc.core.rates import generate_prime_rates, get_effective_rate


def test_intro_rate_application() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        intro_apr=0.99,
        intro_duration_months=12,
        margin=2.0,
    )
    # Months 1-12 use intro APR
    assert get_effective_rate(month=1, config=config, prime_rate=8.5) == 0.99
    assert get_effective_rate(month=12, config=config, prime_rate=8.5) == 0.99
    # Month 13 shifts to Prime (8.5) + Margin (2.0) = 10.5
    assert get_effective_rate(month=13, config=config, prime_rate=8.5) == 10.5


def test_lifetime_cap_enforcement() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=2.0,
        lifetime_rate_cap=18.0,
        regulatory_ceiling=25.0,
    )
    # Prime 17.0 + Margin 2.0 = 19.0 -> clamped to 18.0
    assert get_effective_rate(month=15, config=config, prime_rate=17.0) == 18.0


def test_washington_usury_cap_enforcement() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=3.0,
        lifetime_rate_cap=30.0,  # Unusually high contractual cap
        regulatory_ceiling=25.0,  # WAC 208-620-235 simple interest limit
    )
    # Prime 24.0 + Margin 3.0 = 27.0 -> clamped to 25.0 usury ceiling
    assert get_effective_rate(month=15, config=config, prime_rate=24.0) == 25.0


def test_intro_rate_clamped_by_ceiling() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        intro_apr=19.0,
        intro_duration_months=6,
        lifetime_rate_cap=15.0,
        regulatory_ceiling=25.0,
    )
    assert get_effective_rate(month=1, config=config, prime_rate=5.0) == 15.0


def test_no_intro_rate_specified() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        intro_apr=None,
        intro_duration_months=12,
        margin=2.5,
    )
    # Even during month 1, without intro APR, uses prime + margin
    assert get_effective_rate(month=1, config=config, prime_rate=7.0) == 9.5


def test_scenario_generators() -> None:
    # Flat
    flat_rates = generate_prime_rates(total_months=360, scenario=RateScenarioType.FLAT, base_prime=7.0)
    assert len(flat_rates) == 360
    assert flat_rates[0] == 7.0 and flat_rates[-1] == 7.0

    # Rising step: +0.50% every 12 months
    rising = generate_prime_rates(total_months=36, scenario=RateScenarioType.RISING, base_prime=6.0, annual_step=0.5)
    assert rising[0] == 6.0   # Month 1 (Year 1)
    assert rising[11] == 6.0  # Month 12 (Year 1)
    assert rising[12] == 6.5  # Month 13 (Year 2)
    assert rising[24] == 7.0  # Month 25 (Year 3)


def test_stress_test_scenario() -> None:
    # Macroeconomic stress test: rapid climb by +0.75% every 6 months peaking at +4.5%
    stress = generate_prime_rates(total_months=60, scenario=RateScenarioType.STRESS_TEST, base_prime=5.0)
    assert len(stress) == 60
    assert stress[0] == 5.0          # Semester 0 (months 0-5)
    assert stress[5] == 5.0
    assert stress[6] == 5.75         # Semester 1 (months 6-11)
    assert stress[12] == 6.5         # Semester 2 (months 12-17)
    assert stress[35] == 5.0 + (5 * 0.75)  # Semester 5: 8.75
    assert stress[36] == 5.0 + 4.5   # Semester 6: 9.5 (cap at semester 6)
    assert stress[59] == 9.5         # Beyond semester 6 remains capped at +4.5%


def test_custom_scenario() -> None:
    custom_list = [7.0, 7.25, 7.5, 8.0]
    # Exact / truncated
    result_trunc = generate_prime_rates(
        total_months=3, scenario=RateScenarioType.CUSTOM, base_prime=5.0, custom_rates=custom_list
    )
    assert result_trunc == [7.0, 7.25, 7.5]

    # Padded with last rate
    result_pad = generate_prime_rates(
        total_months=6, scenario=RateScenarioType.CUSTOM, base_prime=5.0, custom_rates=custom_list
    )
    assert result_pad == [7.0, 7.25, 7.5, 8.0, 8.0, 8.0]

    # Empty custom list padded with base prime
    result_empty = generate_prime_rates(
        total_months=3, scenario=RateScenarioType.CUSTOM, base_prime=6.0, custom_rates=[]
    )
    assert result_empty == [6.0, 6.0, 6.0]

    # None custom_rates falls back to base_prime
    result_none = generate_prime_rates(
        total_months=4, scenario=RateScenarioType.CUSTOM, base_prime=6.0, custom_rates=None
    )
    assert result_none == [6.0, 6.0, 6.0, 6.0]


def test_core_reexports() -> None:
    from heloc.core import (
        generate_prime_rates as core_gpr,
        get_effective_rate as core_ger,
    )
    assert core_gpr is generate_prime_rates
    assert core_ger is get_effective_rate


def test_get_effective_rate_invalid_month() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
    )
    with pytest.raises(ValueError, match="month must be greater than or equal to 1"):
        get_effective_rate(month=0, config=config, prime_rate=7.0)
    with pytest.raises(ValueError, match="month must be greater than or equal to 1"):
        get_effective_rate(month=-5, config=config, prime_rate=7.0)


def test_get_effective_rate_floor_at_zero() -> None:
    config = HelocConfig(
        initial_principal=50000.0,
        credit_limit=100000.0,
        margin=1.0,
    )
    # If prime is extremely negative, effective rate floors at 0.0
    assert get_effective_rate(month=1, config=config, prime_rate=-5.0) == 0.0


def test_generate_prime_rates_non_positive_months() -> None:
    assert generate_prime_rates(total_months=0, scenario=RateScenarioType.FLAT, base_prime=7.0) == []
    assert generate_prime_rates(total_months=-1, scenario=RateScenarioType.RISING, base_prime=7.0) == []
    assert generate_prime_rates(total_months=0, scenario=RateScenarioType.STRESS_TEST, base_prime=7.0) == []
    assert generate_prime_rates(total_months=0, scenario=RateScenarioType.CUSTOM, base_prime=7.0, custom_rates=[7.0]) == []

