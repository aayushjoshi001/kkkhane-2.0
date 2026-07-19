const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: booking } = await supabase
        .from('bookings')
        .select('id, room_id, guest_name')
        .eq('guest_phone', '3333')
        .eq('status', 'checked_in')
        .maybeSingle();

    console.log('Booking:', booking);
    if (!booking) return;

    // All sessions tied to this booking, with their table's room_id
    const { data: allSessions, error: e1 } = await supabase
        .from('sessions')
        .select('id, table_id, tables(label, room_id)')
        .eq('booking_id', booking.id);
    console.log('\nAll sessions linked to this booking (before filter):');
    console.log(JSON.stringify(allSessions, null, 2));

    // Simulate the FIXED query
    const { data: filtered, error: e2 } = await supabase
        .from('sessions')
        .select('id, status, table_id, tables!inner(room_id)')
        .eq('booking_id', booking.id)
        .is('tables.room_id', null);
    console.log('\nFiltered sessions (after fix, should exclude the room\'s own table):');
    console.log(JSON.stringify(filtered, null, 2));
    if (e2) console.error('Filter query error:', e2);
}

run();
