-- Создание таблиц для Maze Prize Game
-- Выполните этот скрипт в SQL Editor в Supabase

-- 1. Таблица игроков
CREATE TABLE players (
  telegram_id BIGINT PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  last_free_attempt TIMESTAMP WITH TIME ZONE,
  total_attempts INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  total_spent_stars INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Таблица призов (чеки xRocket)
CREATE TABLE prizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_link TEXT NOT NULL,
  prize_amount DECIMAL(10,2) DEFAULT 10.00,
  is_claimed BOOLEAN DEFAULT FALSE,
  claimed_by BIGINT REFERENCES players(telegram_id),
  claimed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Таблица платежей
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT REFERENCES players(telegram_id),
  payment_charge_id TEXT UNIQUE,
  telegram_payment_id TEXT,
  amount INTEGER, -- в звёздах
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payload TEXT,
  attempts_purchased INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Таблица игровых сессий (для аналитики)
CREATE TABLE game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT REFERENCES players(telegram_id),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  finished_at TIMESTAMP WITH TIME ZONE,
  is_won BOOLEAN DEFAULT FALSE,
  steps_taken INTEGER DEFAULT 0,
  time_spent INTEGER, -- в секундах
  was_free_attempt BOOLEAN DEFAULT FALSE,
  maze_seed TEXT, -- для воспроизведения лабиринта
  prize_position JSONB, -- {x: 5, y: 7}
  final_position JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Индексы для производительности
CREATE INDEX idx_players_telegram_id ON players(telegram_id);
CREATE INDEX idx_players_last_free_attempt ON players(last_free_attempt);
CREATE INDEX idx_payments_telegram_id ON payments(telegram_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_game_sessions_telegram_id ON game_sessions(telegram_id);
CREATE INDEX idx_game_sessions_finished_at ON game_sessions(finished_at);
CREATE INDEX idx_prizes_is_claimed ON prizes(is_claimed);

-- 6. Функция для проверки доступности бесплатной попытки
CREATE OR REPLACE FUNCTION can_play_free(player_telegram_id BIGINT)
RETURNS BOOLEAN AS $$
DECLARE
  last_attempt TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT last_free_attempt INTO last_attempt 
  FROM players 
  WHERE telegram_id = player_telegram_id;
  
  -- Если игрок новый или прошло больше часа
  RETURN (last_attempt IS NULL OR last_attempt < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

-- 7. Функция для регистрации новой попытки
CREATE OR REPLACE FUNCTION register_attempt(
  player_telegram_id BIGINT,
  player_first_name TEXT DEFAULT NULL,
  player_username TEXT DEFAULT NULL,
  is_free BOOLEAN DEFAULT TRUE
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
BEGIN
  -- Создаем или обновляем игрока
  INSERT INTO players (telegram_id, first_name, username, last_free_attempt, total_attempts)
  VALUES (player_telegram_id, player_first_name, player_username, 
          CASE WHEN is_free THEN NOW() ELSE NULL END, 1)
  ON CONFLICT (telegram_id) 
  DO UPDATE SET 
    first_name = COALESCE(EXCLUDED.first_name, players.first_name),
    username = COALESCE(EXCLUDED.username, players.username),
    last_free_attempt = CASE WHEN is_free THEN NOW() ELSE players.last_free_attempt END,
    total_attempts = players.total_attempts + 1,
    updated_at = NOW();
  
  -- Создаем игровую сессию
  INSERT INTO game_sessions (telegram_id, was_free_attempt)
  VALUES (player_telegram_id, is_free)
  RETURNING id INTO session_id;
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- 8. Функция для завершения игры
CREATE OR REPLACE FUNCTION finish_game(
  session_id UUID,
  won BOOLEAN,
  steps INTEGER,
  time_seconds INTEGER,
  final_pos JSONB
)
RETURNS VOID AS $$
BEGIN
  UPDATE game_sessions 
  SET 
    finished_at = NOW(),
    is_won = won,
    steps_taken = steps,
    time_spent = time_seconds,
    final_position = final_pos
  WHERE id = session_id;
  
  -- Если выиграл, увеличиваем счетчик побед
  IF won THEN
    UPDATE players 
    SET total_wins = total_wins + 1, updated_at = NOW()
    WHERE telegram_id = (
      SELECT telegram_id FROM game_sessions WHERE id = session_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. Функция для получения доступного приза (ИСПРАВЛЕНО)
CREATE OR REPLACE FUNCTION get_available_prize()
RETURNS TEXT 
SECURITY DEFINER -- Важно! Запускается с правами владельца функции
AS $$
DECLARE
  result_prize_link TEXT;
  prize_id UUID;
BEGIN
  -- Ищем первый доступный приз
  SELECT id, prize_link INTO prize_id, result_prize_link
  FROM prizes 
  WHERE is_claimed = FALSE 
  ORDER BY created_at ASC 
  LIMIT 1;
  
  -- Если приз не найден, возвращаем null
  IF prize_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Отмечаем приз как использованный
  UPDATE prizes 
  SET 
    is_claimed = TRUE, 
    claimed_at = NOW()
  WHERE id = prize_id;
  
  -- Возвращаем ссылку на приз
  RETURN result_prize_link;
END;
$$ LANGUAGE plpgsql;

-- ДОБАВЛЕНО: Безопасная функция проверки бесплатной попытки
CREATE OR REPLACE FUNCTION can_play_free_secure(player_telegram_id BIGINT)
RETURNS BOOLEAN 
SECURITY DEFINER
AS $$
DECLARE
  last_attempt TIMESTAMP WITH TIME ZONE;
  recent_attempts INTEGER;
BEGIN
  -- Проверяем количество попыток за последнюю минуту (защита от спама)
  SELECT COUNT(*) INTO recent_attempts
  FROM game_sessions 
  WHERE telegram_id = player_telegram_id 
    AND started_at > NOW() - INTERVAL '1 minute';
  
  IF recent_attempts >= 3 THEN
    RETURN FALSE;
  END IF;
  
  -- Основная проверка бесплатной попытки
  SELECT last_free_attempt INTO last_attempt 
  FROM players 
  WHERE telegram_id = player_telegram_id;
  
  RETURN (last_attempt IS NULL OR last_attempt < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

-- ДОБАВЛЕНО: Безопасная функция регистрации попытки
CREATE OR REPLACE FUNCTION register_attempt_secure(
  player_telegram_id BIGINT,
  player_first_name TEXT DEFAULT NULL,
  player_username TEXT DEFAULT NULL,
  is_free BOOLEAN DEFAULT TRUE
)
RETURNS UUID AS $$
DECLARE
  session_id UUID;
  can_play BOOLEAN;
BEGIN
  -- Если бесплатная попытка, проверяем доступность
  IF is_free THEN
    SELECT can_play_free_secure(player_telegram_id) INTO can_play;
    IF NOT can_play THEN
      RAISE EXCEPTION 'Бесплатная попытка недоступна';
    END IF;
  END IF;
  
  -- Создаем или обновляем игрока
  INSERT INTO players (telegram_id, first_name, username, last_free_attempt, total_attempts)
  VALUES (player_telegram_id, player_first_name, player_username, 
          CASE WHEN is_free THEN NOW() ELSE NULL END, 1)
  ON CONFLICT (telegram_id) 
  DO UPDATE SET 
    first_name = COALESCE(EXCLUDED.first_name, players.first_name),
    username = COALESCE(EXCLUDED.username, players.username),
    last_free_attempt = CASE WHEN is_free THEN NOW() ELSE players.last_free_attempt END,
    total_attempts = players.total_attempts + 1,
    updated_at = NOW();
  
  -- Создаем игровую сессию
  INSERT INTO game_sessions (telegram_id, was_free_attempt)
  VALUES (player_telegram_id, is_free)
  RETURNING id INTO session_id;
  
  RETURN session_id;
END;
$$ LANGUAGE plpgsql;

-- ДОБАВЛЕНО: Безопасная функция получения приза
CREATE OR REPLACE FUNCTION get_prize_secure(
  player_telegram_id BIGINT,
  session_id UUID,
  game_data JSONB DEFAULT '{}'::JSONB
)
RETURNS TEXT 
SECURITY DEFINER
AS $$
DECLARE
  result_prize_link TEXT;
  prize_id UUID;
  session_won BOOLEAN;
  session_exists BOOLEAN;
  already_claimed BOOLEAN;
  was_free_attempt BOOLEAN;
  payment_exists BOOLEAN;
BEGIN
  -- 1. Проверяем существование и статус сессии
  SELECT is_won, was_free_attempt INTO session_won, was_free_attempt
  FROM game_sessions 
  WHERE id = session_id AND telegram_id = player_telegram_id;
  
  session_exists := FOUND;
  
  IF NOT session_exists THEN
    RAISE EXCEPTION 'Сессия не найдена или не принадлежит игроку';
  END IF;
  
  IF NOT session_won THEN
    RAISE EXCEPTION 'Игрок не выиграл в этой сессии';
  END IF;
  
  -- 2. Проверяем, не был ли уже получен приз для этой сессии
  SELECT EXISTS(
    SELECT 1 FROM prizes 
    WHERE claimed_by = player_telegram_id 
      AND claimed_at > (SELECT started_at FROM game_sessions WHERE id = session_id)
  ) INTO already_claimed;
  
  IF already_claimed THEN
    RAISE EXCEPTION 'Приз для этой сессии уже был получен';
  END IF;
  
  -- 3. Если игра была платной, проверяем статус платежа
  IF NOT was_free_attempt THEN
    SELECT EXISTS(
      SELECT 1 FROM payments 
      WHERE telegram_id = player_telegram_id 
        AND status = 'paid'
        AND created_at > NOW() - INTERVAL '1 hour'
    ) INTO payment_exists;
    
    IF NOT payment_exists THEN
      RAISE EXCEPTION 'Платеж не найден или не подтвержден';
    END IF;
  END IF;
  
  -- 4. Ищем первый доступный приз
  SELECT id, prize_link INTO prize_id, result_prize_link
  FROM prizes 
  WHERE is_claimed = FALSE 
  ORDER BY created_at ASC 
  LIMIT 1;
  
  IF prize_id IS NULL THEN
    RETURN 'https://example.com/demo-prize';
  END IF;
  
  -- 5. Отмечаем приз как использованный
  UPDATE prizes 
  SET 
    is_claimed = TRUE, 
    claimed_by = player_telegram_id,
    claimed_at = NOW()
  WHERE id = prize_id;
  
  RETURN result_prize_link;
END;
$$ LANGUAGE plpgsql;

-- 10. RLS (Row Level Security) политики
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE prizes ENABLE ROW LEVEL SECURITY;

-- Политика: игроки могут видеть только свои данные
CREATE POLICY "Players can view own data" ON players
  FOR ALL USING (telegram_id = current_setting('app.telegram_id')::BIGINT);

CREATE POLICY "Players can view own sessions" ON game_sessions
  FOR ALL USING (telegram_id = current_setting('app.telegram_id')::BIGINT);

CREATE POLICY "Players can view own payments" ON payments
  FOR ALL USING (telegram_id = current_setting('app.telegram_id')::BIGINT);

-- ИСПРАВЛЕНО: Политики для таблицы prizes
-- Разрешаем чтение неиспользованных призов всем аутентифицированным пользователям
CREATE POLICY "Anyone can read unclaimed prizes" ON prizes
  FOR SELECT USING (is_claimed = FALSE);

-- Разрешаем обновление призов только через Service Role
CREATE POLICY "Service role can update prizes" ON prizes
  FOR UPDATE USING (auth.role() = 'service_role');

-- Разрешаем RPC функциям полный доступ к призам  
CREATE POLICY "RPC functions can manage prizes" ON prizes
  FOR ALL USING (
    current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
    OR auth.role() = 'service_role'
  );

-- Вставим несколько тестовых призов (замените на реальные ссылки xRocket)
INSERT INTO prizes (prize_link, prize_amount) VALUES 
('https://xrocket.tg/pay/DEMO1', 10.00),
('https://xrocket.tg/pay/DEMO2', 10.00),
('https://xrocket.tg/pay/DEMO3', 10.00),
('https://xrocket.tg/pay/DEMO4', 10.00),
('https://xrocket.tg/pay/DEMO5', 10.00);

COMMENT ON TABLE players IS 'Игроки Maze Prize Game';
COMMENT ON TABLE prizes IS 'Призовые чеки xRocket';
COMMENT ON TABLE payments IS 'Платежи в Telegram Stars';
COMMENT ON TABLE game_sessions IS 'Игровые сессии для аналитики'; 