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
    const { data, error } = await adminSupabase.rpc('apply_pricing_rules_to_order', { p_order_id: '94152c3f-48b3-462f-81a1-3be06b9c4284' });
    console.log('Test apply_pricing_rules:', data, error);
}
main().catch(console.error);
