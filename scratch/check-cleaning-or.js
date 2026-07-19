// Reproduce the exact markTableClean() query from src/app/(staff)/waiter/actions.ts
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Table 2 was 'dirty' in the earlier select
    const tableId = '3ecedba5-b324-4cc5-80b3-df96cd08a5fe';
    const fakeUserId = '00000000-0000-0000-0000-000000000000';

    const { data, error } = await admin
        .from('tables')
        .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        .or(`cleaning_claimed_by.eq.${fakeUserId},cleaning_claimed_by.is.null`)
        .select('id')

    if (error) {
        console.log('OR-QUERY ERROR:', JSON.stringify(error, null, 2));
    } else {
        console.log('OR-QUERY SUCCESS:', data);
    }
}

run().catch(console.error);
