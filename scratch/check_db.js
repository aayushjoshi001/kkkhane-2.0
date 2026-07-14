const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd());
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    try {
        console.log('Testing if exec_sql RPC exists...');
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: 'SELECT 1' });
        console.log('exec_sql response:', { data, error });
        
        console.log('Testing if run_sql RPC exists...');
        const { data: data2, error: error2 } = await supabase.rpc('run_sql', { sql: 'SELECT 1' });
        console.log('run_sql response:', { data: data2, error: error2 });
    } catch (e) {
        console.error('Error running test:', e);
    }
}
check();
