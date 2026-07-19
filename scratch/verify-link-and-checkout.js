const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function getStayExpiry(bookingId) {
    const { data } = await supabase
        .from('bookings')
        .select('check_out')
        .eq('id', bookingId)
        .maybeSingle();
    return data?.check_out || null;
}

// Simulating linkInHouseGuest logic (as modified)
async function linkInHouseGuest(sessionToken, phoneNumber) {
    const { data: session } = await supabase
        .from('sessions')
        .select('id, restaurant_id, booking_id')
        .eq('session_token', sessionToken)
        .eq('status', 'active')
        .maybeSingle();

    if (!session) {
        return { error: 'Your table session has expired.' };
    }
    if (session.booking_id) {
        return { error: 'This table is already linked to a room.' };
    }

    const cleanVal = (val) => val.replace(/\D/g, '');
    const normalizedInput = cleanVal(phoneNumber);
    if (!normalizedInput) {
        return { error: 'Please enter a valid phone number.' };
    }

    // Resolve linked hotel if any
    const { data: restLink } = await supabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', session.restaurant_id)
        .maybeSingle();

    const targetRestaurantId = restLink?.linked_hotel_id || session.restaurant_id;

    const { data: bookings } = await supabase
        .from('bookings')
        .select('id, guest_name, guest_phone')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in')
        .order('created_at', { ascending: false });

    const booking = (bookings || []).find(b => cleanVal(b.guest_phone || '') === normalizedInput);

    if (!booking) {
        return { error: 'No active stay found with that phone number.' };
    }

    const expiresAt = await getStayExpiry(booking.id);

    const { error: updateError } = await supabase
        .from('sessions')
        .update({ booking_id: booking.id, ...(expiresAt ? { expires_at: expiresAt } : {}) })
        .eq('id', session.id)
        .is('booking_id', null);

    if (updateError) {
        return { error: 'Failed to link table.' };
    }

    return { success: true, guestName: booking.guest_name, bookingId: booking.id };
}

