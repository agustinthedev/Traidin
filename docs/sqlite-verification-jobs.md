# SQLite Verification Jobs

Verification jobs use the existing WAL database and priority writer. The worker has one local concurrency slot and yields periodically, so it does not hold an SQLite write transaction while calculating indicators or iterating candles. Progress, logs, trades and final result are separately persisted.
## Progress, cancellation and audit

The dashboard polls only while a run is `QUEUED`, `RUNNING` or `CANCELLING`, showing stage, completed candles, simulated trades and elapsed time. Cancellation sets a persistent request flag; the worker checks it at bounded checkpoints and transitions to `CANCELLED` instead of reporting a partial run as completed. The report renders persisted structured logs for stage changes, warnings and failures.

`GET /api/verification-runs/:id/events` is a Server-Sent Events stream that emits changed run snapshots while the run is active and closes at a terminal state. The dashboard subscribes to active runs and retains a bounded polling fallback for reconnect and list reconciliation.

The local worker has one concurrent execution slot, so queued runs expose a local queue position. Retrying a failed or cancelled run creates a new immutable run with the same snapshot and seed; repeated retry clicks while that clone is active return the same queued/running clone rather than multiplying work.
