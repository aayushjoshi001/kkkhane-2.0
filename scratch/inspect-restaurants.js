const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: restaurants, error } = await supabase
        .from('restaurants')
        .select('*');

    if (error) {
        console.error(error);
        return;
    }

    restaurants.forEach(r => {
        console.log(`Name: ${r.name}`);
        console.log(`  ID: ${r.id}`);
        console.log(`  business_type: ${r.business_type}`);
        console.log(`  linked_restaurant_id: ${r.linked_restaurant_id}`);
        console.log(`  linked_hotel_id: ${r.linked_hotel_id}`);
        console.log('---');
    });
}

run();
