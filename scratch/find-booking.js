const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const bookingId = '6eb791ee-2bb8-448c-84d0-d3f1b66f89db';
    
    const { data: booking } = await supabase
        .from('bookings')
        .select('*, rooms(id, room_number)')
        .eq('id', bookingId)
        .single();
    console.log('Booking details for 6eb791ee-2bb8-448c-84d0-d3f1b66f89db:', booking);
}

run();
