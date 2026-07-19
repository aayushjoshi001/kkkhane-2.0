const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envPath = "d:/new work hotel/.env.local";
let supabaseUrl = '';
let supabaseServiceKey = '';

if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('NEXT_PUBLIC_SUPABASE_URL=')) {
            supabaseUrl = line.split('=')[1].trim().replace(/['"]/g, '');
        }
        if (line.trim().startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
            supabaseServiceKey = line.split('=')[1].trim().replace(/['"]/g, '');
        }
    }
}

const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function main() {
    const { data, error } = await adminSupabase.rpc('get_function_definition', { function_name: 'place_order' });
    if (error) {
        // Let's run a raw query using an existing RPC or inspect pg_proc
        console.log('Error calling get_function_definition:', error);
        // Let's try to query pg_proc directly using a custom query if we can
    } else {
        console.log('Definition:', data);
    }
}
main().catch(console.error);
