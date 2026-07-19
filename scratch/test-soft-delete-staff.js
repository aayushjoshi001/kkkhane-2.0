/**
 * Verifies the staff soft-delete fix (deleteStaffAction):
 *  1. auth.admin.deleteUser(id, true) must NOT cascade into public.users
 *     (the old hard delete wiped staff_ledger / staff_attendance /
 *     staff_salary_history via ON DELETE CASCADE).
 *  2. The soft-deleted user must no longer be able to sign in.
 *  3. The email must be reusable afterwards (re-hiring the same person).
 *  4. users.deleted_at column exists (migration 20260712100000 applied).
 *
 * Creates a clearly-labeled throwaway user and removes everything at the end.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);
const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const EMAIL = `test-softdelete-${Date.now()}@example.com`;
const PASSWORD = `Test-${Math.random().toString(36).slice(2)}-9x!`;

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
    ok ? pass++ : fail++;
};

async function cleanup(ids) {
    for (const id of ids) {
        if (!id) continue;
        // Hard delete is intentional here: test user only, cascade removes
        // the test ledger/attendance rows too.
        await admin.from('users').delete().eq('id', id);
        await admin.auth.admin.deleteUser(id).catch(() => {});
    }
}

async function run() {
    const createdIds = [];
    try {
        // Any restaurant to attach the test rows to
        const { data: restaurant } = await admin
            .from('restaurants').select('id').limit(1).single();
        if (!restaurant) throw new Error('No restaurant found to test against');

        // 0. Column check (migration applied?)
        const { error: colErr } = await admin
            .from('users').select('deleted_at').limit(1);
        check('users.deleted_at column exists (migration applied)', !colErr, colErr?.message);

        // 1. Create throwaway staff user
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email: EMAIL, password: PASSWORD, email_confirm: true,
            user_metadata: { full_name: 'SOFT DELETE TEST — SAFE TO REMOVE' },
        });
        if (createErr) throw createErr;
        const userId = created.user.id;
        createdIds.push(userId);

        // handle_new_user trigger row + attach to restaurant as waiter
        const { error: attachErr } = await admin.from('users')
            .update({ restaurant_id: restaurant.id, role_id: 4 })
            .eq('id', userId);
        if (attachErr) throw attachErr;

        // 2. Give them payroll + attendance history
        const { error: ledgerErr } = await admin.from('staff_ledger').insert({
            restaurant_id: restaurant.id, user_id: userId, amount: 123.45,
            entry_type: 'accrual', note: 'soft-delete test row',
        });
        if (ledgerErr) throw ledgerErr;
        const { error: attErr } = await admin.from('staff_attendance').insert({
            restaurant_id: restaurant.id, user_id: userId,
            date: '2026-07-11', status: 'present',
        });
        if (attErr) throw attErr;

        // 3. The fix: soft-delete auth account (what deleteStaffAction now does)
        const { error: softErr } = await admin.auth.admin.deleteUser(userId, true);
        check('auth soft delete succeeds', !softErr, softErr?.message);

        const { error: stampErr } = await admin.from('users')
            .update({ is_active: false, deleted_at: new Date().toISOString() })
            .eq('id', userId);
        check('stamping users.deleted_at succeeds', !stampErr, stampErr?.message);

        // 4. History must survive
        const { data: userRow } = await admin.from('users').select('id').eq('id', userId).maybeSingle();
        check('public.users row survives (no cascade)', !!userRow);
        const { data: ledgerRows } = await admin.from('staff_ledger').select('id').eq('user_id', userId);
        check('staff_ledger history survives', (ledgerRows || []).length === 1);
        const { data: attRows } = await admin.from('staff_attendance').select('id').eq('user_id', userId);
        check('staff_attendance history survives', (attRows || []).length === 1);

        // 5. Sign-in must be blocked
        const { error: signInErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
        check('soft-deleted user cannot sign in', !!signInErr, signInErr ? signInErr.message : 'sign-in unexpectedly succeeded');

        // 6. Email must be reusable (re-hire flow)
        const { data: recreated, error: reErr } = await admin.auth.admin.createUser({
            email: EMAIL, password: PASSWORD, email_confirm: true,
            user_metadata: { full_name: 'SOFT DELETE TEST REHIRE — SAFE TO REMOVE' },
        });
        check('email can be reused after soft delete', !reErr, reErr?.message);
        if (recreated?.user?.id) createdIds.push(recreated.user.id);
    } catch (e) {
        console.error('Test error:', e.message || e);
        fail++;
    } finally {
        await cleanup(createdIds);
        console.log(`\n${pass} passed, ${fail} failed. Test users cleaned up.`);
        process.exit(fail ? 1 : 0);
    }
}

run();
