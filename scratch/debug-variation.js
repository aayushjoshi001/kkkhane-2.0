const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    console.log('=== CHECK 1: Does order_items table have menu_item_variation_id column? ===');
    const { data: cols, error: colErr } = await supabase
        .from('order_items')
        .select('*')
        .limit(1);
    if (colErr) {
        console.error('Error fetching order_items:', colErr);
    } else {
        console.log('Columns present in order_items:', cols ? Object.keys(cols[0] || {}) : 'No rows');
    }

    console.log('\n=== CHECK 2: Latest order_items with variation_id ===');
    const { data: latestOrders, error: latestErr } = await supabase
        .from('orders')
        .select('id, placed_at, status')
        .order('placed_at', { ascending: false })
        .limit(3);

    for (const order of (latestOrders || [])) {
        const { data: items } = await supabase
            .from('order_items')
            .select('id, menu_item_id, menu_item_variation_id, quantity, special_request, unit_price')
            .eq('order_id', order.id);
        console.log(`\nOrder ${order.id} (${order.status}):`);
        items?.forEach(i => {
            console.log(`  item: ${i.id}, menu_item: ${i.menu_item_id}, variation: ${i.menu_item_variation_id}, qty: ${i.quantity}, req: ${i.special_request}`);
        });
    }

    console.log('\n=== CHECK 3: Recipes for Old Durbar (menu_item_id = 331127bf-5f4f-45b3-80e8-eaf1ac350283) ===');
    const { data: recipes, error: recErr } = await supabase
        .from('recipes')
        .select('*')
        .or('menu_item_id.eq.331127bf-5f4f-45b3-80e8-eaf1ac350283,menu_item_variation_id.eq.656bf84d-4813-4fd7-9692-400faf2688b7');
    if (recErr) {
        console.error('Recipe error:', recErr);
    } else {
        console.log('Recipes:', JSON.stringify(recipes, null, 2));
    }

    console.log('\n=== CHECK 4: Variations for Old Durbar ===');
    const { data: variations } = await supabase
        .from('menu_item_variations')
        .select('*')
        .eq('menu_item_id', '331127bf-5f4f-45b3-80e8-eaf1ac350283');
    console.log('Variations:', JSON.stringify(variations, null, 2));

    console.log('\n=== CHECK 5: ingredient_movements for latest orders ===');
    for (const order of (latestOrders || [])) {
        const { data: movements } = await supabase
            .from('ingredient_movements')
            .select('*')
            .eq('reference_id', order.id);
        console.log(`\nMovements for order ${order.id}:`, movements?.length ? JSON.stringify(movements, null, 2) : 'NONE');
    }
}

run();
