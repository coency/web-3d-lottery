-- Raise only the per-round limit; preserve all existing prize settings and results.
ALTER TABLE draw_rounds DROP CONSTRAINT draw_rounds_draw_count_check;
ALTER TABLE draw_rounds ADD CONSTRAINT draw_rounds_draw_count_check CHECK (draw_count BETWEEN 0 AND 10);
