// Read-only: list every relation named "tables" across all schemas, and its columns,
// to check for a schema/search_path collision that could explain why plain filters
// succeed but the .or() filter in markTableClean() throws 42703.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
    // Use PostgREST's OpenAPI root doc — it lists the exposed schema's relations/columns
    // as PostgREST currently sees them (i.e. its live schema cache).
    const res = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', {
        headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
    });
    const json = await res.json();
    const tablesDef = json?.definitions?.tables;
    console.log('PostgREST schema-cache columns for "tables":', tablesDef ? Object.keys(tablesDef.properties || {}) : 'NOT FOUND');
    console.log('Has cleaning_claimed_by in cache:', !!tablesDef?.properties?.cleaning_claimed_by);
    console.log('Has cleaning_claimed_at in cache:', !!tablesDef?.properties?.cleaning_claimed_at);
}

run().catch(console.error);
