// Read-only check: does public.tables have cleaning_claimed_by/cleaning_claimed_at
// in the exact Supabase project this app's .env.local points to?
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('Project URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);

    const { data, error } = await admin
        .from('tables')
        .select('id, cleaning_claimed_by, cleaning_claimed_at')
        .limit(1);

    if (error) {
        console.log('ERROR (column likely missing or cache stale):', error.code, '-', error.message);
    } else {
        console.log('SUCCESS — columns exist and are queryable. Sample row:', data);
    }
}

run().catch(console.error);
