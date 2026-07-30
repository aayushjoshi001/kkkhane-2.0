import { redirect } from 'next/navigation'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { ArrowLeft, User, LogOut, Star, Gift, History } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/server'
import { round2 } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function CustomerProfilePage(props: { params: Promise<{ restaurantSlug: string }> }) {
    const { restaurantSlug } = await props.params
    const adminSupabase = await createAdminClient()
    const { data: restaurant } = await adminSupabase
        .from('restaurants')
        .select('*')
        .eq('slug', restaurantSlug)
        .single()

    if (!restaurant) redirect('/')

    const cookieStore = await cookies()
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value, ...options }) } catch (error) {}
                },
                remove(name: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value: '', ...options }) } catch (error) {}
                },
            },
        }
    )

    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
        redirect(`/r/${restaurant.slug}/login`)
    }

    // Auto-sync Loyalty Member Profile
    
    let { data: profile } = await adminSupabase
        .from('loyalty_members')
        .select('*')
        .eq('auth_user_id', user.id)
        .eq('restaurant_id', restaurant.id)
        .single()

    if (!profile) {
        const { data: newProfile, error } = await adminSupabase
            .from('loyalty_members')
            .insert({
                restaurant_id: restaurant.id,
                auth_user_id: user.id,
                phone: user.phone || null,
                points_balance: 50, // Signup bonus!
                lifetime_points: 50,
                lifetime_spend: 0,
                tier: 'bronze',
                visit_count: 0,
            })
            .select()
            .single()
            
        if (!error && newProfile) {
            profile = newProfile
        }
    }

    // Gap Fix: Associate the anonymous order from their current session to this newly created (or existing) profile
    const sessionToken = cookieStore.get('session_token')?.value
    if (sessionToken && profile) {
        const { data: activeSession } = await adminSupabase
            .from('sessions')
            .select('id')
            .eq('session_token', sessionToken)
            .single()
            
        if (activeSession) {
            // Find all unassigned orders for this session
            const { data: unclaimedOrders } = await adminSupabase
                .from('orders')
                .select('id, total_amount')
                .eq('session_id', activeSession.id)
                .is('loyalty_member_id', null)

            if (unclaimedOrders && unclaimedOrders.length > 0) {
                // Link them to this profile
                await adminSupabase
                    .from('orders')
                    .update({ loyalty_member_id: profile.id })
                    .in('id', unclaimedOrders.map(o => o.id))

                // Get loyalty config to calculate point value
                const { data: config } = await adminSupabase
                    .from('loyalty_configs')
                    .select('points_per_dollar')
                    .eq('restaurant_id', restaurant.id)
                    .single()

                if (config && config.points_per_dollar) {
                    // Rounded to paisa before the floor. A long sum of order
                    // totals lands just under the round figure it displays as,
                    // and flooring reads that as one point less — 10,000 spent
                    // at 0.1/rupee credited 999 points instead of 1,000.
                    const totalSpend = round2(unclaimedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0))
                    const earnedPoints = Math.floor(round2(totalSpend * config.points_per_dollar))
                    
                    if (earnedPoints > 0) {
                        // Add points to profile
                        profile.points_balance = (profile.points_balance || 0) + earnedPoints
                        profile.lifetime_points = (profile.lifetime_points || 0) + earnedPoints
                        profile.lifetime_spend = (profile.lifetime_spend || 0) + totalSpend
                        
                        await adminSupabase
                            .from('loyalty_members')
                            .update({ 
                                points_balance: profile.points_balance,
                                lifetime_points: profile.lifetime_points,
                                lifetime_spend: profile.lifetime_spend
                            })
                            .eq('id', profile.id)
                            
                        // Record transaction
                        await adminSupabase
                            .from('loyalty_transactions')
                            .insert({
                                member_id: profile.id,
                                type: 'earn',
                                points: earnedPoints,
                                description: 'Claimed anonymous session orders'
                            })
                    }
                }
            }
        }
    }

    return (
        <div className="min-h-screen bg-surface-muted flex flex-col relative overflow-hidden">
            <header className="p-4 flex items-center justify-between bg-surface border-b border-hairline shadow-sm sticky top-0 z-20">
                <Link href={`/r/${restaurant.slug}`} className="w-10 h-10 rounded-full flex items-center justify-center text-ink-subtle hover:text-ink transition-colors bg-surface-muted">
                    <ArrowLeft size={20} />
                </Link>
                <div className="font-bold text-ink">My Profile</div>
                <form action="/auth/signout" method="POST">
                    <button type="submit" className="w-10 h-10 rounded-full flex items-center justify-center text-danger-fg bg-danger-bg hover:opacity-80 transition-colors">
                        <LogOut size={18} />
                    </button>
                </form>
            </header>

            <main className="flex-1 max-w-lg w-full mx-auto p-4 sm:p-6 space-y-6">
                {/* ID Card */}
                <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-3xl p-6 shadow-xl shadow-brand-500/20 text-white relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-surface/10 rounded-full blur-2xl -mr-10 -mt-10" />
                    <div className="flex items-start justify-between relative z-10 mb-8">
                        <div>
                            <p className="text-brand-100 text-sm font-semibold uppercase tracking-wider mb-1">Loyalty Tier</p>
                            <h2 className="text-3xl font-black capitalize tracking-tight flex items-center gap-2">
                                {profile?.tier || 'Bronze'}
                                {profile?.tier === 'gold' && <Star size={24} className="text-yellow-400 fill-yellow-400" />}
                            </h2>
                        </div>
                        <div className="w-12 h-12 bg-surface/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-inner">
                            <Gift size={24} className="text-white" />
                        </div>
                    </div>
                    
                    <div className="relative z-10">
                        <p className="text-brand-100 text-sm font-semibold uppercase tracking-wider mb-1">Total Points</p>
                        <div className="text-5xl font-black tabular-nums tracking-tighter">
                            {profile?.points_balance || 0}
                            <span className="text-lg text-brand-200 ml-2 tracking-normal font-bold">pts</span>
                        </div>
                    </div>
                </div>

                {/* Details */}
                <div className="bg-surface rounded-3xl p-6 border border-hairline shadow-sm space-y-4">
                    <div className="flex items-center gap-4 text-ink-muted">
                        <div className="w-10 h-10 bg-surface-muted rounded-xl flex items-center justify-center shrink-0 border border-hairline">
                            <User size={18} className="text-ink-subtle" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Phone</p>
                            <p className="font-semibold text-ink">{profile?.phone || user.phone || 'Unknown'}</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-ink-muted">
                        <div className="w-10 h-10 bg-surface-muted rounded-xl flex items-center justify-center shrink-0 border border-hairline">
                            <History size={18} className="text-ink-subtle" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Total Visits</p>
                            <p className="font-semibold text-ink">{profile?.visit_count || 0} times</p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    )
}
