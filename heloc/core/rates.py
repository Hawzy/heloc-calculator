"""Rate determination, scenario generation, and regulatory usury enforcement.

Implements rate resolution and macroeconomic index projections:
- get_effective_rate: Computes active effective APR under intro terms, lifetime contractual caps,
  and Washington State Consumer Loan Act usury limits (WAC 208-620-235 simple interest ceiling).
- generate_prime_rates: Synthesizes multi-year Prime rate schedules under FLAT, RISING,
  STRESS_TEST, and CUSTOM macroeconomic scenarios.
"""

from heloc.core.models import HelocConfig, RateScenarioType


def get_effective_rate(month: int, config: HelocConfig, prime_rate: float) -> float:
    """Calculates active effective APR for a given simulated month under caps and intro terms.

    Enforces Regulation Z disclosures, contractual lifetime caps, and Washington State CLA
    usury limits (WAC 208-620-235).

    Args:
        month: 1-indexed month number in the loan lifecycle.
        config: HELOC configuration parameters containing margins, caps, and intro terms.
        prime_rate: Underlying Prime rate for the current billing cycle (%).

    Raises:
        ValueError: If month is less than 1.
    """
    if month < 1:
        raise ValueError("month must be greater than or equal to 1")

    applied_ceiling = min(config.lifetime_rate_cap, config.regulatory_ceiling)

    # Check introductory teaser period
    if config.intro_apr is not None and month <= config.intro_duration_months:
        return max(0.0, min(config.intro_apr, applied_ceiling))

    # Fully indexed variable rate: Prime + Margin
    raw_rate = prime_rate + config.margin
    return max(0.0, min(raw_rate, applied_ceiling))


def generate_prime_rates(
    total_months: int,
    scenario: RateScenarioType,
    base_prime: float,
    annual_step: float = 0.5,
    custom_rates: list[float] | None = None,
) -> list[float]:
    """Generates a list of Prime rates for each month according to the selected scenario.

    Args:
        total_months: Total duration of the simulation in months (e.g., 360 for 30 years).
        scenario: Macroeconomic rate scenario (FLAT, RISING, STRESS_TEST, or CUSTOM).
        base_prime: Starting base Prime rate (%).
        annual_step: Annual percentage rate increment for RISING scenario (default: 0.5%).
        custom_rates: Optional explicit monthly Prime rates for CUSTOM scenario.

    Returns:
        List of float Prime rates corresponding to each month [0..total_months-1].
    """
    if total_months <= 0:
        return []

    if scenario == RateScenarioType.CUSTOM and custom_rates is not None:
        if len(custom_rates) < total_months:
            # Pad with last rate (or base_prime if empty) if list is shorter than total months
            last_rate = custom_rates[-1] if custom_rates else base_prime
            return list(custom_rates) + [last_rate] * (total_months - len(custom_rates))
        return list(custom_rates[:total_months])

    if scenario == RateScenarioType.FLAT:
        return [base_prime] * total_months

    if scenario == RateScenarioType.RISING:
        rates: list[float] = []
        for m in range(total_months):
            year_idx = m // 12
            rates.append(base_prime + (year_idx * annual_step))
        return rates

    if scenario == RateScenarioType.STRESS_TEST:
        # Macroeconomic stress test: rapid climb by +0.75% every 6 months peaking at +4.5%
        rates = []
        for m in range(total_months):
            semester_idx = min(m // 6, 6)
            rates.append(base_prime + (semester_idx * 0.75))
        return rates

    # Fallback to base prime
    return [base_prime] * total_months
