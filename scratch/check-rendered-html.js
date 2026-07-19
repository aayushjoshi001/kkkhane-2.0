const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
    console.log('Logging in as waiter...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'waiter@srms.app',
        password: 'Password123!'
    });

    if (error || !data.session) {
        console.error('Login failed:', error);
        return;
    }

    const { access_token, refresh_token } = data.session;
    const cookieValue = encodeURIComponent(JSON.stringify({
        access_token,
        refresh_token,
        token_type: 'bearer',
        expires_in: 3600
    }));
    const cookieHeader = `sb-wwvuflbzacromudviaab-auth-token=${cookieValue}`;

    try {
        console.log('Fetching /waiter...');
        const res = await fetch('http://localhost:3000/waiter', {
            headers: { Cookie: cookieHeader }
        });
        const html = await res.text();
        
        console.log('\nHTML search results:');
        const hasAutoOpen = html.includes('Opening session automatically');
        const hasManualOpen = html.includes('Open a new guest session for this table');
        
        console.log(`Contains "Opening session automatically...": ${hasAutoOpen}`);
        console.log(`Contains "Open a new guest session for this table": ${hasManualOpen}`);

        // If neither, maybe it rendered something else or failed. Let's log a snippet of the body.
        if (!hasAutoOpen && !hasManualOpen) {
            console.log('\nHTML snippet (first 1000 chars):');
            console.log(html.substring(0, 1000));
        }
    } catch (err) {
        console.error('Fetch failed:', err);
    }
}

run();
