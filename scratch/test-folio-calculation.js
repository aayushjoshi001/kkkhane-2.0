const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Import computeFolioTotal
const { computeFolioTotal } = require('../src/lib/folio');

async function run() {
    const bookingId = '9aca1135-9048-4596-9ec2-24a461f65ceb'; // aayush
    const bookingRes = await supabase
        .from('bookings')
        .select('*, rooms(*)')
        .eq('id', bookingId)
        .single();
    
    if (bookingRes.error) {
        console.error(bookingRes.error);
        return;
    }

    const booking = bookingRes.data;

    // Simulate folio computation
    const folio = await computeFolioTotal(supabase, {
        restaurantId: booking.restaurant_id,
        bookingId: booking.id,
        roomId: booking.room_id,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        sessionId: null,
        discountAmount: Number(booking.discount_amount) || 0,
    });

    console.log('Folio Breakdown:');
    console.log(`Guest Name: ${booking.guest_name}`);
    console.log(`Room Stay Cost: ${folio.stayCost}`);
    console.log(`Orders Total: ${folio.ordersTotal}`);
    console.log(`Room Charges Total: ${folio.roomChargesTotal}`);
    console.log(`Discount: ${folio.discountAmount}`);
    console.log(`Grand Total: ${folio.total}`);
}

run().catch(console.error);
