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
        .single()
      
      if (error || !data?.last_free_attempt) return 0
      
      const lastAttempt = new Date(data.last_free_attempt)
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
  }
} 