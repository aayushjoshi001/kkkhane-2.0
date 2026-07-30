import { createAdminClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PersonAmount {
    name: string
    amount: number
}

export interface PersonSplitAmount {
    name: string
    cash: number
    bank: number
    total: number
}

export interface PersonCancellation {
    name: string
    count: number
    amount: number
}

export interface TopRoom {
    roomNumber: string
    roomType: string | null
    bookings: number
    revenue: number
}

export interface EodReportNotes {
    notesText?: string
    uniqueCustomers: number
    rushHour: string
    topSellers: Array<{ name: string; quantity: number; revenue: number }>
    paymentBreakdown: Record<string, number>

    // The business-day session this report was actually scoped to. Null means
    // no session was found for the date and the report fell back to a plain
    // calendar-day window (e.g. a historical date from before the day book
    // existed).
    sessionOpenedAt: string | null
    sessionClosedAt: string | null

    // Who collected how much, by payment channel.
    cashByPerson: PersonAmount[]
    qrByPerson: PersonAmount[]
    creditByPerson: PersonAmount[]

    // Restaurant (food & drink) sales vs. room sales, as two components of
    // total revenue rather than two separate totals — restaurantSales +
    // roomSales does not have to equal total_revenue when a booking's food
    // orders are billed through the room folio.
    restaurantSales: number
    roomSales: number
    topRooms: TopRoom[]

    // Expense, split by how it left the till and who logged it.
    totalExpense: number
    expenseByPerson: PersonSplitAmount[]

    // Manual income postings (Income & Expenses), not order/booking revenue.
    totalIncomeEntries: number
    incomeByPerson: PersonAmount[]

    // Cancellations, attributed to whoever cancelled at the till — best
    // effort: only cancellations that posted an "Order Cancellation" expense
    // (i.e. food already cost something) carry an amount and a name.
    cancelledByPerson: PersonCancellation[]

    // Discounts: hotel bargain discounts (posted as an expense) plus food
    // order discounts, both attributed to the cashier who applied them.
    discountByPerson: PersonAmount[]

    // Service charge, attributed to whichever cashier checked the order out.
    serviceChargeByPerson: PersonAmount[]
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

function sumByPerson(rows: { person: string | null; amount: number }[]): Map<string, number> {
    const map = new Map<string, number>()
    for (const r of rows) {
        const key = r.person || '__unknown__'
        map.set(key, round2((map.get(key) || 0) + r.amount))
    }
    return map
}

async function resolveNames(supabase: SupabaseClient, ids: Set<string>): Promise<Map<string, string>> {
    const idList = Array.from(ids).filter(id => id !== '__unknown__')
    const nameById = new Map<string, string>()
    if (idList.length === 0) return nameById
    const { data } = await supabase.from('users').select('id, full_name').in('id', idList)
    for (const u of data || []) {
        nameById.set(u.id as string, (u.full_name as string) || 'Unknown')
    }
    return nameById
}

function toPersonAmountList(map: Map<string, number>, nameById: Map<string, string>): PersonAmount[] {
    return Array.from(map.entries())
        .map(([id, amount]) => ({ name: id === '__unknown__' ? 'Unattributed' : (nameById.get(id) || 'Unknown'), amount }))
        .filter(p => Math.abs(p.amount) > 0.005)
        .sort((a, b) => b.amount - a.amount)
}

/**
 * Generates an End-of-Day report for a given restaurant and date.
 *
 * Scoped to the business day *session* that date's day_book_sessions row
 * covers — from the moment a cashier or manager opened the business to the
 * moment it was closed (or "now" if it's still open) — rather than a plain
 * calendar day. That's what lets the report answer "what happened between
 * open and close" instead of "what happened between two midnights", which
 * matters the moment a business trades across midnight or opens late.
 * Falls back to a calendar-day window when no session row exists for the
 * date (a date from before the day book feature, or one that was never
 * opened).
 */
export async function generateEodReport(restaurantId: string, reportDate: string) {
    const supabase = await createAdminClient()

    const { data: session } = await supabase
        .from('day_book_sessions')
        .select('id, created_at, closed_at, status')
        .eq('restaurant_id', restaurantId)
        .eq('date', reportDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    const start = session
        ? new Date(session.created_at).toISOString()
        : new Date(`${reportDate}T00:00:00+05:45`).toISOString()
    const end = session
        ? new Date(session.closed_at || Date.now()).toISOString()
        : new Date(`${reportDate}T23:59:59.999+05:45`).toISOString()

    // 2. Fetch all orders for this window (only the columns the aggregation needs)
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, total_amount, tax_amount, tip_amount, discount_amount, service_charge_amount, payment_status, status, session_id, placed_at, cashier_id')
        .eq('restaurant_id', restaurantId)
        .gte('placed_at', start)
        .lte('placed_at', end)

    if (ordersError) throw new Error(`Failed to fetch orders: ${ordersError.message}`)

    const allOrders = orders || []
    const paidOrders = allOrders.filter(o => o.payment_status === 'paid')
    const cancelledOrders = allOrders.filter(o => o.status === 'cancelled')
    const refundedOrders = allOrders.filter(o => o.payment_status === 'refunded')

    // 3. Basic sums
    const totalOrders = paidOrders.length
    const totalRevenue = paidOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0)
    const totalTax = paidOrders.reduce((sum, o) => sum + (o.tax_amount || 0), 0)
    const totalTips = paidOrders.reduce((sum, o) => sum + (o.tip_amount || 0), 0)
    const totalDiscounts = paidOrders.reduce((sum, o) => sum + (o.discount_amount || 0), 0)
    const netRevenue = totalRevenue - totalTax
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0

    const cancelledCount = cancelledOrders.length
    const refundsCount = refundedOrders.length
    const voidsCount = allOrders.filter(o => o.payment_status === 'unpaid' && o.status === 'cancelled').length

    // 4. Unique Customers estimation (by session_id or separate order)
    const uniqueSessions = new Set(paidOrders.map(o => o.session_id).filter(Boolean))
    const ordersWithoutSession = paidOrders.filter(o => !o.session_id).length
    const uniqueCustomers = uniqueSessions.size + ordersWithoutSession

    // 5. Fetch payment verifications for this period to breakdown payment methods
    let cashTotal = 0
    let cardTotal = 0
    const digitalBreakdown: Record<string, number> = {}
    let unverifiedOrdersCount = 0
    const paidOrderIds = paidOrders.map(o => o.id)

    if (paidOrderIds.length > 0) {
        const { data: verifications, error: verError } = await supabase
            .from('payment_verifications')
            .select('order_id, payment_method, amount')
            .in('order_id', paidOrderIds)
            .eq('staff_verified', true)

        if (verError) throw new Error(`Failed to fetch payment verifications: ${verError.message}`)

        const orderVerMap = new Map<string, typeof verifications[number]>()
        for (const v of verifications || []) {
            if (v.order_id) {
                orderVerMap.set(v.order_id, v)
            }
        }

        for (const o of paidOrders) {
            const v = orderVerMap.get(o.id)
            if (v) {
                const method = v.payment_method || 'unknown'
                const orderAmt = o.total_amount || 0
                if (method === 'cash') {
                    cashTotal += orderAmt
                } else if (method === 'card') {
                    cardTotal += orderAmt
                } else {
                    digitalBreakdown[method] = (digitalBreakdown[method] || 0) + orderAmt
                }
            }
        }

        unverifiedOrdersCount = paidOrders.filter(o => !orderVerMap.has(o.id)).length
    }

    const verifiedDigitalTotal = Object.values(digitalBreakdown).reduce((s, n) => s + n, 0)
    const unverifiedTotal = totalRevenue - cashTotal - cardTotal - verifiedDigitalTotal
    const paymentBreakdown: Record<string, number> = {
        cash: cashTotal,
        card: cardTotal,
        ...digitalBreakdown,
        ...(unverifiedTotal > 0.005 ? { unverified: unverifiedTotal } : {}),
    }

    // Fetch each paid order's line items ONCE; both best-sellers and COGS reuse it.
    type SoldItem = { menu_item_id: string; menu_item_variation_id: string | null; quantity: number | null; unit_price: number | null; menu_items: { name?: string; estimated_cost_price?: number | null } | { name?: string; estimated_cost_price?: number | null }[] | null }
    let soldItems: SoldItem[] = []
    if (paidOrderIds.length > 0) {
        const { data: items, error: itemsError } = await supabase
            .from('order_items')
            .select('menu_item_id, menu_item_variation_id, quantity, unit_price, menu_items ( name, estimated_cost_price )')
            .in('order_id', paidOrderIds)

        if (itemsError) throw new Error(`Failed to fetch order items: ${itemsError.message}`)
        soldItems = (items || []) as unknown as SoldItem[]
    }

    // 6. Top 5 Best Sellers
    const itemMap = new Map<string, { name: string; quantity: number; revenue: number }>()
    for (const item of soldItems) {
        const mi = item.menu_items
        const name = (Array.isArray(mi) ? mi[0]?.name : mi?.name) || 'Unknown Item'
        const qty = item.quantity || 0
        const rev = (item.unit_price || 0) * qty
        const existing = itemMap.get(item.menu_item_id)
        if (existing) {
            existing.quantity += qty
            existing.revenue += rev
        } else {
            itemMap.set(item.menu_item_id, { name, quantity: qty, revenue: rev })
        }
    }
    const topSellers = Array.from(itemMap.values())
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5)

    // 7. Most Rush Hour calculation
    const hourCounts = new Map<number, { count: number; revenue: number }>()
    for (const o of paidOrders) {
        const date = new Date(o.placed_at)
        const localTime = new Date(date.getTime() + (5 * 60 + 45) * 60 * 1000)
        const hour = localTime.getUTCHours()

        const existing = hourCounts.get(hour)
        if (existing) {
            existing.count++
            existing.revenue += (o.total_amount || 0)
        } else {
            hourCounts.set(hour, { count: 1, revenue: o.total_amount || 0 })
        }
    }

    let rushHourStr = 'No sales'
    if (hourCounts.size > 0) {
        const sortedHours = Array.from(hourCounts.entries())
            .sort((a, b) => b[1].count - a[1].count || b[1].revenue - a[1].revenue)
        const [bestHour, stats] = sortedHours[0]
        const startHourStr = bestHour === 0 ? '12:00 AM' : bestHour === 12 ? '12:00 PM' : bestHour > 12 ? `${bestHour - 12}:00 PM` : `${bestHour}:00 AM`
        const endHour = (bestHour + 1) % 24
        const endHourStr = endHour === 0 ? '12:00 AM' : endHour === 12 ? '12:00 PM' : endHour > 12 ? `${endHour - 12}:00 PM` : `${endHour}:00 AM`
        rushHourStr = `${startHourStr} - ${endHourStr} (${stats.count} orders, Rs. ${stats.revenue.toFixed(2)})`
    }

    // 8. COGS and Gross Profit calculation (reuses the single soldItems fetch above)
    let totalCogs = 0
    if (soldItems.length > 0) {
        const menuItemIds = Array.from(new Set(soldItems.map(item => item.menu_item_id).filter(Boolean)))
        const variationIds = Array.from(new Set(soldItems.map(item => item.menu_item_variation_id).filter((v): v is string => !!v)))

        if (menuItemIds.length > 0) {
            const recipeQuery = supabase
                .from('recipes')
                .select('menu_item_id, menu_item_variation_id, ingredient_id, quantity_needed')

            const { data: recipes, error: recipesError } = variationIds.length > 0
                ? await recipeQuery.or(`menu_item_id.in.(${menuItemIds.join(',')}),menu_item_variation_id.in.(${variationIds.join(',')})`)
                : await recipeQuery.in('menu_item_id', menuItemIds)

            if (recipesError) throw recipesError

            const { data: ingredients, error: ingredientsError } = await supabase
                .from('ingredients')
                .select('id, cost_per_unit')
                .eq('restaurant_id', restaurantId)

            if (ingredientsError) throw ingredientsError

            const costMap = new Map(ingredients?.map(i => [i.id, i.cost_per_unit || 0]))
            const variationCostMap = new Map<string, number>()
            const baseCostMap = new Map<string, number>()

            for (const r of recipes || []) {
                const itemCost = (r.quantity_needed || 0) * (costMap.get(r.ingredient_id) || 0)
                if (r.menu_item_variation_id) {
                    variationCostMap.set(r.menu_item_variation_id, (variationCostMap.get(r.menu_item_variation_id) || 0) + itemCost)
                } else if (r.menu_item_id) {
                    baseCostMap.set(r.menu_item_id, (baseCostMap.get(r.menu_item_id) || 0) + itemCost)
                }
            }

            for (const item of soldItems) {
                let cost: number
                if (item.menu_item_variation_id && variationCostMap.has(item.menu_item_variation_id)) {
                    cost = variationCostMap.get(item.menu_item_variation_id)!
                } else if (baseCostMap.has(item.menu_item_id)) {
                    cost = baseCostMap.get(item.menu_item_id)!
                } else {
                    const mi = item.menu_items
                    cost = (Array.isArray(mi) ? mi[0]?.estimated_cost_price : mi?.estimated_cost_price) || 0
                }
                totalCogs += cost * (item.quantity || 0)
            }
        }
    }

    const grossProfit = netRevenue - totalCogs

    // ── Everything below is new: the per-person / per-channel breakdowns ──────

    const cancellationExpensesPromise = supabase
        .from('expenses')
        .select('amount, created_by, expense_categories!inner(name)')
        .eq('restaurant_id', restaurantId)
        .eq('expense_categories.name', 'Order Cancellation')
        .gte('created_at', start)
        .lte('created_at', end)

    const discountExpensesPromise = supabase
        .from('expenses')
        .select('amount, created_by, expense_categories!inner(name)')
        .eq('restaurant_id', restaurantId)
        .in('expense_categories.name', ['Bargain Discounts', 'Bargain Discount Expense'])
        .gte('created_at', start)
        .lte('created_at', end)

    const dayBookEntriesPromise = session
        ? supabase
            .from('day_book_entries')
            .select('type, category, amount, created_by')
            .eq('session_id', session.id)
        : Promise.resolve({ data: [] as { type: string; category: string; amount: number; created_by: string | null }[] })

    const receivableChargesPromise = supabase
        .from('receivable_transactions')
        .select('amount, created_by')
        .eq('restaurant_id', restaurantId)
        .eq('type', 'charge')
        .gte('created_at', start)
        .lte('created_at', end)

    const incomeEntriesPromise = supabase
        .from('income_entries')
        .select('amount, created_by')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', start)
        .lte('created_at', end)

    // Bookings settled inside this window — the room side of the day. A stay
    // settled early (bill_settled_at) or at departure (checked_out_at) both
    // count; whichever is set is when the money actually moved.
    const bookingsPromise = supabase
        .from('bookings')
        .select('id, total_amount, bill_settled_at, checked_out_at, room_id, rooms(room_number, room_type)')
        .eq('restaurant_id', restaurantId)
        .or(`and(bill_settled_at.gte.${start},bill_settled_at.lte.${end}),and(bill_settled_at.is.null,checked_out_at.gte.${start},checked_out_at.lte.${end})`)

    const [
        { data: cancellationExpenses },
        { data: discountExpenses },
        { data: dayBookEntries },
        { data: receivableCharges },
        { data: incomeEntries },
        { data: settledBookings },
    ] = await Promise.all([
        cancellationExpensesPromise,
        discountExpensesPromise,
        dayBookEntriesPromise,
        receivableChargesPromise,
        incomeEntriesPromise,
        bookingsPromise,
    ])

    const totalCancellationCost = (cancellationExpenses || []).reduce((sum, e) => sum + (Number(e.amount) || 0), 0)

    // ── Collections by person (cash / QR-bank / credit) ────────────────────
    const revenueCategories = new Set(['order_payment', 'room_deposit', 'booking_payment'])
    const entries = (dayBookEntries || []) as { type: string; category: string; amount: number; created_by: string | null }[]

    const cashInRows = entries
        .filter(e => e.type === 'cash_in' && revenueCategories.has(e.category))
        .map(e => ({ person: e.created_by, amount: Number(e.amount) || 0 }))
    const bankInRows = entries
        .filter(e => e.type === 'bank_in' && revenueCategories.has(e.category))
        .map(e => ({ person: e.created_by, amount: Number(e.amount) || 0 }))
    const creditRows = (receivableCharges || []).map(r => ({ person: r.created_by, amount: Number(r.amount) || 0 }))

    // ── Expense by person, split cash vs. bank/cheque ──────────────────────
    const expenseCashRows = entries.filter(e => e.type === 'cash_out' && e.category === 'expense')
    const expenseBankRows = entries.filter(e => e.type === 'bank_out' && e.category === 'expense')
    const expenseCashMap = sumByPerson(expenseCashRows.map(e => ({ person: e.created_by, amount: Number(e.amount) || 0 })))
    const expenseBankMap = sumByPerson(expenseBankRows.map(e => ({ person: e.created_by, amount: Number(e.amount) || 0 })))
    const totalExpense = round2(
        expenseCashRows.reduce((s, e) => s + (Number(e.amount) || 0), 0) +
        expenseBankRows.reduce((s, e) => s + (Number(e.amount) || 0), 0)
    )

    // ── Income by person ────────────────────────────────────────────────────
    const incomeRows = (incomeEntries || []).map(i => ({ person: i.created_by, amount: Number(i.amount) || 0 }))
    const totalIncomeEntries = round2(incomeRows.reduce((s, r) => s + r.amount, 0))

    // ── Cancellations by person ─────────────────────────────────────────────
    const cancellationByPersonRaw = new Map<string, { count: number; amount: number }>()
    for (const e of cancellationExpenses || []) {
        const key = e.created_by || '__unknown__'
        const existing = cancellationByPersonRaw.get(key) || { count: 0, amount: 0 }
        existing.count += 1
        existing.amount = round2(existing.amount + (Number(e.amount) || 0))
        cancellationByPersonRaw.set(key, existing)
    }

    // ── Discounts by person: hotel bargain-discount expenses + food order discounts ──
    const discountRows = (discountExpenses || []).map(e => ({ person: e.created_by, amount: Number(e.amount) || 0 }))
    for (const o of paidOrders) {
        if ((o.discount_amount || 0) > 0) discountRows.push({ person: o.cashier_id, amount: o.discount_amount })
    }

    // ── Service charge by person: attributed to the checkout cashier ───────
    const serviceChargeRows = paidOrders
        .filter(o => (o.service_charge_amount || 0) > 0)
        .map(o => ({ person: o.cashier_id, amount: o.service_charge_amount }))

    // ── Restaurant vs. room sales, and top 5 rooms ──────────────────────────
    const bookings = (settledBookings || []) as { id: string; total_amount: number; room_id: string | null; rooms: { room_number?: string; room_type?: string } | { room_number?: string; room_type?: string }[] | null }[]
    const roomSales = round2(bookings.reduce((s, b) => s + (Number(b.total_amount) || 0), 0))
    const restaurantSales = round2(totalRevenue)

    const roomAgg = new Map<string, { roomNumber: string; roomType: string | null; bookings: number; revenue: number }>()
    for (const b of bookings) {
        const r = Array.isArray(b.rooms) ? b.rooms[0] : b.rooms
        const key = b.room_id || r?.room_number || 'unknown'
        const existing = roomAgg.get(key) || { roomNumber: r?.room_number || 'Unknown', roomType: r?.room_type || null, bookings: 0, revenue: 0 }
        existing.bookings += 1
        existing.revenue = round2(existing.revenue + (Number(b.total_amount) || 0))
        roomAgg.set(key, existing)
    }
    const topRooms = Array.from(roomAgg.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5)

    // ── Resolve every staff id referenced above in one batch query ─────────
    const staffIds = new Set<string>()
    for (const r of [...cashInRows, ...bankInRows, ...creditRows, ...incomeRows, ...discountRows, ...serviceChargeRows]) {
        if (r.person) staffIds.add(r.person)
    }
    for (const key of [...expenseCashMap.keys(), ...expenseBankMap.keys(), ...cancellationByPersonRaw.keys()]) {
        if (key !== '__unknown__') staffIds.add(key)
    }
    const nameById = await resolveNames(supabase, staffIds)

    const expenseByPerson: PersonSplitAmount[] = Array.from(new Set([...expenseCashMap.keys(), ...expenseBankMap.keys()]))
        .map(key => {
            const cash = expenseCashMap.get(key) || 0
            const bank = expenseBankMap.get(key) || 0
            return { name: key === '__unknown__' ? 'Unattributed' : (nameById.get(key) || 'Unknown'), cash, bank, total: round2(cash + bank) }
        })
        .filter(p => Math.abs(p.total) > 0.005)
        .sort((a, b) => b.total - a.total)

    const cancelledByPerson: PersonCancellation[] = Array.from(cancellationByPersonRaw.entries())
        .map(([id, v]) => ({ name: id === '__unknown__' ? 'Unattributed' : (nameById.get(id) || 'Unknown'), count: v.count, amount: v.amount }))
        .sort((a, b) => b.amount - a.amount)

    const totalCashAmount = round2(cashInRows.reduce((s, r) => s + r.amount, 0)) || cashTotal
    const totalQrAmount = round2(bankInRows.reduce((s, r) => s + r.amount, 0)) || (digitalBreakdown['qr'] || digitalBreakdown['bank'] || 0)
    const totalCreditAmount = round2(creditRows.reduce((s, r) => s + r.amount, 0))
    const totalChequeAmount = digitalBreakdown['cheque'] || 0
    const totalCardAmount = cardTotal
    const totalServiceChargeAmount = round2(serviceChargeRows.reduce((s, r) => s + r.amount, 0))

    const computedPaymentBreakdown: Record<string, number> = {
        cash: totalCashAmount,
        qr: totalQrAmount,
        credit: totalCreditAmount,
        cheque: totalChequeAmount,
        card: totalCardAmount,
        service_charge: totalServiceChargeAmount,
        ...digitalBreakdown,
        ...(unverifiedTotal > 0.005 ? { unverified: unverifiedTotal } : {}),
    }

    const notesJson: EodReportNotes = {
        notesText: '',
        uniqueCustomers,
        rushHour: rushHourStr,
        topSellers,
        paymentBreakdown: computedPaymentBreakdown,
        sessionOpenedAt: session?.created_at ?? null,
        sessionClosedAt: session?.closed_at ?? null,
        cashByPerson: toPersonAmountList(sumByPerson(cashInRows), nameById),
        qrByPerson: toPersonAmountList(sumByPerson(bankInRows), nameById),
        creditByPerson: toPersonAmountList(sumByPerson(creditRows), nameById),
        restaurantSales,
        roomSales,
        topRooms,
        totalExpense,
        expenseByPerson,
        totalIncomeEntries,
        incomeByPerson: toPersonAmountList(sumByPerson(incomeRows), nameById),
        cancelledByPerson,
        discountByPerson: toPersonAmountList(sumByPerson(discountRows), nameById),
        serviceChargeByPerson: toPersonAmountList(sumByPerson(serviceChargeRows), nameById),
    }

    // 10. Upsert into database
    const { data: result, error: upsertError } = await supabase
        .from('eod_reports')
        .upsert({
            restaurant_id: restaurantId,
            report_date: reportDate,
            total_orders: totalOrders,
            total_revenue: totalRevenue,
            total_tax: totalTax,
            total_tips: totalTips,
            total_discounts: totalDiscounts,
            net_revenue: netRevenue,
            cash_total: cashTotal,
            card_total: totalRevenue - cashTotal,
            total_voids: voidsCount,
            total_refunds: refundsCount,
            total_cancelled: cancelledCount,
            total_cancellation_cost: totalCancellationCost,
            avg_order_value: avgOrderValue,
            total_cogs: totalCogs,
            gross_profit: grossProfit,
            notes: JSON.stringify(notesJson),
            unverified_orders: unverifiedOrdersCount
        }, {
            onConflict: 'restaurant_id,report_date'
        })
        .select()
        .single()

    if (upsertError) throw new Error(`Failed to save EOD report: ${upsertError.message}`)

    return result
}
