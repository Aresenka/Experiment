// Публичный webhook для Telegram (без авторизации Supabase)
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const update = await req.json()
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured')
      return new Response(JSON.stringify({ error: 'Bot token not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Received webhook update:', JSON.stringify(update, null, 2))

    // Обрабатываем pre_checkout_query - подтверждаем платеж
    if (update.pre_checkout_query) {
      const preCheckoutQuery = update.pre_checkout_query
      
      console.log('Processing pre_checkout_query:', preCheckoutQuery.id)
      
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

    // Обрабатываем successful_payment - записываем в БД
    if (update.message?.successful_payment) {
      const payment = update.message.successful_payment
      const userId = update.message.from.id
      
      console.log('Successful payment received:', {
        user_id: userId,
        charge_id: payment.telegram_payment_charge_id,
        payload: payment.invoice_payload,
        amount: payment.total_amount
      })
      
      // ИСПРАВЛЯЕМ: Используем Service Role Key для обхода RLS
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)
        
        const { data, error } = await supabase
          .from('payments')
          .insert({
            telegram_id: userId,
            payment_charge_id: payment.telegram_payment_charge_id,
            telegram_payment_id: payment.telegram_payment_charge_id,
            payload: payment.invoice_payload,
            amount: 2,
            status: 'paid',
            created_at: new Date().toISOString()
          })
        
        if (error) {
          console.error('Database error:', error)
        } else {
          console.log('Payment recorded:', data)
        }
      } catch (dbError) {
        console.error('Database connection error:', dbError)
      }
      
      return new Response(JSON.stringify({ status: 'payment_recorded' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('Webhook error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
}) 