import { createClient } from '@supabase/supabase-js'

// Замените на ваши данные из Supabase Dashboard
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Функции для работы с игрой
export const gameAPI = {
  // Проверить доступность бесплатной попытки (ИСПРАВЛЕНО - используем RPC)
  async canPlayFree(telegramId) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, разрешаем играть')
        return true
      }

      // ИСПРАВЛЕНО: Используем RPC функцию для атомарной проверки
      const { data, error } = await supabase
        .rpc('can_play_free_secure', { player_telegram_id: telegramId })
      
      if (error) {
        console.log('Ошибка RPC:', error.message)
        return false // ИЗМЕНЕНО: по умолчанию запрещаем при ошибке
      }
      
      return data === true
    } catch (error) {
      console.log('Ошибка проверки бесплатной попытки:', error.message)
      return false // ИЗМЕНЕНО: по умолчанию запрещаем при ошибке
    }
  },

  // Зарегистрировать новую попытку (ИСПРАВЛЕНО - только через RPC)
  async registerAttempt(telegramId, firstName, username, isFree = true) {
    try {
      // ИСПРАВЛЕНО: Обязательно используем RPC функцию
      const { data, error } = await supabase
        .rpc('register_attempt_secure', {
          player_telegram_id: telegramId,
          player_first_name: firstName,
          player_username: username,
          is_free: isFree
        })
      
      if (error) {
        console.log('Ошибка регистрации попытки:', error.message)
        return null // ИЗМЕНЕНО: возвращаем null при ошибке
      }
      
      return data
    } catch (error) {
      console.log('Ошибка регистрации попытки:', error.message)
      return null
    }
  },

  // Завершить игру
  async finishGame(sessionId, won, steps, timeSpent, finalPosition) {
    try {
      // Сначала попробуем использовать RPC функцию
      const { error } = await supabase
        .rpc('finish_game', {
          session_id: sessionId,
          won: won,
          steps: steps,
          time_seconds: timeSpent,
          final_pos: finalPosition
        })
      
      if (error) {
        console.log('RPC функция недоступна, используем fallback:', error.message)
        // Fallback: обновляем таблицу напрямую
        try {
          await supabase
            .from('game_sessions')
            .update({
              finished_at: new Date().toISOString(),
              is_won: won,
              steps_taken: steps,
              time_spent: timeSpent,
              final_position: finalPosition
            })
            .eq('id', sessionId)
        } catch (updateError) {
          console.log('Не удалось обновить сессию:', updateError.message)
        }
      }
      
      return true
    } catch (error) {
      console.log('Ошибка завершения игры:', error.message)
      return false
    }
  },

  // Получить стоимость доступного приза
  async getAvailablePrizeValue() {
    try {
      // Проверяем настройку Supabase
      if (supabaseUrl === 'https://your-project.supabase.co') {
        return 'от 0.5$' // Дефолтное значение для тестирования
      }

      // Получаем случайный доступный приз
      const { data: prizes, error } = await supabase
        .from('prizes')
        .select('prize_amount')
        .eq('is_claimed', false)
        .limit(1)
      
      if (error) {
        console.log('Ошибка получения призов:', error.message)
        return 'от 0.5$'
      }

      if (!prizes || prizes.length === 0) {
        return 'от 0.5$' // Если призов нет, показываем минимальную стоимость
      }

      // Возвращаем стоимость приза
      const amount = prizes[0].prize_amount
      return `${amount}$`
    } catch (error) {
      console.log('Ошибка получения стоимости приза:', error.message)
      return 'от 0.5$'
    }
  },

  // Получить доступный приз (ИСПРАВЛЕНО - усиленная валидация)
  async getAvailablePrize(telegramId, sessionId, gameData = {}) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем тестовую ссылку')
        return 'https://example.com/demo-prize'
      }

      // ИСПРАВЛЕНО: Используем специальную RPC функцию с полной валидацией
      const { data: prizeLink, error } = await supabase
        .rpc('get_prize_secure', {
          player_telegram_id: telegramId,
          session_id: sessionId,
          game_data: gameData
        })
      
      if (error) {
        console.log('Ошибка получения приза:', error.message)
        return null
      }
      
      return prizeLink
      
    } catch (error) {
      console.log('Ошибка получения приза:', error.message)
      return null
    }
  },

  // Получить статистику игрока
  async getPlayerStats(telegramId) {
    try {
      const { data: players, error: playerError } = await supabase
        .from('players')
        .select('*')
        .eq('telegram_id', telegramId)
      
      if (playerError || !players || players.length === 0) {
        console.log('Игрок не найден:', playerError?.message)
        return {
          total_attempts: 0,
          total_wins: 0,
          total_spent_stars: 0,
          last_free_attempt: null
        }
      }
      
      const player = players[0]
      // Получаем статистику из сессий
      const { data: sessions, error: sessionsError } = await supabase
        .from('game_sessions')
        .select('is_won, was_free_attempt')
        .eq('telegram_id', telegramId)
        .not('finished_at', 'is', null)
      
      if (sessionsError) {
        console.log('Не удалось получить сессии:', sessionsError.message)
        return {
          total_attempts: player.total_attempts || 0,
          total_wins: player.total_wins || 0,
          total_spent_stars: player.total_spent_stars || 0,
          last_free_attempt: player.last_free_attempt
        }
      }
      
      const totalAttempts = sessions.length
      const totalWins = sessions.filter(s => s.is_won).length
      const totalSpentStars = sessions.filter(s => !s.was_free_attempt).length * 2
      
      return {
        total_attempts: totalAttempts,
        total_wins: totalWins,
        total_spent_stars: totalSpentStars,
        last_free_attempt: player.last_free_attempt
      }
    } catch (error) {
      console.log('Ошибка получения статистики:', error.message)
      return {
        total_attempts: 0,
        total_wins: 0,
        total_spent_stars: 0,
        last_free_attempt: null
      }
    }
  },

  // Записать успешный платёж
  async recordPayment(telegramId, paymentChargeId, amount, payload) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .insert({
          telegram_id: telegramId,
          payment_charge_id: paymentChargeId,
          amount: amount,
          status: 'paid',
          payload: payload
        })
        .select()
        .single()
      
      if (error) throw error
      return data
    } catch (error) {
      console.error('Ошибка записи платежа:', error)
      return null
    }
  },

  // Получить время до следующей бесплатной попытки
  async getTimeUntilNextFree(telegramId) {
    try {
      const { data, error } = await supabase
        .from('players')
        .select('last_free_attempt')
        .eq('telegram_id', telegramId)
      
      if (error || !data || data.length === 0 || !data[0]?.last_free_attempt) return 0
      
      const lastAttempt = new Date(data[0].last_free_attempt)
      const nextFree = new Date(lastAttempt.getTime() + 60 * 60 * 1000) // +1 час
      const now = new Date()
      
      return Math.max(0, Math.floor((nextFree - now) / 1000))
    } catch (error) {
      console.log('Ошибка расчета времени:', error.message)
      return 0
    }
  },

  // Создать инвойс для оплаты через Edge Function
  async createPaymentInvoice(telegramId, userName) {
    try {
      // Проверяем настройку Supabase
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем тестовую ссылку')
        return {
          invoice_url: 'https://t.me/invoice/test',
          payload: `test_payment_${telegramId}_${Date.now()}`
        }
      }

      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: {
          telegram_id: telegramId,
          user_name: userName
        }
      })
      
      console.log('Edge Function response:', { data, error })
      
      if (error) {
        console.log('Ошибка создания инвойса:', error.message, error)
        // Fallback для тестирования
        return {
          invoice_url: 'https://t.me/invoice/test',
          payload: `fallback_payment_${telegramId}_${Date.now()}`
        }
      }
      
      return data
    } catch (error) {
      console.log('Ошибка создания инвойса:', error.message)
      // Fallback для тестирования
      return {
        invoice_url: 'https://t.me/invoice/test',
        payload: `error_payment_${telegramId}_${Date.now()}`
      }
    }
  },

  // Проверить и записать платеж
  async verifyAndRecordPayment(telegramId, payload) {
    try {
      // Проверяем настройку Supabase
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, симулируем успешный платеж')
        return true
      }

      const { data, error } = await supabase.functions.invoke('verify-payment', {
        body: {
          telegram_id: telegramId,
          payload: payload
        }
      })
      
      if (error) {
        console.log('Ошибка проверки платежа:', error.message)
        return false
      }
      
      return data?.status === 'success' || data?.status === 'already_exists'
    } catch (error) {
      console.log('Ошибка проверки платежа:', error.message)
      return false
    }
  },

  // Проверить статус платежа по payload
  async checkPaymentStatus(payload) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('status')
        .eq('payload', payload)
        .eq('status', 'paid')
        .single()
      
      return !error && data
    } catch (error) {
      console.log('Ошибка проверки платежа:', error.message)
      return false
    }
  },

  // ========== МЕТОДЫ ДЛЯ ТРЕНИРОВОЧНОГО РЕЖИМА ==========

  // Зарегистрировать тренировочную сессию
  async registerTrainingSession(telegramId, firstName, username) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем тестовый sessionId')
        return `training_test_${Date.now()}`
      }

      // Создаем или обновляем игрока
      const { error: playerError } = await supabase
        .from('players')
        .upsert({
          telegram_id: telegramId,
          first_name: firstName,
          username: username,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'telegram_id'
        })
      
      if (playerError) {
        console.log('Ошибка создания/обновления игрока:', playerError.message)
        return `training_error_player_${Date.now()}`
      }

      // Создаем тренировочную сессию
      const { data, error } = await supabase
        .from('training_results')
        .insert({
          telegram_id: telegramId,
          started_at: new Date().toISOString()
        })
        .select('id')
        .single()
      
      if (error) {
        console.log('Ошибка создания тренировочной сессии:', error.message)
        return `training_fallback_${Date.now()}`
      }
      
      return data.id
    } catch (error) {
      console.log('Ошибка регистрации тренировочной сессии:', error.message)
      return `training_error_${Date.now()}`
    }
  },

  // Завершить тренировочную сессию
  async finishTrainingSession(sessionId, won, steps, timeSpent, finalPosition, exitPosition) {
    try {
      if (sessionId.startsWith('training_test_') || sessionId.startsWith('training_fallback_') || sessionId.startsWith('training_error_')) {
        console.log('Тестовая сессия, не сохраняем в БД')
        return true
      }

      // Обновляем результат тренировки
      const { data: trainingResult, error: trainingError } = await supabase
        .from('training_results')
        .update({
          finished_at: new Date().toISOString(),
          is_won: won,
          steps_taken: steps,
          time_spent: timeSpent,
          final_position: finalPosition,
          exit_position: exitPosition
        })
        .eq('id', sessionId)
        .select('telegram_id')
        .single()
      
      if (trainingError) {
        console.log('Ошибка обновления тренировочной сессии:', trainingError.message)
        return false
      }

      // ИСПРАВЛЕНО: правильно извлекаем telegram_id из результата запроса
      const telegramId = trainingResult?.telegram_id
      if (!telegramId) {
        console.log('Не удалось получить telegram_id из тренировочной сессии')
        return false
      }

      // Получаем текущую статистику игрока
      const { data: players, error: playerSelectError } = await supabase
        .from('players')
        .select('total_training_attempts, total_training_wins, best_training_steps, best_training_time')
        .eq('telegram_id', telegramId)
      
      if (playerSelectError) {
        console.log('Ошибка получения статистики игрока:', playerSelectError.message)
        return false
      }

      // Если игрок не найден, создаем его
      let player
      if (!players || players.length === 0) {
        console.log('Игрок не найден, создаем новую запись...')
        const { data: newPlayer, error: createError } = await supabase
          .from('players')
          .insert({
            telegram_id: telegramId,
            total_training_attempts: 0,
            total_training_wins: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .select('total_training_attempts, total_training_wins, best_training_steps, best_training_time')
          .single()
        
        if (createError) {
          console.log('Ошибка создания игрока:', createError.message)
          return false
        }
        player = newPlayer
      } else {
        player = players[0]
      }

      // Готовим обновления
      const updates = {
        total_training_attempts: (player.total_training_attempts || 0) + 1,
        updated_at: new Date().toISOString()
      }

      // Если победа - обновляем статистику побед и лучшие результаты  
      if (won) {
        updates.total_training_wins = (player.total_training_wins || 0) + 1
        
        // Обновляем лучшие результаты
        if (!player.best_training_steps || steps < player.best_training_steps) {
          updates.best_training_steps = steps
        }
        if (!player.best_training_time || timeSpent < player.best_training_time) {
          updates.best_training_time = timeSpent
        }
      }

      // ИСПРАВЛЕНО: обновляем статистику игрока
      const { error: playerUpdateError } = await supabase
        .from('players')
        .update(updates)
        .eq('telegram_id', telegramId)
      
      if (playerUpdateError) {
        console.log('Ошибка обновления статистики игрока:', playerUpdateError.message)
        return false
      }
      
      return true
    } catch (error) {
      console.log('Ошибка завершения тренировочной сессии:', error.message)
      return false
    }
  },

  // Получить статистику тренировок игрока
  async getTrainingStats(telegramId) {
    try {
      const { data: players, error: playerError } = await supabase
        .from('players')
        .select(`
          total_training_attempts,
          total_training_wins,
          best_training_steps,
          best_training_time,
          total_donated_stars
        `)
        .eq('telegram_id', telegramId)
      
      if (playerError || !players || players.length === 0) {
        console.log('Игрок не найден:', playerError?.message || 'Нет данных')
        return {
          total_attempts: 0,
          total_wins: 0,
          best_steps: null,
          best_time: null,
          win_rate: 0,
          support_level: 0
        }
      }
      
      const player = players[0]
      
      const winRate = player.total_training_attempts > 0 
        ? Math.round((player.total_training_wins / player.total_training_attempts) * 100)
        : 0
      
      return {
        total_attempts: player.total_training_attempts || 0,
        total_wins: player.total_training_wins || 0,
        best_steps: player.best_training_steps,
        best_time: player.best_training_time,
        win_rate: winRate,
        support_level: player.total_donated_stars || 0
      }
    } catch (error) {
      console.log('Ошибка получения статистики тренировок:', error.message)
      return {
        total_attempts: 0,
        total_wins: 0,
        best_steps: null,
        best_time: null,
        win_rate: 0,
        support_level: 0
      }
    }
  },

  // ========== МЕТОДЫ ДЛЯ ДОНАТОВ ==========

  // Создать инвойс для доната
  async createDonationInvoice(telegramId, userName, amountStars) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем тестовую ссылку')
        return {
          invoice_url: 'https://t.me/invoice/test',
          payload: `test_donation_${telegramId}_${amountStars}_${Date.now()}`,
          amount_stars: amountStars
        }
      }

      const { data, error } = await supabase.functions.invoke('create-donation', {
        body: {
          telegram_id: telegramId,
          user_name: userName,
          amount_stars: amountStars
        }
      })
      
      if (error) {
        console.log('Ошибка создания инвойса доната:', error.message)
        return {
          invoice_url: 'https://t.me/invoice/test',
          payload: `fallback_donation_${telegramId}_${amountStars}_${Date.now()}`,
          amount_stars: amountStars
        }
      }
      
      return data
    } catch (error) {
      console.log('Ошибка создания инвойса доната:', error.message)
      return {
        invoice_url: 'https://t.me/invoice/test',
        payload: `error_donation_${telegramId}_${amountStars}_${Date.now()}`,
        amount_stars: amountStars
      }
    }
  },

  // Проверить и записать донат
  async verifyAndRecordDonation(telegramId, payload, amountStars) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, симулируем успешный донат')
        return true
      }

      const { data, error } = await supabase.functions.invoke('verify-donation', {
        body: {
          telegram_id: telegramId,
          payload: payload,
          amount_stars: amountStars
        }
      })
      
      if (error) {
        console.log('Ошибка проверки доната:', error.message)
        return false
      }
      
      return data?.status === 'success' || data?.status === 'already_exists'
    } catch (error) {
      console.log('Ошибка проверки доната:', error.message)
      return false
    }
  },

  // ========== МЕТОДЫ ДЛЯ ЛИДЕРБОРДОВ ==========

  // Получить лидерборд по лучшим шагам
  async getLeaderboardBestSteps(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('leaderboard_best_steps')
        .select('*')
        .limit(limit)
      
      if (error) {
        console.log('Ошибка получения лидерборда по шагам:', error.message)
        return []
      }
      
      return data || []
    } catch (error) {
      console.log('Ошибка получения лидерборда по шагам:', error.message)
      return []
    }
  },

  // Получить лидерборд по лучшему времени
  async getLeaderboardBestTime(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('leaderboard_best_time')
        .select('*')
        .limit(limit)
      
      if (error) {
        console.log('Ошибка получения лидерборда по времени:', error.message)
        return []
      }
      
      return data || []
    } catch (error) {
      console.log('Ошибка получения лидерборда по времени:', error.message)
      return []
    }
  },

  // Получить лидерборд по винрейту
  async getLeaderboardWinRate(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('leaderboard_win_rate')
        .select('*')
        .limit(limit)
      
      if (error) {
        console.log('Ошибка получения лидерборда по винрейту:', error.message)
        return []
      }
      
      return data || []
    } catch (error) {
      console.log('Ошибка получения лидерборда по винрейту:', error.message)
      return []
    }
  },

  // Получить лидерборд по поддержке проекта
  async getLeaderboardSupporters(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('leaderboard_supporters')
        .select('*')
        .limit(limit)
      
      if (error) {
        console.log('Ошибка получения лидерборда по поддержке:', error.message)
        return []
      }
      
      return data || []
    } catch (error) {
      console.log('Ошибка получения лидерборда по поддержке:', error.message)
      return []
    }
  },

  // ОПТИМИЗИРОВАННЫЙ МЕТОД: Получить все лидерборды одним запросом
  async getAllLeaderboards(limit = 20) {
    try {
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем пустые лидерборды')
        return {
          steps: [],
          time: [],
          winrate: [],
          supporters: []
        }
      }

      // Делаем все запросы параллельно для максимальной скорости
      const [stepsResult, timeResult, winrateResult, supportersResult] = await Promise.all([
        supabase
          .from('leaderboard_best_steps')
          .select('*')
          .limit(limit),
        supabase
          .from('leaderboard_best_time')
          .select('*')
          .limit(limit),
        supabase
          .from('leaderboard_win_rate')
          .select('*')
          .limit(limit),
        supabase
          .from('leaderboard_supporters')
          .select('*')
          .limit(limit)
      ])

      // Проверяем ошибки и возвращаем данные
      const result = {
        steps: stepsResult.error ? [] : (stepsResult.data || []),
        time: timeResult.error ? [] : (timeResult.data || []),
        winrate: winrateResult.error ? [] : (winrateResult.data || []),
        supporters: supportersResult.error ? [] : (supportersResult.data || [])
      }

      // Логируем ошибки если есть
      if (stepsResult.error) console.log('Ошибка лидерборда по шагам:', stepsResult.error.message)
      if (timeResult.error) console.log('Ошибка лидерборда по времени:', timeResult.error.message)
      if (winrateResult.error) console.log('Ошибка лидерборда по винрейту:', winrateResult.error.message)
      if (supportersResult.error) console.log('Ошибка лидерборда по поддержке:', supportersResult.error.message)

      return result
    } catch (error) {
      console.log('Ошибка получения всех лидербордов:', error.message)
      return {
        steps: [],
        time: [],
        winrate: [],
        supporters: []
      }
    }
  }
} 