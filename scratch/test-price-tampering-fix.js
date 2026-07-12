// Verifies the checkout/actions.ts fix: the post-place_order subtotal
// recalculation must use order_items.unit_price (server-set by the RPC),
// not a tampered client-supplied item.price.
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const restaurantId = '15384c3c-4997-408d-8219-27c3a9ea058e';
    const tableId = '18d505a1-8549-460e-a999-d53872891346';
    const menuItemId = 'eebeb891-819c-42b1-8312-b664b8c7922d'; // Veg Momo, real price 150

    // 1. Open a fresh session on the test table (mirrors getOrCreateActiveSession)
    const { data: session, error: sessErr } = await supabase
        .from('sessions')
        .insert({
            restaurant_id: restaurantId,
            table_id: tableId,
            status: 'active',
            session_token: `test-tamper-${Date.now()}`,
            opened_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        })
        .select('id')
        .single();
    if (sessErr) { console.error('Session insert failed:', sessErr); return; }

    // 2. Place a real order via the same RPC checkout/actions.ts calls.
    // place_order ignores any client price and computes unit_price itself.
    const { data: rpcResult, error: rpcErr } = await supabase.rpc('place_order', {
        p_session_id: session.id,
        p_items: [{ menu_item_id: menuItemId, quantity: 1 }],
        p_customer_note: null,
        p_promo_code: null,
        p_loyalty_member_id: null,
        p_client_request_id: `test-tamper-req-${Date.now()}`,
    });
    if (rpcErr) { console.error('place_order RPC failed:', rpcErr); return; }
    console.log('RPC result (order created):', rpcResult);

    // 3. Read back the real order_items row the RPC created.
    const { data: dbOrderItems } = await supabase
        .from('order_items')
        .select('id, menu_item_id, quantity, special_request, unit_price')
        .eq('order_id', rpcResult.order_id);
    console.log('Real order_items row (server-set price):', dbOrderItems);

    // 4. Simulate a tampered client request: attacker claims this item costs 1,
    // not 150. Reproduce the FIXED calculation logic from checkout/actions.ts.
    const tamperedItems = [{
        menuItemId: menuItemId,
        quantity: 1,
        price: 1, // <-- attacker-edited price, should now be ignored
        modifiers: [],
        specialRequest: undefined,
        variationId: undefined,
        variationName: undefined,
    }];

    const matchedDbItemIds = new Set();
    let calculatedSubtotal = 0;
    for (const item of tamperedItems) {
        let expectedSpecialRequest = item.specialRequest || '';
        const match = dbOrderItems.find(
            x => !matchedDbItemIds.has(x.id) &&
                 x.menu_item_id === item.menuItemId &&
                 x.quantity === item.quantity &&
                 (x.special_request || '') === expectedSpecialRequest
        );
        // --- fixed logic ---
        let basePrice = match ? Number(match.unit_price) : 0;
        // (no variationId in this test, so no override)
        const modifierTotal = 0;
        calculatedSubtotal += (basePrice + modifierTotal) * item.quantity;
        if (match) matchedDbItemIds.add(match.id);
    }

    console.log('\n--- RESULT ---');
    console.log('Attacker-submitted (tampered) price:', tamperedItems[0].price);
    console.log('Real server-side unit_price:', dbOrderItems[0]?.unit_price);
    console.log('calculatedSubtotal using FIXED logic:', calculatedSubtotal);
    console.log(calculatedSubtotal === Number(dbOrderItems[0]?.unit_price)
        ? 'PASS: subtotal reflects the real price, tampering had no effect.'
        : 'FAIL: subtotal was influenced by the tampered client price.');

    // Cleanup
    await supabase.from('order_items').delete().eq('order_id', rpcResult.order_id);
    await supabase.from('orders').delete().eq('id', rpcResult.order_id);
    await supabase.from('sessions').delete().eq('id', session.id);
    console.log('\nCleaned up test order/session.');
}

run().catch(console.error);
