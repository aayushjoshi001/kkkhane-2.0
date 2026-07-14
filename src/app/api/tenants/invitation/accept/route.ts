import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createHmac, createHash } from 'crypto'
import { getBusinessMode } from '@/lib/businessMode'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { token } = body

        if (!token || typeof token !== 'string') {
            return NextResponse.json({ error: 'Missing invitation token' }, { status: 400 })
        }

        // 1. Decode token
        let rawToken: string
        try {
            rawToken = Buffer.from(token, 'base64url').toString('utf8')
        } catch (err) {
            return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
        }

        const dotIndex = rawToken.lastIndexOf('.')
        if (dotIndex === -1) {
            return NextResponse.json({ error: 'Invalid token signature format' }, { status: 400 })
        }

        const payload = rawToken.slice(0, dotIndex)
        const signature = rawToken.slice(dotIndex + 1)

        // 2. Verify signature
        const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'app-hmac-secret-fallback'
        const expectedSignature = createHmac('sha256', secret).update(payload).digest('base64url')

        if (signature !== expectedSignature) {
            return NextResponse.json({ error: 'Cryptographic signature mismatch. Token tampered.' }, { status: 400 })
        }

        // 3. Parse payload: sender:SENDER_ID|email:EMAIL|expires:EXP_DATE|nonce:NONCE
        const parts = payload.split('|').reduce((acc, part) => {
            const [k, v] = part.split(':')
            if (k && v) acc[k] = v
            return acc
        }, {} as Record<string, string>)

        const senderTenantId = parts['sender']
        const recipientEmail = parts['email']
        const expiresAtStr = parts['expires']

        if (!senderTenantId || !recipientEmail || !expiresAtStr) {
            return NextResponse.json({ error: 'Malformed token payload' }, { status: 400 })
        }

        // 4. Verify expiration
        const expiresAt = new Date(expiresAtStr)
        if (expiresAt.getTime() < Date.now()) {
            return NextResponse.json({ error: 'Invitation token has expired (15-minute limit)' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 5. Verify database record status to prevent reuse
        const tokenHash = createHash('sha256').update(rawToken).digest('hex')
        const { data: invitation, error: fetchErr } = await supabase
            .from('tenant_invitations')
            .select('*')
            .eq('token_hash', tokenHash)
            .maybeSingle()

        if (fetchErr || !invitation) {
            return NextResponse.json({ error: 'Invitation not found or revoked' }, { status: 404 })
        }

        if (invitation.status !== 'pending') {
            return NextResponse.json({ error: `Invitation is already ${invitation.status}` }, { status: 400 })
        }

        // 6. Verify that the recipient matches the current user's restaurant/tenant
        const receiverTenantId = currentUser.restaurantId
        if (senderTenantId === receiverTenantId) {
            return NextResponse.json({ error: 'Cannot link a tenant to itself' }, { status: 400 })
        }

        // 7. Get details of both restaurants to confirm who is Hotel and who is Restaurant
        const { data: senderRest } = await supabase
            .from('restaurants')
            .select('id, business_type')
            .eq('id', senderTenantId)
            .single()

        const { data: receiverRest } = await supabase
            .from('restaurants')
            .select('id, business_type')
            .eq('id', receiverTenantId)
            .single()

        if (!senderRest || !receiverRest) {
            return NextResponse.json({ error: 'One or both restaurants do not exist' }, { status: 404 })
        }

        const senderMode = getBusinessMode(senderRest.business_type)
        const receiverMode = getBusinessMode(receiverRest.business_type)

        let hotelId: string | null = null
        let restaurantId: string | null = null

        if (senderMode === 'hotel' && receiverMode !== 'hotel') {
            hotelId = senderTenantId
            restaurantId = receiverTenantId
        } else if (receiverMode === 'hotel' && senderMode !== 'hotel') {
            hotelId = receiverTenantId
            restaurantId = senderTenantId
        } else {
            return NextResponse.json({ error: 'Linking requires exactly one Hotel tenant and one Restaurant tenant' }, { status: 400 })
        }

        // 8. Atomically complete the handshake by linking them and updating invitation status
        // Run updates
        const { error: inviteUpdateErr } = await supabase
            .from('tenant_invitations')
            .update({ status: 'accepted' })
            .eq('id', invitation.id)

        if (inviteUpdateErr) throw inviteUpdateErr

        // Update Hotel
        const { error: hotelUpdateErr } = await supabase
            .from('restaurants')
            .update({ linked_restaurant_id: restaurantId })
            .eq('id', hotelId)

        if (hotelUpdateErr) throw hotelUpdateErr

        // Update Restaurant
        const { error: restUpdateErr } = await supabase
            .from('restaurants')
            .update({ linked_hotel_id: hotelId })
            .eq('id', restaurantId)

        if (restUpdateErr) throw restUpdateErr

        return NextResponse.json({
            success: true,
            linkedHotelId: hotelId,
            linkedRestaurantId: restaurantId
        })
    } catch (e: any) {
        console.error('Accept invitation error:', e)
        return NextResponse.json({ error: e.message || 'Server error accepting invitation' }, { status: 500 })
    }
}
