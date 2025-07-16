import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  // Разрешаем CORS и OPTIONS запросы
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const update = await req.json()
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured')
    }

    // Обрабатываем pre_checkout_query - подтверждаем платеж
    if (update.pre_checkout_query) {
      const preCheckoutQuery = update.pre_checkout_query
      
      console.log('Pre-checkout query:', preCheckoutQuery)
      
      // Подтверждаем платеж
      const response = await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutQuery.id,
          ok: true
        })
      })
      
      const result = await response.json()
      console.log('answerPreCheckoutQuery result:', result)
      
      return new Response(JSON.stringify({ status: 'pre_checkout_confirmed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Обрабатываем successful_payment - записываем в базу
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment
      const userId = update.message.from.id
      
      console.log('Successful payment:', payment)
      
      // Подключаемся к Supabase
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const supabase = createClient(supabaseUrl, supabaseKey)
      
      // Записываем платеж в базу данных
      const { data, error } = await supabase
        .from('payments')
        .insert({
          telegram_id: userId,
          payment_charge_id: payment.telegram_payment_charge_id,
          payload: payment.invoice_payload,
          amount: 2, // 2 звезды
          status: 'paid',
          created_at: new Date().toISOString()
        })
      
      if (error) {
        console.error('Database error:', error)
      } else {
        console.log('Payment recorded:', data)
      }
      
      return new Response(JSON.stringify({ status: 'payment_recorded' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Для всех остальных обновлений просто возвращаем OK
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}) 