import { createClient } from '@supabase/supabase-js'

// Замените на ваши данные из Supabase Dashboard
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'your-anon-key'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Функции для работы с игрой
export const gameAPI = {
  // Проверить доступность бесплатной попытки
  async canPlayFree(telegramId) {
    try {
      // Проверяем подключение к Supabase
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, разрешаем играть')
        return true
      }

      // Используем простую проверку через таблицу БЕЗ .single()
      const { data: players, error: playerError } = await supabase
        .from('players')
        .select('last_free_attempt')
        .eq('telegram_id', telegramId)
      
      if (playerError) {
        console.log('Ошибка запроса:', playerError.message)
        return true
      }
      
      // Если игрок не найден или список пустой
      if (!players || players.length === 0) {
        return true // Новый игрок - разрешаем играть
      }
      
      const player = players[0]
      if (!player.last_free_attempt) {
        return true
      }
      
      const lastAttempt = new Date(player.last_free_attempt)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      return lastAttempt < oneHourAgo
    } catch (error) {
      console.log('Ошибка проверки бесплатной попытки:', error.message)
      return true
    }
  },

  // Зарегистрировать новую попытку
  async registerAttempt(telegramId, firstName, username, isFree = true) {
    try {
      // Сначала попробуем использовать RPC функцию
      const { data, error } = await supabase
        .rpc('register_attempt', {
          player_telegram_id: telegramId,
          player_first_name: firstName,
          player_username: username,
          is_free: isFree
        })
      
      if (error) {
        console.log('RPC функция недоступна, используем fallback:', error.message)
        // Fallback: создаем игрока и сессию вручную
        const sessionId = Math.random().toString(36).substring(7)
        
        // Попробуем создать/обновить игрока
        try {
          await supabase
            .from('players')
            .upsert({
              telegram_id: telegramId,
              first_name: firstName,
              username: username,
              last_free_attempt: isFree ? new Date().toISOString() : undefined
            }, {
              onConflict: 'telegram_id'
            })
        } catch (playerError) {
          console.log('Не удалось создать игрока:', playerError.message)
        }
        
        // Попробуем создать сессию
        try {
          await supabase
            .from('game_sessions')
            .insert({
              id: sessionId,
              telegram_id: telegramId,
              was_free_attempt: isFree,
              started_at: new Date().toISOString()
            })
        } catch (sessionError) {
          console.log('Не удалось создать сессию:', sessionError.message)
        }
        
        return sessionId
      }
      
      return data
    } catch (error) {
      console.log('Ошибка регистрации попытки:', error.message)
      return Math.random().toString(36).substring(7) // Временный ID
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

  // Получить доступный приз (ИСПРАВЛЕНО)
  async getAvailablePrize(telegramId, sessionId) {
    try {
      // Проверяем настройку Supabase
      if (supabaseUrl === 'https://your-project.supabase.co') {
        console.log('Supabase не настроен, возвращаем тестовую ссылку')
        return 'https://example.com/demo-prize'
      }

      // 1. Проверяем статус игровой сессии
      const { data: session, error: sessionError } = await supabase
        .from('game_sessions')
        .select('is_won, was_free_attempt, telegram_id')
        .eq('id', sessionId)
        .single()
      
      if (sessionError || !session) {
        console.log('Сессия не найдена:', sessionError?.message)
        return null
      }

      // 2. Проверяем, что это победная сессия
      if (!session.is_won) {
        console.log('Игрок не выиграл в этой сессии')
        return null
      }

      // 3. Если игра была платной, проверяем статус платежа
      if (!session.was_free_attempt) {
        const { data: payment, error: paymentError } = await supabase
          .from('payments')
          .select('status')
          .eq('telegram_id', telegramId)
          .eq('status', 'paid')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        
        if (paymentError || !payment) {
          console.log('Платеж не найден или не подтвержден:', paymentError?.message)
          return null
        }
      }

      // 4. Пытаемся получить приз через RPC функцию
      try {
        const { data: prizeLink, error: rpcError } = await supabase
          .rpc('get_available_prize')
        
        if (!rpcError && prizeLink) {
          console.log('Приз получен через RPC:', prizeLink)
          return prizeLink
        }
        
        console.log('RPC не вернул приз:', rpcError?.message)
      } catch (rpcError) {
        console.log('RPC функция выдала ошибку:', rpcError.message)
      }

      // 5. Fallback: работаем с таблицей напрямую
      console.log('Используем fallback - прямое обращение к таблице')
      const { data: prize, error: prizeError } = await supabase
        .from('prizes')
        .select('id, prize_link')
        .eq('is_claimed', false)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()
      
      if (prizeError || !prize) {
        console.log('Нет доступных призов:', prizeError?.message)
        return 'https://example.com/demo-prize' // Возвращаем заглушку если призы закончились
      }

      // 6. Отмечаем приз как использованный
      const { error: updateError } = await supabase
        .from('prizes')
        .update({ 
          is_claimed: true, 
          claimed_by: telegramId,
          claimed_at: new Date().toISOString()
        })
        .eq('id', prize.id)
      
      if (updateError) {
        console.log('Ошибка обновления приза:', updateError.message)
      }

      console.log('Приз выдан:', prize.prize_link)
      return prize.prize_link
      
    } catch (error) {
      console.log('Ошибка получения приза:', error.message)
      return 'https://example.com/demo-prize'
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