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
    console.log('Login successful! Constructing cookie...');

    const tokenData = {
        access_token,
        refresh_token,
        token_type: 'bearer',
        expires_in: 3600
    };
    const cookieValue = encodeURIComponent(JSON.stringify(tokenData));
    const cookieHeader = `sb-wwvuflbzacromudviaab-auth-token=${cookieValue}`;

    try {
        const res = await fetch('http://localhost:3000/waiter', {
            headers: {
                Cookie: cookieHeader
            }
        });
        console.log(`Fetch response status: ${res.status}`);
        const body = await res.text();
        console.log('Fetch completed. Check the dev server console logs!');
    } catch (err) {
        console.error('Fetch failed:', err);
    }
}

run();
