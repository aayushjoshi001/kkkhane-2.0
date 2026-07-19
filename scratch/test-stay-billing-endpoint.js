const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('Missing env vars');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function getActiveBookingForRoom(admin, roomId) {
    const { data } = await admin
        .from('bookings')
        .select('id, guest_name')
        .eq('room_id', roomId)
        .eq('status', 'checked_in')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    return data ?? null
}

async function getRoomContextForTable(admin, tableId) {
    const { data: table } = await admin
        .from('tables')
        .select('room_id, rooms:room_id(id, room_number)')
        .eq('id', tableId)
        .maybeSingle()

    if (!table?.room_id) return null

    const room = table.rooms
    const booking = await getActiveBookingForRoom(admin, table.room_id)

    return {
        roomId: table.room_id,
        roomNumber: room?.room_number ?? '',
        bookingId: booking?.id ?? null,
        guestName: booking?.guest_name ?? null,
    }
}

async function run() {
    const tableSlugs = [
        'RAGX9E7Mdws7ibwokWX3Lm_b',
        'nhKWVmqjk7lm5Z-lSOiaR_52'
    ];

    for (const tableSlug of tableSlugs) {
        console.log('\n--- Testing slug:', tableSlug);

        const { data: tableData } = await supabase
            .from('tables')
            .select('id, room_id')
            .eq('qr_token', tableSlug)
            .single();

        if (!tableData) {
            console.log('Table not found');
            continue;
        }
        console.log('TableData:', tableData);

        const roomContext = await getRoomContextForTable(supabase, tableData.id);
        console.log('RoomContext:', roomContext);
    }
}

run();
