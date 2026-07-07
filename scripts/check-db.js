const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://wwvuflbzacromudviaab.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3dnVmbGJ6YWNyb211ZHZpYWFiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTkyMzIxOSwiZXhwIjoyMDY3NDk5MjE5fQ.RR7vxnE1LFx6B8Up1tOF7yp4g5vhCzXi_8akjvkl0p8';

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    try {
        console.log('--- Fetching Room 101s ---');
        const { data: rooms, error: roomErr } = await supabase
            .from('rooms')
            .select('*')
            .eq('room_number', '101');
        if (roomErr) throw roomErr;
        console.log('Rooms:', rooms);

        for (const room of rooms) {
            console.log(`--- Fetching Bookings for Room ID ${room.id} (Restaurant: ${room.restaurant_id}) ---`);
            const { data: bookings, error: bookingsErr } = await supabase
                .from('bookings')
                .select('*')
                .eq('room_id', room.id)
                .order('created_at', { ascending: false });
            if (bookingsErr) throw bookingsErr;
            console.log('Bookings:', bookings.map(b => ({
                id: b.id,
                guest_name: b.guest_name,
                status: b.status,
                paid_amount: b.paid_amount,
                advance_payment_method: b.advance_payment_method,
                created_at: b.created_at
            })));
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

check();
