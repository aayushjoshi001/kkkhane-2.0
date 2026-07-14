import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function GET(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const token = searchParams.get('token')
        const startDateStr = searchParams.get('startDate') // YYYY-MM-DD
        const endDateStr = searchParams.get('endDate') // YYYY-MM-DD

        if (!token) {
            return NextResponse.json({ error: 'Missing security token' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Verify session token is valid and belongs to the viewer
        const { data: sessionToken, error: tokenErr } = await supabase
            .from('analytics_session_tokens')
            .select('tenant_id, expires_at')
            .eq('id', token)
            .eq('viewer_tenant_id', currentUser.restaurantId)
            .single()

        if (tokenErr || !sessionToken) {
            return NextResponse.json({ error: 'Invalid or unauthorized session token' }, { status: 401 })
        }

        if (new Date(sessionToken.expires_at).getTime() < Date.now()) {
            return NextResponse.json({ error: 'Analytics session token has expired (10-minute limit)' }, { status: 401 })
        }

        const partnerId = sessionToken.tenant_id

        // 2. Resolve default date ranges (default last 30 days)
        const end = endDateStr ? new Date(`${endDateStr}T23:59:59.999+05:45`).toISOString() : new Date().toISOString()
        const start = startDateStr 
            ? new Date(`${startDateStr}T00:00:00+05:45`).toISOString() 
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

        // 3. Query income entries
        const { data: incomeRows, error: incErr } = await supabase
            .from('income_entries')
            .select('amount, income_categories(name)')
            .eq('restaurant_id', partnerId)
            .gte('created_at', start)
            .lte('created_at', end)

        if (incErr) throw incErr

        // 4. Query expenses
        const { data: expenseRows, error: expErr } = await supabase
            .from('expenses')
            .select('amount, expense_categories(name)')
            .eq('restaurant_id', partnerId)
            .gte('created_at', start)
            .lte('created_at', end)

        if (expErr) throw expErr

        // 5. Aggregate Income by category
        const incomeMap = new Map<string, number>()
        let totalIncome = 0
        for (const row of (incomeRows || [])) {
            const catName = (row.income_categories as any)?.name || 'Uncategorized'
            const amt = Number(row.amount) || 0
            incomeMap.set(catName, (incomeMap.get(catName) || 0) + amt)
            totalIncome += amt
        }

        const incomeByCategory = Array.from(incomeMap.entries()).map(([name, amount]) => ({
            name,
            amount: Math.round(amount * 100) / 100
        })).sort((a, b) => b.amount - a.amount)

        // 6. Aggregate Expenses by category
        const expenseMap = new Map<string, number>()
        let totalExpense = 0
        for (const row of (expenseRows || [])) {
            const catName = (row.expense_categories as any)?.name || 'Uncategorized'
            const amt = Number(row.amount) || 0
            expenseMap.set(catName, (expenseMap.get(catName) || 0) + amt)
            totalExpense += amt
        }

        const expenseByCategory = Array.from(expenseMap.entries()).map(([name, amount]) => ({
            name,
            amount: Math.round(amount * 100) / 100
        })).sort((a, b) => b.amount - a.amount)

        // 7. Fetch partner metadata
        const { data: partnerMeta } = await supabase
            .from('restaurants')
            .select('name, business_type')
            .eq('id', partnerId)
            .single()

        return NextResponse.json({
            success: true,
            partner: {
                id: partnerId,
                name: partnerMeta?.name || 'Partner',
                businessType: partnerMeta?.business_type || 'Unknown'
            },
            totalIncome: Math.round(totalIncome * 100) / 100,
            totalExpense: Math.round(totalExpense * 100) / 100,
            netProfit: Math.round((totalIncome - totalExpense) * 100) / 100,
            incomeByCategory,
            expenseByCategory,
            range: { start, end }
        })
    } catch (e: any) {
        console.error('Fetch partner P&L error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
