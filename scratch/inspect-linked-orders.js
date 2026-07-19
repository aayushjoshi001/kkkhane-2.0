const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // 1. Get all sessions with booking_id
    const { data: sessions } = await supabase.from('sessions').select('*, tables(label)').not('booking_id', 'is', null);
    console.log('Sessions with booking_id:', sessions.map(s => ({
        id: s.id,
        table_label: s.tables?.label,
        status: s.status,
        booking_id: s.booking_id
    })));

    // 2. Get all orders with booking_id
    const { data: orders } = await supabase.from('orders').select('*, tables:session_id(tables(label))').not('booking_id', 'is', null);
    console.log('Orders with booking_id:', orders.map(o => ({
        id: o.id,
        status: o.status,
        payment_status: o.payment_status,
        total_amount: o.total_amount,
        booking_id: o.booking_id
    })));

    // 3. Show all unpaid/active orders in the database
    const { data: unpaidOrders } = await supabase.from('orders').select('*, sessions(id, booking_id, tables(label))').neq('payment_status', 'paid');
    console.log('Unpaid/Active orders:', unpaidOrders.map(o => ({
        id: o.id,
        status: o.status,
        payment_status: o.payment_status,
        total_amount: o.total_amount,
        session_id: o.session_id,
        session_booking_id: o.sessions?.booking_id,
        table_label: o.sessions?.tables?.label
    })));
}

run();
