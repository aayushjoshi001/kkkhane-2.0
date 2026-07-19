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
    // Let's find a valid table with room_id first
    const { data: tables } = await supabase
        .from('tables')
        .select('id, qr_token, room_id')
        .not('room_id', 'is', null)
        .limit(1);

    if (!tables || tables.length === 0) {
        console.log('No tables with room_id found');
        return;
    }

    const table = tables[0];
    console.log('Testing table:', table);

    // Let's fetch the stay context
    const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('room_id', table.room_id)
        .eq('status', 'checked_in')
        .maybeSingle();

    console.log('Active booking for room:', booking);

    // Now call the endpoint logic directly
    const tableSlug = table.qr_token;
    
    const { data: tableData } = await supabase
        .from('tables')
        .select('id, room_id')
        .eq('qr_token', tableSlug)
        .single();

    console.log('Resolved table:', tableData);
}

run();
