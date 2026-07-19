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
    console.log('Login successful! Triggering render on http://localhost:3000/waiter...');

    // Next.js Supabase middleware reads cookies of name:
    // "sb-access-token" and "sb-refresh-token"
    const cookieHeader = `sb-access-token=${access_token}; sb-refresh-token=${refresh_token}`;

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
