'use server'

import { createEvent, type CreateFinancialEventInput } from './service'
import type { FinancialEvent } from '@/types/database'

/**
 * The single entry point business-module code calls to raise a Financial
 * Event (DOC-002 §2 — "the originating module should never directly update
 * financial reports, ledgers, balances, or dashboards... it sends one
 * Financial Event to the Financial Event Engine").
 *
 * In this phase the engine has no processors — dispatching an event creates
 * it as PENDING and stops there. Nothing currently calls this function from
 * Restaurant/Hotel/Cash/Bank/etc.; wiring those call sites in is a later step.
 */
export async function dispatchFinancialEvent(input: CreateFinancialEventInput): Promise<{ data?: FinancialEvent; error?: string }> {
    return createEvent(input)
}
