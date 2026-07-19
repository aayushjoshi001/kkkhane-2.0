const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// Ported computeFolioTotal logic
async function computeFolioTotal(bookingId) {
    // 1. Get booking
    const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();
    
    const restaurantId = booking.restaurant_id;
    const roomId = booking.room_id;
    const checkIn = booking.check_in;
    const checkOut = booking.check_out;

    // Fetch partner restaurant if linked
    const { data: hotelData } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id, link_allow_folio_charges')
        .eq('id', restaurantId)
        .maybeSingle();
    
    const partnerRestaurantId = hotelData?.linked_restaurant_id;
    const targetRestaurantIds = [restaurantId];
    if (partnerRestaurantId && hotelData?.link_allow_folio_charges !== false) {
        targetRestaurantIds.push(partnerRestaurantId);
    }

    const { data: linkedSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('booking_id', bookingId);
    
    const sessionIds = new Set((linkedSessions || []).map((s) => s.id));

    const orderTotals = new Map();
    const addOrders = (rows) => {
        for (const o of rows || []) {
            const sum = (o.order_items || []).reduce(
                (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0);
            orderTotals.set(o.id, { id: o.id, total: sum, placedAt: o.placed_at });
        }
    };

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, placed_at, order_items(quantity, unit_price)')
        .in('restaurant_id', targetRestaurantIds)
        .eq('booking_id', bookingId)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid');
    addOrders(byBooking);

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, placed_at, order_items(quantity, unit_price)')
            .in('restaurant_id', targetRestaurantIds)
            .in('session_id', Array.from(sessionIds))
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid');
        addOrders(bySession);
    }

    const orders = Array.from(orderTotals.values());
    const ordersTotal = orders.reduce((s, o) => s + o.total, 0);

    return {
        guest_name: booking.guest_name,
        targetRestaurantIds,
        sessionIds: Array.from(sessionIds),
        orders,
        ordersTotal
    };
}

async function run() {
    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, guest_name, status')
        .eq('status', 'checked_in');

    console.log('Active checked-in bookings:');
    for (const b of bookings || []) {
        const res = await computeFolioTotal(b.id);
        console.log(`Guest: ${res.guest_name} (ID: ${b.id})`);
        console.log(`  Target Restaurants:`, res.targetRestaurantIds);
        console.log(`  Linked Sessions:`, res.sessionIds);
        console.log(`  Orders:`, res.orders);
        console.log(`  Orders Total:`, res.ordersTotal);
        console.log('---');
    }
}

run();
