# Walk-Forward

The Full profile uses three expanding-window folds. For each fold, the engine evaluates 80%, 100% and 120% period configurations on only the history before that fold's test interval, selects the highest training net P&L variant, and then evaluates that selection on the subsequent untouched test interval.

Each fold records its train/test boundaries, selected period multiplier and independent test metrics. This keeps the selection and forward test chronologically separated; it does not use later fold data to select earlier parameters.
