const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const restaurantId = '0ac00f51-94b0-4964-aeea-f494cfb4f7e0'; // Royal Rest House (Hotel)

    // 1. Fetch linked restaurant
    const { data: restData } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id')
        .eq('id', restaurantId)
        .single();

    const linkedRestaurantId = restData?.linked_restaurant_id;
    console.log(`Linked Restaurant ID: ${linkedRestaurantId}`);

    const targetRestaurantIds = [restaurantId];
    if (linkedRestaurantId) {
        targetRestaurantIds.push(linkedRestaurantId);
    }
    console.log(`Target Restaurant IDs for query:`, targetRestaurantIds);

    // 2. Fetch active orders
    const { data: activeOrders, error } = await supabase
        .from('orders')
        .select(`
            id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address, payment_status,
            sessions ( id, booking_id, tables ( label ) ),
            order_items ( id, quantity, status, unit_price, menu_items ( name ) )
        `)
        .in('restaurant_id', targetRestaurantIds)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid');

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Retrieved ${activeOrders.length} active orders.`);
    activeOrders.forEach(o => {
        console.log(`Order ID: ${o.id}`);
        console.log(`  Session ID: ${o.session_id}`);
        console.log(`  Session Booking ID: ${o.sessions?.booking_id}`);
        console.log(`  Total: ${o.total_amount}`);
        console.log(`  Items Count: ${o.order_items?.length}`);
        o.order_items?.forEach(item => {
            console.log(`    - ${item.menu_items?.name} (${item.quantity}x @ ${item.unit_price})`);
        });
        console.log('---');
    });
}

run();
