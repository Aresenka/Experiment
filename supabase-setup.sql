-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.game_sessions (
  telegram_id bigint,
  finished_at timestamp with time zone,
  time_spent integer,
  maze_seed text,
  prize_position jsonb,
  final_position jsonb,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamp with time zone DEFAULT now(),
  is_won boolean DEFAULT false,
  steps_taken integer DEFAULT 0,
  was_free_attempt boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT game_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT game_sessions_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);
CREATE TABLE public.payments (
  telegram_id bigint,
  payment_charge_id text UNIQUE,
  telegram_payment_id text,
  amount integer,
  payload text,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])),
  attempts_purchased integer DEFAULT 1,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);
CREATE TABLE public.players (
  telegram_id bigint NOT NULL,
  first_name text,
  username text,
  last_free_attempt timestamp with time zone,
  total_attempts integer DEFAULT 0,
  total_wins integer DEFAULT 0,
  total_spent_stars integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT players_pkey PRIMARY KEY (telegram_id)
);
CREATE TABLE public.prizes (
  prize_link text NOT NULL,
  claimed_by bigint,
  claimed_at timestamp with time zone,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  prize_amount numeric DEFAULT 10.00,
  is_claimed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT prizes_pkey PRIMARY KEY (id),
  CONSTRAINT prizes_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES public.players(telegram_id)
);

-- Таблица для результатов тренировочных игр
CREATE TABLE public.training_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  finished_at timestamp with time zone,
  is_won boolean DEFAULT false,
  steps_taken integer DEFAULT 0,
  time_spent integer DEFAULT 0, -- время в секундах
  maze_seed text,
  exit_position jsonb, -- позиция выхода
  final_position jsonb, -- финальная позиция игрока
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT training_results_pkey PRIMARY KEY (id),
  CONSTRAINT training_results_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);

-- Таблица для донатов/поддержки проекта
CREATE TABLE public.donations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  amount_stars integer NOT NULL, -- количество звёзд
  payment_charge_id text UNIQUE,
  telegram_payment_id text,
  payload text,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT donations_pkey PRIMARY KEY (id),
  CONSTRAINT donations_telegram_id_fkey FOREIGN KEY (telegram_id) REFERENCES public.players(telegram_id)
);

-- Обновляем таблицу players для новой модели
ALTER TABLE public.players ADD COLUMN total_training_attempts integer DEFAULT 0;
ALTER TABLE public.players ADD COLUMN total_training_wins integer DEFAULT 0;
ALTER TABLE public.players ADD COLUMN total_donated_stars integer DEFAULT 0;
ALTER TABLE public.players ADD COLUMN best_training_steps integer;
ALTER TABLE public.players ADD COLUMN best_training_time integer; -- лучшее время в секундах

-- View для лидерборда по лучшим шагам
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

-- View для лидерборда по лучшему времени
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

-- View для лидерборда по винрейту
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
WHERE p.total_training_attempts >= 10 -- минимум 10 игр для показа в рейтинге
ORDER BY win_rate DESC, p.total_training_wins DESC;

-- View для лидерборда по поддержке проекта
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