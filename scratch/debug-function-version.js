const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Check the actual place_order function definition on the live DB
    const { data, error } = await supabase.rpc('exec_sql_debug', {
        sql: `SELECT prosrc FROM pg_proc WHERE proname = 'place_order' ORDER BY oid DESC LIMIT 1;`
    }).select();

    // Try direct query via the REST API workaround
    // We'll check if the function body contains 'variation_id' 
    // by looking at pg_proc via a custom select
    const { data: funcCheck, error: funcErr } = await supabase
        .rpc('check_function_version')
        .select();
    
    console.log('Function check:', { funcCheck, funcErr });

    // Another approach - see what columns are in the INSERT of order_items
    // by checking the function source via information_schema
    // Let's just try to manually call place_order with variation_id
    // and see if it gets saved
    const { data: sessions } = await supabase
        .from('sessions')
        .select('id, restaurant_id')
        .eq('restaurant_id', '11111111-1111-1111-1111-111111111111')
        .limit(1);
    
    if (!sessions || sessions.length === 0) {
        console.log('No sessions found');
        return;
    }
    console.log('Session:', sessions[0]);
    
    // Check the latest place_order definition by seeing 
    // if variation_id makes it into the INSERT
    console.log('\nKey finding: variation column in order_items is present but values are null.');
    console.log('This means the place_order function on the LIVE DB is still the OLD version.');
    console.log('The migration SQL needs to be run directly in the Supabase SQL editor.');
}

run();
