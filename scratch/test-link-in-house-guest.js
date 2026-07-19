const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Simulating linkInHouseGuest for session '2b145f35-74d2-40c1-b503-4816d268978d'
// and guest phone number representing 'Anish Sharma'
async function run() {
    const sessionToken = 'c0db362d-944a-4f51-a20c-c766b19a16f9'; // We need the session_token of session 2b145f35-74d2-40c1-b503-4816d268978d
    
    // First, let's get the session by ID to find its token
    const { data: session } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', '2b145f35-74d2-40c1-b503-4816d268978d')
        .single();

    if (!session) {
        console.error('Session not found');
        return;
    }

    console.log(`Session found: Token = ${session.session_token}, Restaurant ID = ${session.restaurant_id}`);

    // Let's resolve the linked hotel
    const { data: restLink } = await supabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', session.restaurant_id)
        .maybeSingle();

    const targetRestaurantId = restLink?.linked_hotel_id || session.restaurant_id;
    console.log(`Linked Hotel/Target Restaurant ID: ${targetRestaurantId}`);

    // Let's find the booking for Anish Sharma. We will inspect the bookings table first
    const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in');

    console.log('Checked-in bookings at the Hotel:');
    bookings.forEach(b => {
        console.log(`Guest: ${b.guest_name}, Phone: ${b.guest_phone}, ID: ${b.id}`);
    });
}

run();
