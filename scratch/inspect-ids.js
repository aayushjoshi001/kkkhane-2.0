const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    console.log('--- Inspecting Restaurants ---');
    const { data: restaurants } = await supabase
        .from('restaurants')
        .select('id, name, slug, linked_restaurant_id, linked_hotel_id');
    console.log(restaurants);

    console.log('\n--- Inspecting Rooms ---');
    const { data: rooms } = await supabase
        .from('rooms')
        .select('id, room_number, restaurant_id, type_id')
        .limit(5);
    console.log(rooms);

    console.log('\n--- Inspecting Bookings ---');
    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, room_id, restaurant_id, status')
        .eq('status', 'checked_in')
        .limit(5);
    console.log(bookings);

    console.log('\n--- Inspecting Tables with Room IDs ---');
    const { data: tables } = await supabase
        .from('tables')
        .select('id, label, room_id, restaurant_id, qr_token')
        .not('room_id', 'is', null)
        .limit(5);
    console.log(tables);
}

run();
