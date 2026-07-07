import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import BooksManager from './BooksManager'

export const revalidate = 0

export default async function FinanceBooksPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: entries } = await supabase
        .from('day_book_entries')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(300)

    return <BooksManager entries={entries || []} />
}
