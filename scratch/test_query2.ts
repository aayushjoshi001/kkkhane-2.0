import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const KITCHEN_ORDER_SELECT = `id,status,order_type,needs_confirmation,total_amount,placed_at,customer_note,booking_id,bookings:booking_id(id,rooms:room_id(id,room_number)),sessions(id,seat_number,booking_id,tables:table_id(id,label,room_id,rooms:room_id(id,room_number),sessions(id,seat_number,status)))`

async function run() {
  const res = await fetch(`${supabaseUrl}/rest/v1/orders?select=${encodeURIComponent(KITCHEN_ORDER_SELECT)}&limit=3`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  })
  
  const data = await res.json()
  console.log(JSON.stringify(data, null, 2))
}

run()
