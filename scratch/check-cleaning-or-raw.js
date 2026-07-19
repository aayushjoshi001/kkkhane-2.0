// Log the raw outgoing HTTP request PostgREST receives for the .or() filter,
// to check exactly what query string supabase-js generates.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const origFetch = global.fetch;
global.fetch = async (url, opts) => {
    console.log('--- REQUEST ---');
    console.log(opts?.method, url.toString());
    console.log('body:', opts?.body);
    const res = await origFetch(url, opts);
    const clone = res.clone();
    console.log('status:', res.status);
    console.log('response body:', await clone.text());
    console.log('---------------');
    return res;
};

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const tableId = '9aadf8e5-17a5-45f4-a76a-1c839d053958'; // CABIN: Table 4, dirty
    const fakeUserId = '00000000-0000-0000-0000-000000000000';

    await admin
        .from('tables')
        .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        .or(`cleaning_claimed_by.eq.${fakeUserId},cleaning_claimed_by.is.null`)
        .select('id');
}

run().catch(console.error);
