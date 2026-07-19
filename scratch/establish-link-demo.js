const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const hotelId = 'b9d6eb61-ea34-4372-96de-8683b93b0e42'; // Demo Grand Hotel
    const restaurantId = '4cd9c144-e32a-4b6d-aa4c-2f6de4ec1318'; // Demo Restaurant

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
    console.log('Linked Demo Grand Hotel & Demo Restaurant successfully!');
}

run();
