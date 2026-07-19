const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    // Let's link session 19e26919-9cb6-434a-a821-596097a6747d to booking 9aca1135-9048-4596-9ec2-24a461f65ceb
    const { error } = await supabase
        .from('sessions')
        .update({ booking_id: '9aca1135-9048-4596-9ec2-24a461f65ceb' })
        .eq('id', '19e26919-9cb6-434a-a821-596097a6747d');

    if (error) {
        console.error(error);
        return;
    }
    console.log('Linked successfully!');
}

run();
