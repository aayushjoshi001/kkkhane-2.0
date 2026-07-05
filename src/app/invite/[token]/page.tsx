import { createAdminClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import AcceptInviteForm from './AcceptInviteForm'
import AuthHero from '@/components/shared/AuthHero'

function hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex')
}

type InviteLookup =
    | { valid: true; restaurantName: string; roleName: string; email: string }
    | { valid: false; reason: string }

async function lookupInvitation(token: string): Promise<InviteLookup> {
    const supabase = await createAdminClient()
    const tokenHash = hashToken(token)

    const { data: invitation } = await supabase
        .from('invitations')
        .select('email, status, expires_at, restaurant_id, role_id, roles(name), restaurants(name)')
        .eq('token_hash', tokenHash)
        .maybeSingle()

    if (!invitation) return { valid: false, reason: 'This invite link is invalid.' }
    if (invitation.status === 'revoked') return { valid: false, reason: 'This invite has been revoked. Ask your manager to resend it.' }
    if (invitation.status === 'accepted') return { valid: false, reason: 'This invite has already been accepted. Please log in instead.' }
    if (new Date(invitation.expires_at) < new Date()) return { valid: false, reason: 'This invite link has expired. Ask your manager to resend it.' }

    const roleObj = Array.isArray(invitation.roles) ? invitation.roles[0] : invitation.roles
    const restaurantObj = Array.isArray(invitation.restaurants) ? invitation.restaurants[0] : invitation.restaurants

    return {
        valid: true,
        restaurantName: restaurantObj?.name || 'your restaurant',
        roleName: roleObj?.name || 'staff',
        email: invitation.email,
    }
}

export default async function InviteAcceptPage(props: { params: Promise<{ token: string }> }) {
    const { token } = await props.params
    const result = await lookupInvitation(token)

    return (
        <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#ff6b00] overflow-hidden">
            <div className="w-full md:w-[45%] lg:w-[40%] h-[35vh] md:h-full flex-shrink-0">
                <AuthHero heightClassName="h-full" />
            </div>

            <div className="flex-1 w-full relative z-10 flex flex-col bg-transparent md:bg-white rounded-t-[2rem] md:rounded-none -mt-6 md:mt-0 overflow-hidden">
                <div className="flex-1 w-full bg-white md:bg-transparent rounded-t-[2rem] md:rounded-none overflow-y-auto no-scrollbar">
                    <div className="min-h-full w-full flex flex-col px-6 sm:px-10 pt-4 pb-12">
                        <div className="w-full max-w-[420px] mx-auto my-auto flex flex-col">
                            <AcceptInviteForm token={token} result={result} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
