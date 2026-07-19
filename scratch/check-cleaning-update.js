// Read+write check: does an UPDATE touching cleaning_claimed_by actually work
// through the same REST endpoint the app uses?
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('Project URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    const { data: rows, error: selErr } = await admin
        .from('tables')
        .select('id, label, table_status, cleaning_claimed_by, cleaning_claimed_at')
        .limit(5);
    console.log('SELECT result:', selErr ? selErr : rows);

    if (!rows || rows.length === 0) return;
    const target = rows[0];

    const { data, error } = await admin
        .from('tables')
        .update({ cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', target.id)
        .select('id, cleaning_claimed_by, cleaning_claimed_at');

    if (error) {
        console.log('UPDATE ERROR:', JSON.stringify(error, null, 2));
    } else {
        console.log('UPDATE SUCCESS:', data);
    }
}

run().catch(console.error);
