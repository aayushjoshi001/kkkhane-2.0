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
    const { data: tables, error } = await supabase
        .from('tables')
        .select('id, qr_token, room_id, rooms(id, room_number)')
        .not('room_id', 'is', null);

    if (error) {
        console.error(error);
        return;
    }

    console.log('Tables mapped to rooms:', tables.map(t => ({
        table_id: t.id,
        qr_token: t.qr_token,
        room_id: t.room_id,
        room_number: t.rooms?.room_number
    })));
}

run();
