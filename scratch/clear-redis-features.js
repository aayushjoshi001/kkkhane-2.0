const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// We can import redis from our redis client or just clear it using our env


async function run() {
    console.log('Connecting to Redis...');
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    try {
        console.log('Fetching all keys from settings table to clear...');
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: settings } = await supabase.from('settings').select('restaurant_id');

        for (const s of settings || []) {
            const key = `features:${s.restaurant_id}`;
            console.log(`Deleting Redis key: ${key}`);
            await redis.del(key);
            const modeKey = `mode:${s.restaurant_id}`;
            console.log(`Deleting Redis key: ${modeKey}`);
            await redis.del(modeKey);
        }
        console.log('Redis features cache cleared successfully!');
    } catch (e) {
        console.error('Failed to clear Redis:', e);
    }
}

run();
