const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // Let's find a valid session_id from orders first
    const { data: orders } = await supabase
        .from('orders')
        .select('session_id')
        .not('session_id', 'is', null)
        .limit(1);

    if (!orders || orders.length === 0) {
        console.log('No orders with session_id found');
        return;
    }

    const sessionId = orders[0].session_id;
    console.log('Testing query with session_id:', sessionId);

    const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            menu_items (name),
            order_item_modifiers (*)
          )
        `)
        .eq('session_id', sessionId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error Details:', {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint
        });
    } else {
        console.log('Success! Found orders:', data.length);
    }
}

run();
