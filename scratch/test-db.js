const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // 1. Get the latest order
    const { data: orders, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .order('placed_at', { ascending: false })
        .limit(1);

    if (orderErr) {
        console.error('Order error:', orderErr);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('No orders found');
        return;
    }

    const latestOrder = orders[0];
    console.log('--- LATEST ORDER ---');
    console.log('ID:', latestOrder.id);
    console.log('Created At:', latestOrder.created_at);

    // 2. Get order items for this order
    const { data: orderItems, error: itemErr } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', latestOrder.id);

    if (itemErr) {
        console.error('OrderItem error:', itemErr);
        return;
    }

    console.log('--- ORDER ITEMS ---');
    orderItems.forEach(item => {
        console.log(`Item ID: ${item.id}, MenuItem ID: ${item.menu_item_id}, Variation ID: ${item.menu_item_variation_id}, Qty: ${item.quantity}, Price: ${item.unit_price}, Req: ${item.special_request}`);
    });

    // 3. Get recipes for these menu items
    const menuItemIds = orderItems.map(i => i.menu_item_id);
    const { data: recipes, error: recipeErr } = await supabase
        .from('recipes')
        .select('*')
        .in('menu_item_id', menuItemIds);

    console.log('--- RECIPES BY MENU ITEM ---');
    recipes?.forEach(r => {
        console.log(`Recipe ID: ${r.id}, MenuItem ID: ${r.menu_item_id}, Variation ID: ${r.menu_item_variation_id}, Ingredient ID: ${r.ingredient_id}, Qty: ${r.quantity_needed}`);
    });

    // 4. Get recipes by variation ID if any
    const variationIds = orderItems.map(i => i.menu_item_variation_id).filter(Boolean);
    if (variationIds.length > 0) {
        const { data: varRecipes } = await supabase
            .from('recipes')
            .select('*')
            .in('menu_item_variation_id', variationIds);
            
        console.log('--- RECIPES BY VARIATION ---');
        varRecipes?.forEach(r => {
            console.log(`Recipe ID: ${r.id}, MenuItem ID: ${r.menu_item_id}, Variation ID: ${r.menu_item_variation_id}, Ingredient ID: ${r.ingredient_id}, Qty: ${r.quantity_needed}`);
        });
    }

    // 5. Get ingredient stock level
    const { data: ingredients } = await supabase
        .from('ingredients')
        .select('*');
    console.log('--- INGREDIENTS STOCK ---');
    ingredients?.forEach(i => {
        console.log(`Name: ${i.name}, Stock: ${i.stock_quantity} ${i.unit}`);
    });
}

run();
