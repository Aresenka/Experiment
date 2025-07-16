import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { telegram_id, user_name } = await req.json()
    
    // Создаем инвойс через Telegram Bot API
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    
    if (!botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN not configured')
    }
    
    const invoiceData = {
      title: '🎯 Maze Prize - Дополнительная попытка',
      description: 'Купите дополнительную попытку найти приз $10',
      payload: `maze_attempt_${telegram_id}_${Date.now()}`,
      currency: 'XTR', // Telegram Stars
      prices: [{ label: 'Дополнительная попытка', amount: 2 }]
    }
    
    const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoiceData)
    })
    
    const result = await response.json()
    
    if (result.ok) {
      return new Response(JSON.stringify({ 
        invoice_url: result.result,
        payload: invoiceData.payload 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    } else {
      console.error('Telegram API error:', result)
      throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`)
    }
    
  } catch (error) {
    console.error('Edge Function error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
