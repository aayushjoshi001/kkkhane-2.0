// Verifies the cashier page's seat-aware queries against the live DB:
// 1. orders -> sessions(seat_number) embed is accepted by PostgREST
// 2. sessions select with seat_number works and the per-table grouping
//    (activeSession = seat 1, otherActiveSessions = rest) behaves.
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Same select as cashier/page.tsx unpaid orders
    const { data: unpaid, error: e1 } = await supabase
        .from('orders')
        .select(`
            id, total_amount, delivered_at, payment_status, payment_method, session_id, booking_id,
            sessions ( id, booking_id, seat_number, tables ( id, label ) ),
            order_items ( quantity, unit_price, menu_items ( name ) )
        `)
        .eq('status', 'delivered')
        .eq('payment_status', 'unpaid')
        .limit(5);
    console.log('unpaid query error:', e1 ? e1.message : 'none');
    for (const o of unpaid || []) {
        console.log('  order', o.id.slice(0, 8), '→ table', o.sessions?.tables?.label, 'seat', o.sessions?.seat_number);
    }

    // Same select as cashier/page.tsx sessions
    const { data: sessions, error: e2 } = await supabase
        .from('sessions')
        .select('id, table_id, restaurant_id, status, opened_at, session_token, booking_id, seat_number')
        .eq('status', 'active')
        .order('seat_number', { ascending: true })
        .limit(20);
    console.log('sessions query error:', e2 ? e2.message : 'none');

    const byTable = {};
    for (const s of sessions || []) (byTable[s.table_id] ??= []).push(s);
    for (const [tableId, list] of Object.entries(byTable)) {
        const primary = list.find(s => s.seat_number === 1) || list[0] || null;
        const others = list.filter(s => s.id !== primary?.id);
        console.log('  table', tableId.slice(0, 8), '→ primary seat', primary?.seat_number, '| other seats:', others.map(s => s.seat_number).join(',') || '(none)');
    }
}

run().catch(e => { console.error(e); process.exit(1); });
