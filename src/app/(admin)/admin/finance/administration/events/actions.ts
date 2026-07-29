'use server'

import { searchEvents, retryEvent } from '@/lib/finance-events/service'
import type { SearchFinancialEventsFilters } from '@/lib/finance-events/repository'
import { requireRole } from '@/lib/auth'

export async function searchEventsAction(filters: SearchFinancialEventsFilters) {
    await requireRole('super_admin', 'manager')
    return searchEvents(filters)
}

export async function retryEventAction(id: string) {
    await requireRole('super_admin', 'manager')
    return retryEvent(id)
}
