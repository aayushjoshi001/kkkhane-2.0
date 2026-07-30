import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const KITCHEN_ORDER_SELECT = `
  id, status, order_type, needs_confirmation, total_amount, placed_at, customer_note, booking_id, session_id,
  bookings:booking_id (
    id,
    rooms:room_id ( id, room_number )
  ),
  sessions (
    id,
    seat_number,
    booking_id,
    tables:table_id (
      id,
      label,
      room_id,
      rooms:room_id ( id, room_number ),
      sessions ( id, seat_number, status )
    )
  ),
  order_items (
    id, menu_item_id, quantity, unit_price, special_request, status, station, claimed_by, claimed_at,
    menu_items ( id, name, is_combo ),
    menu_item_variations:menu_item_variation_id ( id, name ),
    order_item_modifiers ( modifier_name, price_adjustment )
  )
`

async function run() {
  const { data, error } = await supabase
    .from('orders')
    .select(KITCHEN_ORDER_SELECT)
    .limit(3)
  
  if (error) console.error(error)
  else console.log(JSON.stringify(data, null, 2))
}

run()
