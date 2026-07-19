const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: users } = await supabase
        .from('users')
        .select('phone, full_name, role, is_active')
        .limit(10);
    
    console.log('Available users:');
    console.log(users);
}

run();
