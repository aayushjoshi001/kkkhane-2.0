const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: r } = await admin.from('restaurants').select('id, name').eq('slug', 'demo-grand-hotel').single();
    const { data: rooms } = await admin.from('rooms')
        .select('room_number, floor, status')
        .eq('restaurant_id', r.id)
        .order('room_number');
    console.log(r.name, '->', rooms.map(x => `${x.room_number} (floor ${x.floor}, ${x.status})`).join(', '));
}
run();
