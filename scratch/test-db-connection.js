const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const res = await supabase
        .from('partner_link_requests')
        .select('*')
        .limit(1);

    console.log('Result for partner_link_requests:', res.data, 'Error:', res.error);
}

run();
