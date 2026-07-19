const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // Let's get the active restaurant from bookings
    const { data: booking } = await supabase
        .from('bookings')
        .select('restaurant_id')
        .eq('status', 'checked_in')
        .limit(1)
        .single();
    
    if (!booking) {
        console.log('No active bookings');
        return;
    }
    const restaurantId = booking.restaurant_id;
    console.log(`Active Hotel Restaurant ID: ${restaurantId}`);

    // Fetch the linked restaurant of this Hotel
    const { data: hotelRest } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id')
        .eq('id', restaurantId)
        .single();
    
    const linkedRestaurantId = hotelRest?.linked_restaurant_id;
    console.log(`Linked Partner Restaurant ID: ${linkedRestaurantId}`);

    // Fetch settings for both
    const { data: settingsHotel } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single();
    
    console.log('\nHotel Features:');
    console.log(JSON.stringify(settingsHotel?.features_v2, null, 2));

    if (linkedRestaurantId) {
        const { data: settingsRest } = await supabase
            .from('settings')
            .select('features_v2')
            .eq('restaurant_id', linkedRestaurantId)
            .single();
        console.log('\nPartner Restaurant Features:');
        console.log(JSON.stringify(settingsRest?.features_v2, null, 2));
    }
}

run();
