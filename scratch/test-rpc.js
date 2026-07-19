const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Let's query the definition of place_order from database pg_proc
    const { data, error } = await supabase.rpc('get_item_recipe', { menuItemId: '331127bf-5f4f-45b3-80e8-eaf1ac350283' });
    console.log('getItemRecipe check:', { data, error });

    // Let's query the pg_proc system table using direct SQL if possible, 
    // or let's inspect the parameters of place_order by trying to check the order_items table structure.
    const { data: cols, error: colErr } = await supabase
        .from('order_items')
        .select('*')
        .limit(1);
    
    console.log('order_items columns:', cols ? Object.keys(cols[0] || {}) : colErr);
}

run();
