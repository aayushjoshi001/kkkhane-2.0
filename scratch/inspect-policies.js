const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    const { data: policies, error } = await supabase.rpc('inspect_rls_policies', {});
    
    if (error) {
        // RPC might not exist, query pg_policies catalog using raw SQL query (if we can call a function or write one)
        // Let's run a raw query using a probe script since we have pg-client in devDependencies!
        // Wait, package.json had "pg" in devDependencies. Let's see if we can use it, or use supabase.rpc.
        // Actually, we can create a temporary sql function to query pg_policies.
        console.error('RPC inspect_rls_policies failed, let us try using postgres rpc if available. Error:', error);
    } else {
        console.log('Policies:', policies);
    }
}

// Let's write a pg direct query instead since we have pg in devDependencies!
const { Client } = require('pg');
async function runPg() {
    const connectionString = process.env.DATABASE_URL; // Let's check if DATABASE_URL is in .env.local
    if (!connectionString) {
        console.log('No DATABASE_URL in env, let us look at .env.local');
        return;
    }
    const client = new Client({ connectionString });
    await client.connect();
    const res = await client.query(`
        SELECT tablename, policyname, cmd, qual, with_check 
        FROM pg_policies 
        WHERE tablename IN ('orders', 'sessions')
    `);
    console.log('RLS Policies for orders & sessions:');
    res.rows.forEach(r => {
        console.log(`Table: ${r.tablename}`);
        console.log(`  Name: ${r.policyname}`);
        console.log(`  Cmd: ${r.cmd}`);
        console.log(`  Qual: ${r.qual}`);
        console.log(`  With Check: ${r.with_check}`);
        console.log('---');
    });
    await client.end();
}

runPg().catch(console.error);
