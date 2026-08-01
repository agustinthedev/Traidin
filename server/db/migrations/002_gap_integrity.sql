DELETE FROM gaps
WHERE expected_candles <= 0 OR gap_start > gap_end;

CREATE TRIGGER IF NOT EXISTS gaps_validate_insert
BEFORE INSERT ON gaps
WHEN NEW.expected_candles <= 0 OR NEW.gap_start > NEW.gap_end
BEGIN
  SELECT RAISE(ABORT, 'invalid gap range');
END;

CREATE TRIGGER IF NOT EXISTS gaps_validate_update
BEFORE UPDATE OF gap_start, gap_end, expected_candles ON gaps
WHEN NEW.expected_candles <= 0 OR NEW.gap_start > NEW.gap_end
BEGIN
  SELECT RAISE(ABORT, 'invalid gap range');
END;
