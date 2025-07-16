import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { payload, telegram_id } = await req.json()
    
    // Подключаемся к Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)
    
    // Проверяем существует ли платеж с таким payload
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('payload', payload)
      .eq('telegram_id', telegram_id)
      .single()
    
    if (existingPayment) {
      return new Response(JSON.stringify({ 
        status: 'already_exists',
        payment: existingPayment 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    
    // Записываем новый платеж
    const { data, error } = await supabase
      .from('payments')
      .insert({
        telegram_id: telegram_id,
        payload: payload,
        amount: 2,
        status: 'paid',
        created_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (error) {
      throw error
    }
    
    return new Response(JSON.stringify({ 
      status: 'success',
      payment: data 
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