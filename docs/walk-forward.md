# Walk-forward validation

Each fold trains only on data before its OOS interval. Candidate period multipliers are evaluated independently in that training window and are eligible only with at least 30 completed training trades, positive net profit, profit factor of at least 1, and maximum drawdown no worse than 50%.

The report persists every candidate, its training metrics, eligibility decision and reasons, the selected multiplier, and the OOS metrics. If no candidate is eligible, the fold is saved as `NO_ELIGIBLE_CANDIDATE` and no OOS configuration is silently selected. The policy version is stored alongside every fold.
