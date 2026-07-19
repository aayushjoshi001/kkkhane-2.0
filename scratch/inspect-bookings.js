const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: bookings, error } = await supabase
        .from('bookings')
        .select('*, rooms(room_number)')
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        return;
    }

    console.log('Bookings in database:', bookings.map(b => ({
        id: b.id,
        guest_name: b.guest_name,
        room_number: b.rooms?.room_number,
        status: b.status,
        check_in: b.check_in,
        check_out: b.check_out
    })));
}

run();
