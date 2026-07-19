const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    const { data: variations, error } = await supabase
        .from('menu_item_variations')
        .select('*')
        .eq('menu_item_id', '331127bf-5f4f-45b3-80e8-eaf1ac350283');

    console.log('Variations for Item:', variations || error);
}

run();
