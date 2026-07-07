'use server'

import { getCurrentUser, requireRole } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import type { FinancialEvent, FinancialEventStatus, FinancialEventType } from '@/types/database'
import {
    insertFinancialEvent, findFinancialEventById, findFinancialEventByCode, findFinancialEventBySource,
    updateFinancialEventStatus, searchFinancialEvents, generateFinancialEventCode,
    type SearchFinancialEventsFilters,
} from './repository'

export interface CreateFinancialEventInput {
    eventType: FinancialEventType
    sourceModule: string
    sourceId?: string
    branchId?: string
    businessDate: string
    accountingDate?: string
    amount: number
    currency?: string
    paymentMethodId?: string
    customerId?: string
    supplierId?: string
    employeeId?: string
    referenceNumber?: string
    description?: string
    metadata?: Record<string, unknown>
}

type Result<T> = { data?: T; error?: string }

// Valid status transitions — anything not listed here is rejected.
const TRANSITIONS: Record<FinancialEventStatus, FinancialEventStatus[]> = {
    PENDING: ['PROCESSING', 'FAILED'],
    PROCESSING: ['PROCESSED', 'FAILED'],
    PROCESSED: ['REVERSED'],
    FAILED: ['PENDING'], // via retryEvent only
    REVERSED: [],
}

function assertTransition(current: FinancialEventStatus, next: FinancialEventStatus): string | null {
    if (!TRANSITIONS[current].includes(next)) {
        return `Cannot move a ${current} event to ${next}.`
    }
    return null
}

/**
 * Creates a PENDING financial event. This is as far as the event lifecycle
 * goes in this phase — nothing here posts a voucher, journal entry, or
 * touches any balance/report. Callable by any authenticated staff member
 * since it represents *their* business action (order paid, checkout, etc.),
 * not an administrative operation.
 */
export async function createEvent(input: CreateFinancialEventInput): Promise<Result<FinancialEvent>> {
    const user = await getCurrentUser()
    if (!user.restaurantId) return { error: 'No restaurant context for the current user.' }

    if (!input.eventType) return { error: 'eventType is required.' }
    if (!input.sourceModule?.trim()) return { error: 'sourceModule is required.' }
    if (!input.businessDate) return { error: 'businessDate is required.' }
    if (!Number.isFinite(input.amount) || input.amount < 0) return { error: 'amount must be a non-negative number.' }

    // Idempotency pre-check (DOC-004 Rule 1: one business action, one event).
    // The DB constraint is the real guarantee; this just returns a clearer message.
    if (input.sourceId) {
        const { data: existing } = await findFinancialEventBySource(user.restaurantId, input.sourceModule, input.sourceId, input.eventType)
        if (existing) return { error: `An event already exists for this action (${existing.event_code}).` }
    }

    let eventCode: string
    try {
        eventCode = await generateFinancialEventCode(user.restaurantId)
    } catch (e: any) {
        return { error: e.message || 'Failed to generate an event code.' }
    }

    const { data, error } = await insertFinancialEvent({
        event_code: eventCode,
        event_type: input.eventType,
        source_module: input.sourceModule.trim(),
        source_id: input.sourceId ?? null,
        restaurant_id: user.restaurantId,
        branch_id: input.branchId ?? null,
        business_date: input.businessDate,
        accounting_date: input.accountingDate ?? input.businessDate,
        amount: input.amount,
        currency: input.currency ?? 'NPR',
        payment_method_id: input.paymentMethodId ?? null,
        customer_id: input.customerId ?? null,
        supplier_id: input.supplierId ?? null,
        employee_id: input.employeeId ?? null,
        reference_number: input.referenceNumber ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
        created_by: user.id,
    })

    if (error) {
        // 23505 = unique_violation — the idempotency constraint caught a race.
        if (error.code === '23505') return { error: 'An event already exists for this action.' }
        return { error: error.message }
    }

    void logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'financial_event_created',
        entityType: 'financial_event',
        entityId: data.id,
        newValue: { event_code: data.event_code, event_type: data.event_type, amount: data.amount, status: data.status },
    })

    return { data }
}

async function transition(id: string, next: FinancialEventStatus, options?: { setProcessedAt?: boolean }): Promise<Result<FinancialEvent>> {
    const user = await requireRole('super_admin', 'manager')
    const { data: current, error: findError } = await findFinancialEventById(user.restaurantId, id)
    if (findError) return { error: findError.message }
    if (!current) return { error: 'Financial event not found.' }

    const transitionError = assertTransition(current.status, next)
    if (transitionError) return { error: transitionError }

    const { data, error } = await updateFinancialEventStatus(user.restaurantId, id, {
        status: next,
        processed_at: options?.setProcessedAt ? new Date().toISOString() : current.processed_at,
    })
    if (error) return { error: error.message }

    void logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'financial_event_status_changed',
        entityType: 'financial_event',
        entityId: id,
        oldValue: { status: current.status },
        newValue: { status: next },
    })

    return { data }
}

export async function markProcessing(id: string) {
    return transition(id, 'PROCESSING')
}

export async function markProcessed(id: string) {
    return transition(id, 'PROCESSED', { setProcessedAt: true })
}

export async function markFailed(id: string) {
    return transition(id, 'FAILED')
}

export async function markReversed(id: string) {
    return transition(id, 'REVERSED')
}

/** Only valid from FAILED — resets to PENDING and bumps retry_count. No retry cap (not a business rule this phase defines). */
export async function retryEvent(id: string): Promise<Result<FinancialEvent>> {
    const user = await requireRole('super_admin', 'manager')
    const { data: current, error: findError } = await findFinancialEventById(user.restaurantId, id)
    if (findError) return { error: findError.message }
    if (!current) return { error: 'Financial event not found.' }
    if (current.status !== 'FAILED') return { error: 'Only failed events can be retried.' }

    const { data, error } = await updateFinancialEventStatus(user.restaurantId, id, {
        status: 'PENDING',
        processed_at: null,
        retry_count: current.retry_count + 1,
    })
    if (error) return { error: error.message }

    void logAudit({
        restaurantId: user.restaurantId,
        userId: user.id,
        action: 'financial_event_retried',
        entityType: 'financial_event',
        entityId: id,
        newValue: { retry_count: data.retry_count },
    })

    return { data }
}

export async function findByCode(eventCode: string): Promise<Result<FinancialEvent>> {
    const user = await requireRole('super_admin', 'manager')
    const { data, error } = await findFinancialEventByCode(user.restaurantId, eventCode)
    if (error) return { error: error.message }
    if (!data) return { error: 'Financial event not found.' }
    return { data }
}

export async function searchEvents(filters: SearchFinancialEventsFilters): Promise<Result<{ rows: FinancialEvent[]; total: number }>> {
    const user = await requireRole('super_admin', 'manager')
    const { data, error, count } = await searchFinancialEvents(user.restaurantId, filters)
    if (error) return { error: error.message }
    return { data: { rows: data ?? [], total: count ?? 0 } }
}
