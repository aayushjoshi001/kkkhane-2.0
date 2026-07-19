const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Let's find an active session to test with
    const { data: sessions, error: sessErr } = await supabase
        .from('sessions')
        .select('id, restaurant_id')
        .eq('status', 'active')
        .limit(1);

    if (sessErr || !sessions || sessions.length === 0) {
        console.error('No active sessions to test with:', sessErr);
        return;
    }
    const session = sessions[0];
    console.log('Using active session:', session);

    // Let's call the RPC place_order directly
    const testItems = [
        {
            menu_item_id: '331127bf-5f4f-45b3-80e8-eaf1ac350283', // Old durbar
            quantity: 1,
            special_request: '[Glass]',
            modifiers: [],
            variation_id: '656bf84d-4813-4fd7-9692-400faf2688b7', // Glass variation
        }
    ];

    const { data, error } = await supabase.rpc('place_order', {
        p_session_id: session.id,
        p_items: testItems,
        p_customer_note: 'Test RPC',
        p_promo_code: null,
        p_loyalty_member_id: null,
        p_client_request_id: 'test-rpc-unique-' + Date.now()
    });

    console.log('RPC result:', { data, error });
}

run();
