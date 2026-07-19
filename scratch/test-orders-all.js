const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data: orders, error } = await supabase
        .from('orders')
        .select(`
            id,
            placed_at,
            client_request_id,
            order_items (
                id,
                menu_item_id,
                quantity,
                unit_price,
                special_request,
                menu_item_variation_id
            )
        `)
        .order('placed_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching orders:', error);
    } else {
        console.log('Last 5 orders details:');
        console.log(JSON.stringify(orders, null, 2));
    }
}

run();
