const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = "d:/new work hotel/.env.local";
let supabaseUrl = '';
let supabaseServiceKey = '';

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
            supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (line.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
            supabaseServiceKey = line.split('=')[1].trim().replace(/['"]/g, '');
        }
    }
}

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

// Import placeRoomOrderDirect. Note that Server Actions require environment and cookies,
// so let's mock/simulate placeRoomOrderDirect's database operations or run it if possible.
// Wait, we can copy the placeRoomOrderDirect code and run it directly to see where it throws an error!

async function testPlaceRoomOrderDirect(bookingId, items, customerNote, restaurantId) {
    console.log('Starting testPlaceRoomOrderDirect...');
    
    // 1. Fetch booking to make sure it's active
    const { data: booking, error: bookingErr } = await adminSupabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single();

    if (bookingErr || !booking || booking.status !== 'checked_in') {
        console.log('Booking validation failed:', bookingErr, booking);
        return { error: 'Room stay booking is invalid or checked out.' };
    }

    // 2. Create pending order row
    const { data: orderRow, error: orderInsertError } = await adminSupabase
        .from('orders')
        .insert({
            restaurant_id: restaurantId,
            booking_id: bookingId,
            customer_note: customerNote || null,
            status: 'confirmed',
            needs_confirmation: false,
            payment_status: 'unpaid',
            order_type: 'takeout'
        })
        .select('id')
        .single();

    if (orderInsertError || !orderRow?.id) {
        console.error('[placeRoomOrderDirect] Order insert failed:', orderInsertError);
        return { error: 'Failed to create order.' };
    }

    const orderId = orderRow.id;
    console.log('Order created successfully. Order ID:', orderId);
    let subtotal = 0;

    // 3. Insert order items
    for (const item of items) {
        const { data: menuItem } = await adminSupabase
            .from('menu_items')
            .select('id, price, is_available')
            .eq('id', item.menuItemId)
            .single();

        if (!menuItem?.id || menuItem.is_available === false) {
            console.log('Menu item lookup failed/unavailable for:', item.menuItemId);
            continue;
        }

        let unitPrice = Number(menuItem.price ?? 0);
        let variationId = null;
        if (item.variationId) {
            const { data: variation } = await adminSupabase
                .from('menu_item_variations')
                .select('id, price')
                .eq('id', item.variationId)
                .single();
            if (variation) {
                unitPrice = Number(variation.price);
                variationId = variation.id;
            }
        }

        const specialRequest = item.specialRequest || null;

        const { data: orderItemRow, error: orderItemInsertError } = await adminSupabase
            .from('order_items')
            .insert({
                order_id: orderId,
                menu_item_id: menuItem.id,
                menu_item_variation_id: variationId,
                quantity: item.quantity,
                unit_price: unitPrice,
                special_request: specialRequest,
                status: 'pending'
            })
            .select('id')
            .single();

        if (orderItemInsertError || !orderItemRow?.id) {
            console.error('[placeRoomOrderDirect] Item insert failed:', orderItemInsertError);
            continue;
        }

        let itemTotal = unitPrice * item.quantity;

        // Handle modifiers if any
        if (item.modifiers?.length) {
            for (const mod of item.modifiers) {
                const { data: modRow } = await adminSupabase
                    .from('menu_item_modifiers')
                    .select('id, name, price_adjustment')
                    .eq('id', mod.modifierId || mod.id)
                    .single();

                if (!modRow?.id) continue;

                await adminSupabase.from('order_item_modifiers').insert({
                    order_item_id: orderItemRow.id,
                    modifier_id: modRow.id,
                    modifier_name: modRow.name,
                    price_adjustment: modRow.price_adjustment,
                });

                itemTotal += Number(modRow.price_adjustment ?? 0) * item.quantity;
            }
        }

        subtotal += itemTotal;
    }

    // 4. Calculate Taxes and Service Charge
    const { data: settings } = await adminSupabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single();
    
    const featuresV2 = settings?.features_v2 || {};
    const taxRate = Number(featuresV2?.defaultTaxRate ?? 0);
    const scEnabled = featuresV2?.serviceChargeEnabled === true;
    const scRate = Number(featuresV2?.serviceChargeRate ?? 10);

    const serviceCharge = scEnabled 
        ? Math.round(subtotal * (scRate / 100) * 100) / 100 
        : 0;

    const tax = Math.round((subtotal + serviceCharge) * (taxRate / 100) * 100) / 100;
    const total = Math.max(0, subtotal + serviceCharge + tax);

    console.log('Subtotal:', subtotal, 'Tax:', tax, 'Total:', total);

    // Update totals on order
    const { error: updateError } = await adminSupabase
        .from('orders')
        .update({
            subtotal_amount: subtotal,
            service_charge_amount: serviceCharge,
            tax_amount: tax,
            total_amount: total
        })
        .eq('id', orderId);

    if (updateError) {
        console.error('Update totals failed:', updateError);
    } else {
        console.log('Update totals succeeded.');
    }

    // Apply pricing rules & deduct ingredients
    await Promise.allSettled([
        adminSupabase.rpc('apply_pricing_rules_to_order', { p_order_id: orderId }),
        adminSupabase.rpc('deduct_ingredients_for_order',  { p_order_id: orderId }),
    ]);

    console.log('All done.');
    return { success: true, orderId };
}

async function run() {
    const bookingId = 'fe97cc57-4ca3-4875-a24a-38d4314664c2';
    const restaurantId = 'b9d6eb61-ea34-4372-96de-8683b93b0e42';

    // Get a valid menu item
    const { data: item } = await adminSupabase.from('menu_items').select('id').eq('is_available', true).limit(1).single();
    if (!item) {
        console.error('No menu items available!');
        return;
    }
    
    console.log('Using menu item:', item.id);
    const result = await testPlaceRoomOrderDirect(bookingId, [
        { menuItemId: item.id, quantity: 1, modifiers: [], specialRequest: '' }
    ], 'Test Room Note', restaurantId);
    console.log('Result:', result);
}

run().catch(console.error);
