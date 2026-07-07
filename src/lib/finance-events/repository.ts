import { createAdminClient } from '@/lib/supabase/server'
import type { FinancialEvent, FinancialEventStatus, FinancialEventType } from '@/types/database'

const SELECT_WITH_RELATIONS = '*, suppliers(*), finance_payment_methods(*)'

export interface InsertFinancialEventRow {
    event_code: string
    event_type: FinancialEventType
    source_module: string
    source_id: string | null
    restaurant_id: string
    branch_id: string | null
    business_date: string
    accounting_date: string
    amount: number
    currency: string
    payment_method_id: string | null
    customer_id: string | null
    supplier_id: string | null
    employee_id: string | null
    reference_number: string | null
    description: string | null
    metadata: Record<string, unknown> | null
    created_by: string | null
}

export async function insertFinancialEvent(row: InsertFinancialEventRow) {
    const supabase = await createAdminClient()
    return supabase.from('financial_events').insert(row).select(SELECT_WITH_RELATIONS).single()
}

export async function findFinancialEventById(restaurantId: string, id: string) {
    const supabase = await createAdminClient()
    return supabase.from('financial_events').select(SELECT_WITH_RELATIONS).eq('id', id).eq('restaurant_id', restaurantId).maybeSingle()
}

export async function findFinancialEventByCode(restaurantId: string, eventCode: string) {
    const supabase = await createAdminClient()
    return supabase.from('financial_events').select(SELECT_WITH_RELATIONS).eq('event_code', eventCode).eq('restaurant_id', restaurantId).maybeSingle()
}

export async function findFinancialEventBySource(restaurantId: string, sourceModule: string, sourceId: string, eventType: FinancialEventType) {
    const supabase = await createAdminClient()
    return supabase
        .from('financial_events')
        .select(SELECT_WITH_RELATIONS)
        .eq('restaurant_id', restaurantId)
        .eq('source_module', sourceModule)
        .eq('source_id', sourceId)
        .eq('event_type', eventType)
        .maybeSingle()
}

export async function updateFinancialEventStatus(
    restaurantId: string,
    id: string,
    updates: { status: FinancialEventStatus; processed_at?: string | null; retry_count?: number; metadata?: Record<string, unknown> | null },
) {
    const supabase = await createAdminClient()
    return supabase
        .from('financial_events')
        .update(updates, { count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select(SELECT_WITH_RELATIONS)
        .single()
}

export interface SearchFinancialEventsFilters {
    status?: FinancialEventStatus
    eventType?: FinancialEventType
    dateFrom?: string
    dateTo?: string
    query?: string
    page: number
    pageSize: number
}

export async function searchFinancialEvents(restaurantId: string, filters: SearchFinancialEventsFilters) {
    const supabase = await createAdminClient()
    let q = supabase
        .from('financial_events')
        .select(SELECT_WITH_RELATIONS, { count: 'exact' })
        .eq('restaurant_id', restaurantId)

    if (filters.status) q = q.eq('status', filters.status)
    if (filters.eventType) q = q.eq('event_type', filters.eventType)
    if (filters.dateFrom) q = q.gte('business_date', filters.dateFrom)
    if (filters.dateTo) q = q.lte('business_date', filters.dateTo)
    if (filters.query?.trim()) {
        const like = `%${filters.query.trim()}%`
        q = q.or(`event_code.ilike.${like},description.ilike.${like},reference_number.ilike.${like}`)
    }

    const from = (filters.page - 1) * filters.pageSize
    const to = from + filters.pageSize - 1

    return q.order('created_at', { ascending: false }).range(from, to)
}

export async function generateFinancialEventCode(restaurantId: string): Promise<string> {
    const supabase = await createAdminClient()
    const { data, error } = await supabase.rpc('generate_financial_event_code', { p_restaurant_id: restaurantId })
    if (error) throw error
    return data as string
}

export type { FinancialEvent }
