const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // Get waiter@srms.app details from public.users
    const { data: user, error } = await supabase
        .from('users')
        .select('*, restaurants(name)')
        .eq('email', 'waiter@srms.app')
        .single();
    
    if (error || !user) {
        console.error('Error fetching user:', error);
        return;
    }

    console.log(`User: ${user.full_name} (${user.email})`);
    console.log(`Restaurant: ${user.restaurants?.name} (${user.restaurant_id})`);

    // Fetch settings for this restaurant
    const { data: settings } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', user.restaurant_id)
        .single();
    
    console.log('Features:');
    console.log(JSON.stringify(settings?.features_v2, null, 2));
}

run();
