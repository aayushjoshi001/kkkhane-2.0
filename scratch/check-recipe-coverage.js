const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data: menuItems } = await supabase
        .from('menu_items')
        .select('id, name, is_combo, stock_count')
        .eq('is_available', true);

    const { data: variations } = await supabase
        .from('menu_item_variations')
        .select('id, menu_item_id, name');

    const { data: recipes } = await supabase
        .from('recipes')
        .select('menu_item_id, menu_item_variation_id');

    const { data: comboItems } = await supabase
        .from('combo_items')
        .select('combo_id, item_id');

    const baseRecipeSet = new Set(recipes.filter(r => r.menu_item_id).map(r => r.menu_item_id));
    const varRecipeSet = new Set(recipes.filter(r => r.menu_item_variation_id).map(r => r.menu_item_variation_id));
    const comboIds = new Set(comboItems.map(c => c.combo_id));

    console.log(`Total menu items: ${menuItems.length}, variations: ${variations.length}, recipe rows: ${recipes.length}`);
    console.log('\n=== Variations with NO recipe coverage (no direct recipe, no base fallback) ===');
    let missing = 0;
    for (const v of variations) {
        const hasDirect = varRecipeSet.has(v.id);
        const hasFallback = baseRecipeSet.has(v.menu_item_id);
        if (!hasDirect && !hasFallback) {
            const item = menuItems.find(m => m.id === v.menu_item_id);
            console.log(`  MISSING: "${item?.name || v.menu_item_id}" -> variation "${v.name}" (${v.id})`);
            missing++;
        }
    }
    console.log(`Total variations missing recipe coverage: ${missing}`);

    console.log('\n=== Non-combo, non-variation menu items with NO recipe AND NO stock_count (nothing to deduct at all) ===');
    let noStockTracking = 0;
    for (const m of menuItems) {
        if (m.is_combo || comboIds.has(m.id)) continue;
        const hasVariations = variations.some(v => v.menu_item_id === m.id);
        if (hasVariations) continue;
        const hasRecipe = baseRecipeSet.has(m.id);
        if (!hasRecipe && m.stock_count === null) {
            console.log(`  NO TRACKING: "${m.name}" (${m.id}) - no recipe, no stock_count`);
            noStockTracking++;
        }
    }
    console.log(`Total items with zero stock tracking: ${noStockTracking}`);

    console.log('\n=== Combo items missing recipes for constituent parts ===');
    for (const c of comboItems) {
        const hasRecipe = baseRecipeSet.has(c.item_id);
        const constituent = menuItems.find(m => m.id === c.item_id);
        if (!hasRecipe && constituent?.stock_count === null) {
            const combo = menuItems.find(m => m.id === c.combo_id);
            console.log(`  MISSING: combo "${combo?.name}" -> part "${constituent?.name}" has no recipe and no stock_count`);
        }
    }
}

run().catch(console.error);
