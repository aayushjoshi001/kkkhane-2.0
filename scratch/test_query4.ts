import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const KITCHEN_ORDER_SELECT = `id,status,order_type,session_id,sessions(id,tables(label,room_id,rooms(room_number)))`

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
