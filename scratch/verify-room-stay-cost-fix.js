const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function calculateNights(checkIn, checkOut) {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);
    const diffMs = outDate.getTime() - inDate.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

async function computeFolioTotal(restaurantId, bookingId, roomId, checkIn, checkOut) {
    // Fetch partner restaurant/hotel if linked
    const { data: currentRest } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id, linked_hotel_id')
        .eq('id', restaurantId)
        .maybeSingle();

    const hotelId = currentRest?.linked_hotel_id || restaurantId;
    const partnerRestaurantId = currentRest?.linked_restaurant_id || currentRest?.linked_hotel_id;
    
    let linkAllowFolioCharges = true;
    if (currentRest?.linked_restaurant_id) {
        const { data: colCheck } = await supabase
            .from('restaurants')
            .select('link_allow_folio_charges')
            .eq('id', restaurantId)
            .maybeSingle();
        if (colCheck && colCheck.link_allow_folio_charges === false) {
            linkAllowFolioCharges = false;
        }
    } else if (currentRest?.linked_hotel_id) {
        const { data: colCheck } = await supabase
            .from('restaurants')
            .select('link_allow_folio_charges')
            .eq('id', currentRest.linked_hotel_id)
            .maybeSingle();
        if (colCheck && colCheck.link_allow_folio_charges === false) {
            linkAllowFolioCharges = false;
        }
    }
    
    const targetRestaurantIds = [restaurantId];
    if (partnerRestaurantId && linkAllowFolioCharges) {
        targetRestaurantIds.push(partnerRestaurantId);
    }

    // Fetch dynamic pricing rules, total rooms, and checked-in bookings count
    const [roomRes, bookingsCountRes, roomsCountRes, rulesRes] = await Promise.all([
        supabase
            .from('rooms')
            .select('room_types:type_id(base_price)')
            .eq('id', roomId)
            .eq('restaurant_id', hotelId)
            .maybeSingle(),
        supabase
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('restaurant_id', hotelId)
            .eq('status', 'checked_in'),
        supabase
            .from('rooms')
            .select('*', { count: 'exact', head: true })
            .eq('restaurant_id', hotelId)
            .eq('is_active', true),
        supabase
            .from('dynamic_pricing_rules')
            .select('*')
            .eq('restaurant_id', hotelId)
            .eq('is_active', true)
    ]);

    const basePrice = Number(roomRes.data?.room_types?.base_price) || 0;
    const nights = calculateNights(checkIn, checkOut);
    
    const totalRoomsCount = roomsCountRes.count || 1;
    const activeBookingsCount = bookingsCountRes.count || 0;
    const occupancyPct = (activeBookingsCount / totalRoomsCount) * 100;

    let stayCost = 0;
    const start = new Date(checkIn);
    const pricingRules = rulesRes.data || [];

    if (nights > 0) {
        for (let i = 0; i < nights; i++) {
            const nightDate = new Date(start);
            nightDate.setDate(start.getDate() + i);
            
            let nightMultiplier = 1.0;
            
            // Apply weekend rules
            const weekendRule = pricingRules.find(r => r.rule_type === 'weekend');
            if (weekendRule && (nightDate.getDay() === 5 || nightDate.getDay() === 6)) {
                nightMultiplier *= Number(weekendRule.multiplier);
            }
            
            // Apply occupancy rules
            const occupancyRule = pricingRules.find(r => 
                r.rule_type === 'occupancy' && 
                occupancyPct >= Number(r.occupancy_threshold_pct || 0)
            );
            if (occupancyRule) {
                nightMultiplier *= Number(occupancyRule.multiplier);
            }
            
            stayCost += basePrice * nightMultiplier;
        }
    }

    return {
        hotelId,
        basePrice,
        nights,
        stayCost,
        targetRestaurantIds
    };
}

async function run() {
    console.log('Finding a checked-in booking to verify...');
    const { data: booking, error: bErr } = await supabase
        .from('bookings')
        .select('*, rooms(*, room_types(*))')
        .eq('status', 'checked_in')
        .limit(1)
        .maybeSingle();

    if (bErr || !booking) {
        console.error('Error or no checked-in bookings found:', bErr);
        return;
    }

    console.log(`Found active booking: Guest: ${booking.guest_name}, Room Number: ${booking.rooms?.room_number}`);
    console.log(`Room Base Price in DB: ${booking.rooms?.room_types?.base_price}`);
    console.log(`Booking's Hotel Restaurant ID: ${booking.restaurant_id}`);

    // Fetch the linked restaurant of this Hotel
    const { data: hotelRest } = await supabase
        .from('restaurants')
        .select('linked_restaurant_id')
        .eq('id', booking.restaurant_id)
        .single();
    
    const linkedRestaurantId = hotelRest?.linked_restaurant_id;
    if (!linkedRestaurantId) {
        console.log('No partner restaurant linked to this hotel. Cannot test cross-tenant query.');
        return;
    }
    console.log(`Linked Partner Restaurant ID: ${linkedRestaurantId}`);

    console.log('\n--- Scenario 1: computeFolioTotal using HOTEL ID ---');
    try {
        const folioHotel = await computeFolioTotal(
            booking.restaurant_id,
            booking.id,
            booking.room_id,
            booking.check_in,
            booking.check_out
        );
        console.log('Result:', folioHotel);
    } catch (err) {
        console.error('Scenario 1 failed:', err);
    }

    console.log('\n--- Scenario 2: computeFolioTotal using RESTAURANT ID ---');
    try {
        const folioRest = await computeFolioTotal(
            linkedRestaurantId,
            booking.id,
            booking.room_id,
            booking.check_in,
            booking.check_out
        );
        console.log('Result:', folioRest);
        if (folioRest.stayCost > 0) {
            console.log('\nSUCCESS: Room Stay Cost correctly resolved as > 0 even when using Restaurant ID!');
        } else {
            console.log('\nFAILURE: Room Stay Cost resolved as 0 under Restaurant ID context.');
        }
    } catch (err) {
        console.error('Scenario 2 failed:', err);
    }
}

run();
