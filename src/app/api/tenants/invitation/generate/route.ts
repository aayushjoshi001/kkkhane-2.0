import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createHmac, randomBytes, createHash } from 'crypto'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { recipientEmail } = body

        if (!recipientEmail || typeof recipientEmail !== 'string') {
            return NextResponse.json({ error: 'Missing or invalid recipientEmail' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'app-hmac-secret-fallback'
        
        // 1. Generate invitation details (expires in 15 mins)
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
        const nonce = randomBytes(16).toString('hex')
        const payload = `sender:${currentUser.restaurantId}|email:${recipientEmail.trim().toLowerCase()}|expires:${expiresAt}|nonce:${nonce}`
        
        // 2. Cryptographic signature
        const signature = createHmac('sha256', secret).update(payload).digest('base64url')
        const rawToken = `${payload}.${signature}`
        const base64Token = Buffer.from(rawToken).toString('base64url')

        // 3. Hash the token for secure storage
        const tokenHash = createHash('sha256').update(rawToken).digest('hex')

        // 4. Save to tenant_invitations
        const { error: insertError } = await supabase
            .from('tenant_invitations')
            .insert({
                sender_tenant_id: currentUser.restaurantId,
                recipient_email: recipientEmail.trim().toLowerCase(),
                token_hash: tokenHash,
                expires_at: expiresAt,
                status: 'pending'
            })

        if (insertError) {
            console.error('Failed to create invitation:', insertError)
            return NextResponse.json({ error: 'Database error saving invitation' }, { status: 500 })
        }

        // Return token to the user to send/copy
        return NextResponse.json({
            success: true,
            expiresAt,
            token: base64Token
        })
    } catch (e: any) {
        console.error('Generate invitation error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
