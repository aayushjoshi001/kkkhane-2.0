import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import LoginClient from './LoginClient'

export const dynamic = 'force-dynamic'

export default async function CustomerLoginPage(props: { params: Promise<{ restaurantSlug: string }> }) {
    const { restaurantSlug } = await props.params
    const supabase = await createAdminClient()
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('*')
        .eq('slug', restaurantSlug)
        .single()

    if (!restaurant) {
        redirect('/')
    }

    return <LoginClient restaurant={restaurant} />
}
