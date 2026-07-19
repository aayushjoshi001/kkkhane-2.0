const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: settings } = await supabase
        .from('settings')
        .select('restaurant_id, features_v2, restaurants(name)');
    
    console.log('All settings and features:');
    for (const s of settings || []) {
        console.log(`- Restaurant: ${s.restaurants?.name} (${s.restaurant_id})`);
        console.log(`  waiterSessionEnabled: ${s.features_v2?.waiterSessionEnabled}`);
        console.log(`  selfOrderRequestEnabled: ${s.features_v2?.selfOrderRequestEnabled}`);
    }
}

run();
