-- Migration: Add training mode and donations system
-- Created: 2024-01-27

-- 1. Create training_results table
CREATE TABLE IF NOT EXISTS public.training_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  finished_at timestamp with time zone,
  is_won boolean DEFAULT false,
  steps_taken integer DEFAULT 0,
  time_spent integer DEFAULT 0,
  maze_seed text,
  exit_position jsonb,
  final_position jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT training_results_pkey PRIMARY KEY (id),
  CONSTRAINT training_results_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);

-- 2. Create donations table
CREATE TABLE IF NOT EXISTS public.donations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  amount_stars integer NOT NULL,
  payment_charge_id text UNIQUE,
  telegram_payment_id text,
  payload text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT donations_pkey PRIMARY KEY (id),
  CONSTRAINT donations_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);

-- 3. Add new columns to players table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'total_training_attempts') THEN
    ALTER TABLE public.players ADD COLUMN total_training_attempts integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'total_training_wins') THEN
    ALTER TABLE public.players ADD COLUMN total_training_wins integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'total_donated_stars') THEN
    ALTER TABLE public.players ADD COLUMN total_donated_stars integer DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'best_training_steps') THEN
    ALTER TABLE public.players ADD COLUMN best_training_steps integer;
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'best_training_time') THEN
    ALTER TABLE public.players ADD COLUMN best_training_time integer;
  END IF;
END $$;

-- 4. Create leaderboard views
DROP VIEW IF EXISTS public.leaderboard_best_steps;
CREATE VIEW public.leaderboard_best_steps AS
SELECT 
  p.telegram_id,
  p.first_name,
  p.username,
  p.best_training_steps,
  p.total_training_wins,
  p.total_training_attempts,
  p.total_donated_stars,
  CASE 
    WHEN p.total_training_attempts > 0 THEN ROUND((p.total_training_wins::decimal / p.total_training_attempts) * 100, 1)
    ELSE 0 
  END as win_rate
FROM public.players p
WHERE p.best_training_steps IS NOT NULL
ORDER BY p.best_training_steps ASC, p.total_training_wins DESC;

DROP VIEW IF EXISTS public.leaderboard_best_time;
CREATE VIEW public.leaderboard_best_time AS
SELECT 
  p.telegram_id,
  p.first_name,
  p.username,
  p.best_training_time,
  p.total_training_wins,
  p.total_training_attempts,
  p.total_donated_stars,
  CASE 
    WHEN p.total_training_attempts > 0 THEN ROUND((p.total_training_wins::decimal / p.total_training_attempts) * 100, 1)
    ELSE 0 
  END as win_rate
FROM public.players p
WHERE p.best_training_time IS NOT NULL
ORDER BY p.best_training_time ASC, p.total_training_wins DESC;

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

DROP VIEW IF EXISTS public.leaderboard_supporters;
CREATE VIEW public.leaderboard_supporters AS
SELECT 
  p.telegram_id,
  p.first_name,
  p.username,
  p.total_donated_stars,
  p.total_training_wins,
  p.total_training_attempts,
  CASE 
    WHEN p.total_training_attempts > 0 THEN ROUND((p.total_training_wins::decimal / p.total_training_attempts) * 100, 1)
    ELSE 0 
  END as win_rate
FROM public.players p
WHERE p.total_donated_stars > 0
ORDER BY p.total_donated_stars DESC, p.total_training_wins DESC;

-- 5. Enable RLS for new tables
ALTER TABLE public.training_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS policies
CREATE POLICY "Enable read access for all users" ON public.training_results FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON public.training_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update for authenticated users only" ON public.training_results FOR UPDATE USING (true);

CREATE POLICY "Enable read access for all users" ON public.donations FOR SELECT USING (true);
CREATE POLICY "Enable insert for authenticated users only" ON public.donations FOR INSERT WITH CHECK (true);
