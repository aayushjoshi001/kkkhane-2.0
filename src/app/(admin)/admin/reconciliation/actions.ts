'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Linking two properties decides whether folio charges, loyalty and credit
// flow between them — a financial-authority decision, so it takes the same
// role as the rest of /admin, not merely a valid session.
async function requireManager() {
    const user = await requireRole('super_admin', 'manager')
    if (!user.restaurantId) throw new Error('Unauthorized')
    return {
        id: user.id,
        restaurantId: user.restaurantId
    }
}

const PATH = '/admin/reconciliation'

export async function sendLinkRequestAction(receiverId: string) {
    try {
        const user = await requireManager()
        if (receiverId === user.restaurantId) {
            return { error: 'You cannot link to your own property.' }
        }
        const supabase = await createAdminClient()

        // Verify receiver exists
        const { data: receiver } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('id', receiverId)
            .single()

        if (!receiver) return { error: 'Receiver property not found.' }

        // Check if already requested
        const { data: existing } = await supabase
            .from('partner_link_requests')
            .select('id')
            .eq('sender_id', user.restaurantId)
            .eq('receiver_id', receiverId)
            .eq('status', 'pending')
            .maybeSingle()

        if (existing) return { error: 'A pending link request already exists for this property.' }

        const { error } = await supabase
            .from('partner_link_requests')
            .insert({
                sender_id: user.restaurantId,
                receiver_id: receiverId,
                status: 'pending'
            })

        if (error) throw error

        revalidatePath(PATH)
        return { success: true }
    } catch (e) {
        if (e instanceof Error && (e.message === 'NEXT_REDIRECT' || (e as any).digest?.startsWith('NEXT_REDIRECT'))) throw e;
        return { error: e instanceof Error ? e.message : 'Failed to send link request' }
    }
}

export async function acceptLinkRequestAction(requestId: string) {
    try {
        const user = await requireManager()
        const supabase = await createAdminClient()

        // Fetch request
        const { data: req, error: fetchErr } = await supabase
            .from('partner_link_requests')
            .select('*')
            .eq('id', requestId)
            .single()

        if (fetchErr || !req) return { error: 'Link request not found.' }
        if (req.receiver_id !== user.restaurantId) return { error: 'Unauthorized to approve this request.' }

        const senderId = req.sender_id
        const receiverId = req.receiver_id

        // Fetch sender and receiver to identify business types
        const [senderRes, receiverRes] = await Promise.all([
            supabase.from('restaurants').select('business_type').eq('id', senderId).single(),
            supabase.from('restaurants').select('business_type').eq('id', receiverId).single()
        ])

        const sender = senderRes.data
        const receiver = receiverRes.data

        if (!sender || !receiver) return { error: 'Properties involved in request could not be fetched.' }

        // Bidirectional link logic:
        // One must be hotel and one must be restaurant (or we link them respectively)
        let senderUpdates: any = {}
        let receiverUpdates: any = {}

        if (sender.business_type === 'hotel') {
            senderUpdates.linked_restaurant_id = receiverId
            receiverUpdates.linked_hotel_id = senderId
        } else {
            senderUpdates.linked_hotel_id = receiverId
            receiverUpdates.linked_restaurant_id = senderId
        }

        // Apply bidirectional updates
        const [u1, u2] = await Promise.all([
            supabase.from('restaurants').update(senderUpdates).eq('id', senderId),
            supabase.from('restaurants').update(receiverUpdates).eq('id', receiverId)
        ])

        if (u1.error || u2.error) {
            throw new Error('Database updates failed during linking handshake.')
        }

        // Mark request approved
        await supabase
            .from('partner_link_requests')
            .update({ status: 'approved' })
            .eq('id', requestId)

        revalidatePath(PATH)
        return { success: true }
    } catch (e) {
        if (e instanceof Error && (e.message === 'NEXT_REDIRECT' || (e as any).digest?.startsWith('NEXT_REDIRECT'))) throw e;
        return { error: e instanceof Error ? e.message : 'Failed to accept link request' }
    }
}

export async function rejectLinkRequestAction(requestId: string) {
    try {
        const user = await requireManager()
        const supabase = await createAdminClient()

        const { error } = await supabase
            .from('partner_link_requests')
            .update({ status: 'rejected' })
            .eq('id', requestId)
            .eq('receiver_id', user.restaurantId)

        if (error) throw error

        revalidatePath(PATH)
        return { success: true }
    } catch (e) {
        if (e instanceof Error && (e.message === 'NEXT_REDIRECT' || (e as any).digest?.startsWith('NEXT_REDIRECT'))) throw e;
        return { error: e instanceof Error ? e.message : 'Failed to reject request' }
    }
}

export async function updateLinkSettingsAction(settings: {
    folio: boolean
    loyalty: boolean
    credit: boolean
}) {
    try {
        const user = await requireManager()
        const supabase = await createAdminClient()

        const { error } = await supabase
            .from('restaurants')
            .update({
                link_allow_folio_charges: settings.folio,
                link_allow_loyalty_sharing: settings.loyalty,
                link_allow_credit_sharing: settings.credit
            })
            .eq('id', user.restaurantId)

        if (error) throw error

        revalidatePath(PATH)
        return { success: true }
    } catch (e) {
        if (e instanceof Error && (e.message === 'NEXT_REDIRECT' || (e as any).digest?.startsWith('NEXT_REDIRECT'))) throw e;
        return { error: e instanceof Error ? e.message : 'Failed to update link settings' }
    }
}
