const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function main() {
    const { data: oneOrder, error: oneErr } = await adminSupabase
        .from('orders')
        .select('*')
        .limit(1);
    if (oneOrder && oneOrder.length > 0) {
        console.log('Sample order columns:', Object.keys(oneOrder[0]));
    } else {
        console.log('Error fetching sample order:', oneErr);
    }

    const { data: booking, error: bookingErr } = await adminSupabase
        .from('bookings')
        .select('id, status, restaurant_id')
        .eq('status', 'checked_in')
        .limit(1)
        .single();

    if (bookingErr || !booking) {
        console.log('No checked_in booking found for test:', bookingErr);
        return;
    }
    console.log('Found checked_in booking:', booking);

    const { data: orderRow, error: orderInsertError } = await adminSupabase
        .from('orders')
        .insert({
            restaurant_id: booking.restaurant_id,
            booking_id: booking.id,
            status: 'confirmed',
            needs_confirmation: false,
            payment_status: 'unpaid',
            order_type: 'takeout'
        })
        .select('*')
        .single();

    if (orderInsertError) {
        console.log('Test insert failed:', orderInsertError);
    } else {
        console.log('Test insert succeeded:', orderRow);
        await adminSupabase.from('orders').delete().eq('id', orderRow.id);
    }
}
main().catch(console.error);