// Simulating computeFolioTotal logic
async function computeFolioTotal(bookingId) {
    const { data: booking } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', bookingId)
        .single();
    
    const restaurantId = booking.restaurant_id;

    // Fetch partner restaurant if linked
    const { data: hotelData } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id')
        .eq('id', restaurantId)
        .maybeSingle();
    
    console.log('Hotel Data retrieved:', hotelData);

    const partnerRestaurantId = hotelData?.linked_restaurant_id;
    const targetRestaurantIds = [restaurantId];
    
    let linkAllowFolioCharges = true;
    if (partnerRestaurantId) {
        const { data: colCheck } = await supabase
            .from('restaurants')
            .select('link_allow_folio_charges')
            .eq('id', restaurantId)
            .maybeSingle();
        if (colCheck && colCheck.link_allow_folio_charges === false) {
            linkAllowFolioCharges = false;
        }
    }

    if (partnerRestaurantId && linkAllowFolioCharges) {
        targetRestaurantIds.push(partnerRestaurantId);
    }
    console.log('Resolved targetRestaurantIds:', targetRestaurantIds);

    const { data: linkedSessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('booking_id', bookingId);
    
    console.log('Linked sessions count:', linkedSessions?.length, linkedSessions);

    const sessionIds = new Set((linkedSessions || []).map((s) => s.id));
    console.log('sessionIds Set:', Array.from(sessionIds));

    const orderTotals = new Map();
    const addOrders = (rows, source) => {
        console.log(`Adding ${rows?.length || 0} orders from ${source}:`, rows);
        for (const o of rows || []) {
            const sum = (o.order_items || []).reduce(
                (s, it) => s + (Number(it.unit_price) || 0) * (Number(it.quantity) || 0), 0);
            orderTotals.set(o.id, { id: o.id, total: sum });
        }
    };

    const { data: byBooking } = await supabase
        .from('orders')
        .select('id, placed_at, order_items(quantity, unit_price)')
        .in('restaurant_id', targetRestaurantIds)
        .eq('booking_id', bookingId)
        .neq('status', 'cancelled')
        .neq('payment_status', 'paid');
    addOrders(byBooking, 'byBooking');

    if (sessionIds.size > 0) {
        const { data: bySession } = await supabase
            .from('orders')
            .select('id, placed_at, order_items(quantity, unit_price)')
            .in('restaurant_id', targetRestaurantIds)
            .in('session_id', Array.from(sessionIds))
            .neq('status', 'cancelled')
            .neq('payment_status', 'paid');
        addOrders(bySession, 'bySession');
    }

    const orders = Array.from(orderTotals.values());
    const ordersTotal = orders.reduce((s, o) => s + o.total, 0);

    return {
        orders,
        ordersTotal
    };
}

async function run() {
    const tableId = 'd3deb4de-5a55-4b12-868e-49284bea758e'; // T1
    const restaurantId = '4cd9c144-e32a-4b6d-aa4c-2f6de4ec1318'; // Demo Restaurant
    const token = 'test-token-' + Math.random().toString(36).substring(7);

    // 1. Create active session
    const { data: session, error: sessErr } = await supabase
        .from('sessions')
        .insert({
            table_id: tableId,
            restaurant_id: restaurantId,
            session_token: token,
            status: 'active',
            expires_at: new Date(Date.now() + 4 * 3600000).toISOString()
        })
        .select('*')
        .single();

    if (sessErr) {
        console.error('Session create failed:', sessErr);
        return;
    }
    console.log(`Created Active Session: ID=${session.id}, Token=${session.session_token}`);

    // Find a menu item of Demo Restaurant to place an order
    const { data: menuItem } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .limit(1)
        .single();

    console.log(`Found Menu Item: Name=${menuItem.name}, Price=${menuItem.price}`);

    // 2. Insert order
    const { data: order, error: ordErr } = await supabase
        .from('orders')
        .insert({
            session_id: session.id,
            restaurant_id: restaurantId,
            status: 'confirmed',
            payment_status: 'unpaid',
            total_amount: Number(menuItem.price)
        })
        .select('*')
        .single();

    if (ordErr) {
        console.error('Order create failed:', ordErr);
        return;
    }

    // Insert order item
    const { error: itemInsertErr } = await supabase.from('order_items').insert({
        order_id: order.id,
        menu_item_id: menuItem.id,
        quantity: 1,
        unit_price: Number(menuItem.price),
        status: 'pending'
    });
    if (itemInsertErr) {
        console.error('Order item insert failed:', itemInsertErr);
    }

    console.log(`Created Unpaid Order: ID=${order.id}, Amount=${menuItem.price}`);

    // 3. Link session to Anish Sharma (Phone: "9801000201")
    console.log('Linking table session via linkInHouseGuest...');
    const linkRes = await linkInHouseGuest(token, '9801000201');
    if (linkRes.error) {
        console.error('Link failed:', linkRes.error);
        return;
    }
    console.log(`Successfully linked to Guest: ${linkRes.guestName}`);

    // 4. Compute stay folio total for Anish Sharma (ID: fe97cc57-4ca3-4875-a24a-38d4314664c2)
    console.log('Computing folio for booking fe97cc57-4ca3-4875-a24a-38d4314664c2...');
    const folio = await computeFolioTotal(linkRes.bookingId);
    console.log(`Folio Orders Total: ${folio.ordersTotal}`);
    console.log(`Folio Orders Count: ${folio.orders.length}`);
    console.log('Folio Orders:', folio.orders);

    // Clean up/settle so we don't pollute database permanently
    console.log('Cleaning up: marking session closed and order paid...');
    await supabase.from('sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', session.id);
    await supabase.from('orders').update({ payment_status: 'paid' }).eq('id', order.id);
    console.log('Clean up done.');
}

run();
