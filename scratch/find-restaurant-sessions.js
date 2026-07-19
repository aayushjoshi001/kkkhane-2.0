const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: sessions } = await supabase
        .from('sessions')
        .select('*, tables(*)')
        .eq('restaurant_id', '4cd9c144-e32a-4b6d-aa4c-2f6de4ec1318');

    console.log('Sessions for Demo Restaurant (all statuses):');
    sessions.forEach(s => {
        console.log(`Session ID: ${s.id}`);
        console.log(`  Session Token: ${s.session_token}`);
        console.log(`  Table Label: ${s.tables?.label}`);
        console.log(`  Status: ${s.status}`);
        console.log(`  Booking ID: ${s.booking_id}`);
    });
}

run();
