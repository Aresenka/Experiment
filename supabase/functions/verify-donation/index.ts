import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { payload, telegram_id, amount_stars } = await req.json()
    
    // Подключаемся к Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    // Проверяем существует ли донат с таким payload
    const { data: existingDonation } = await supabase
      .from('donations')
      .select('*')
      .eq('payload', payload)
      .eq('telegram_id', telegram_id)
      .single()
    
    if (existingDonation) {
      return new Response(JSON.stringify({ 
        status: 'already_exists',
        donation: existingDonation 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Ограничение по времени (не больше 1 доната в минуту)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const { data: recentDonations } = await supabase
      .from('donations')
      .select('id')
      .eq('telegram_id', telegram_id)
      .gte('created_at', oneMinuteAgo)
    
    if (recentDonations && recentDonations.length > 0) {
      return new Response(JSON.stringify({ 
        error: 'Слишком частые донаты. Подождите минуту.' 
      }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Проверка платежа через Telegram API (для production)
    if (botToken && !payload.startsWith('test_') && !payload.startsWith('fallback_')) {
      try {
        // В реальном приложении здесь должна быть проверка webhook данных
        // о платеже от Telegram. Пока что пропускаем для тестовых донатов
        console.log('Проверка доната через Telegram API...')
        
      } catch (telegramError) {
        console.error('Ошибка проверки через Telegram:', telegramError)
        return new Response(JSON.stringify({ 
          error: 'Донат не подтвержден Telegram API' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }
    
    // Записываем новый донат
    const { data: donationData, error: donationError } = await supabase
      .from('donations')
      .insert({
        telegram_id: telegram_id,
        payload: payload,
        amount_stars: amount_stars,
        status: 'paid',
        created_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (donationError) {
      throw donationError
    }
    
    // Обновляем статистику игрока - ИСПРАВЛЕНО
    // Сначала получаем текущее значение
    const { data: currentPlayer, error: getPlayerError } = await supabase
      .from('players')
      .select('total_donated_stars')
      .eq('telegram_id', telegram_id)
      .single()
    
    if (!getPlayerError && currentPlayer) {
      const newTotal = (currentPlayer.total_donated_stars || 0) + amount_stars
      
      const { error: playerError } = await supabase
        .from('players')
        .update({
          total_donated_stars: newTotal,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegram_id)
      
      if (playerError) {
        console.error('Ошибка обновления статистики игрока:', playerError)
        // Не критичная ошибка, продолжаем
      }
    }
    
    return new Response(JSON.stringify({ 
      status: 'success',
      donation: donationData,
      message: `Спасибо за поддержку проекта! Ваш донат ${amount_stars} ⭐ засчитан!`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}) 