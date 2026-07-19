const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    console.log('--- Querying sessions with tables:table_id(room_id) ---');
    const { data: s1, error: e1 } = await supabase
        .from('sessions')
        .select('id, table_id, tables:table_id(room_id)')
        .limit(3);
    console.log('Using tables:table_id:', e1 || s1);

    console.log('\n--- Querying sessions with tables(room_id) ---');
    const { data: s2, error: e2 } = await supabase
        .from('sessions')
        .select('id, table_id, tables(room_id)')
        .limit(3);
    console.log('Using tables:', e2 || s2);
}

run();
