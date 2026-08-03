# Strategy Versioning

Publishing creates a monotonically numbered immutable snapshot. The canonical JSON configuration hash is unique within a Strategy. The version stores registry version, parent ID, change notes and verification status; a Verification Run stores the concrete version and hash used.

`GET /api/strategy-versions/compare?left=<id>&right=<id>` returns a recursive, path-addressed difference set between two immutable configurations. Arrays are compared element by element, so identical snapshots produce no false differences.

`POST /api/strategy-versions/<id>/archive` changes only the lifecycle status to `ARCHIVED`. It never rewrites the snapshot, linked runs, trades, report, or data fingerprint.

`POST /api/strategy-versions/<id>/clone` creates a new Strategy with a v1 snapshot copied from the source and an origin parent reference. A clone is separate so the original Strategy's per-Strategy configuration-hash uniqueness remains intact.
