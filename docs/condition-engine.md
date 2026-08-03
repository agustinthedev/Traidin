# Condition Engine

Conditions compare feature, indicator, price and constant references with scalar comparisons, crossings, boolean checks and ranges. Nested `AND`, `OR` and single-child `NOT` groups are evaluated deterministically at the trigger candle's close.

Publishing validates indicator IDs and parameter ranges, requested outputs, and every referenced timeframe. Missing warm-up or unavailable data evaluates as false with a reason code; it cannot become an implicit signal.

