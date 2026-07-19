// Read-only: does a plain SELECT using the same .or() filter syntax also fail?
// Isolates whether the bug is in .or() filter parsing itself vs. something
// specific to UPDATE+RETURNING.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const fakeUserId = '00000000-0000-0000-0000-000000000000';

    const { data, error } = await admin
        .from('tables')
        .select('id, table_status, cleaning_claimed_by')
        .eq('table_status', 'dirty')
        .or(`cleaning_claimed_by.eq.${fakeUserId},cleaning_claimed_by.is.null`);

    if (error) {
        console.log('SELECT+OR ERROR:', JSON.stringify(error, null, 2));
    } else {
        console.log('SELECT+OR SUCCESS:', data);
    }
}

run().catch(console.error);
