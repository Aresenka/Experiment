-- Update win rate leaderboard view to show players with 1+ games instead of 10+

DROP VIEW IF EXISTS public.leaderboard_win_rate;
CREATE VIEW public.leaderboard_win_rate AS
SELECT 
  p.telegram_id,
  p.first_name,
  p.username,
  p.best_training_steps,
  p.best_training_time,
  p.total_training_wins,
  p.total_training_attempts,
  p.total_donated_stars,
  CASE 
    WHEN p.total_training_attempts > 0 THEN ROUND((p.total_training_wins::decimal / p.total_training_attempts) * 100, 1)
    ELSE 0 
  END as win_rate
FROM public.players p
WHERE p.total_training_attempts >= 1
ORDER BY win_rate DESC, p.total_training_wins DESC;
