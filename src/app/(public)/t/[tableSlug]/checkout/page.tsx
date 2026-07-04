import CheckoutPageClient from './CheckoutPageClient'
import { verifyClientIp } from '@/lib/ip-check'
import { createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function CheckoutPage(props: { 
    params: Promise<{ tableSlug: string }>,
    searchParams: Promise<{ w?: string }>
}) {
    const params = await props.params
    const searchParams = await props.searchParams
    const supabase = await createAdminClient()
    
    const { data: tableData } = await supabase
        .from('tables')
        .select('restaurant_id')
        .eq('qr_token', params.tableSlug)
        .single()
    
    if (tableData?.restaurant_id) {
        const [ipCheck, optionalUser] = await Promise.all([
            verifyClientIp(tableData.restaurant_id, 'customer'),
            searchParams.w === '1' ? getOptionalUser() : Promise.resolve(null)
        ])
        
        const isIpRestricted = !ipCheck.allowed && !optionalUser
        
        if (isIpRestricted) {
            redirect(`/t/${params.tableSlug}`)
        }
    }
    
    return <CheckoutPageClient />
}
