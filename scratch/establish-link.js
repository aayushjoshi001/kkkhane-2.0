const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // Let's link Royal Rest House (Hotel) and royal (Restaurant)
    const hotelId = '0ac00f51-94b0-4964-aeea-f494cfb4f7e0';
    const restaurantId = '7002652c-d7f4-4d13-8760-c931799aea59';

    const { error: err1 } = await supabase
        .from('restaurants')
        .update({ linked_restaurant_id: restaurantId })
        .eq('id', hotelId);

    const { error: err2 } = await supabase
        .from('restaurants')
        .update({ linked_hotel_id: hotelId })
        .eq('id', restaurantId);

    if (err1 || err2) {
        console.error(err1, err2);
        return;
    }
    console.log('Linked Royal Rest House & royal successfully!');
}

run();
