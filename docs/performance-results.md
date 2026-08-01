# SQLite performance result

Local run on 2026-08-01 using `npm run perf:sqlite` and the production repository/writer path:

| Measurement | Result |
|---|---:|
| Historical rows requested | 250,000 |
| Batch size | 5,000 |
| Elapsed | 14.392 s |
| Throughput | 17,370 rows/s |
| Bulk write average / p95 / max | 239.94 / 331.46 / 346.09 ms |
| Maximum bounded range read | 3.97 ms |
| Maximum interleaved priority-1 live write | 20.68 ms |
| Backend health responses during load | 50/50 successful |
| SQLite busy retries | 0 |
| Rows added by replaying a 5,000-row batch | 0 |
| Database file | 118,173,696 bytes |
| WAL observed before close | 13,196,392 bytes |

The test writes to an ignored, timestamped database under `data/performance`. It interleaves every historical batch with a priority-1 live write and a bounded read, while polling the running backend. This demonstrates the intended workload pattern; it is not a claim about all hardware or multi-process writer workloads.
