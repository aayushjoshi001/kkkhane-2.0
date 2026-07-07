'use server'

import { searchEvents, retryEvent } from '@/lib/finance-events/service'
import type { SearchFinancialEventsFilters } from '@/lib/finance-events/repository'

export async function searchEventsAction(filters: SearchFinancialEventsFilters) {
    return searchEvents(filters)
}

export async function retryEventAction(id: string) {
    return retryEvent(id)
}
