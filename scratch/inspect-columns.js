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
    const { data: cols, error: colsErr } = await adminSupabase
        .rpc('probe_table_columns', { table_name: 'orders' });
    
    if (colsErr) {
        // Let's run a raw sql query via RPC if possible
        const { data: schemaCols, error: schemaErr } = await adminSupabase
            .from('orders')
            .select('*')
            .limit(1);
        console.log('Sample row:', schemaCols);
    } else {
        console.log('Columns:', cols);
    }
}
main().catch(console.error);
