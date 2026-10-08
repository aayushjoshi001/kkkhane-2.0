import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CriticalClient from './CriticalClient'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { AlertTriangle } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function CriticalPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Fetch in parallel:
    // 1. Low stock ingredients
    // 2. Pending vouchers (day book entries waiting for approval)
    // 3. Unpaid supplier bills
    // 4. Active suppliers (for stock purchase popup helper)
    // 5. Ingredient categories (for stock purchase popup helper)
    const [
        { data: ingredients },
        { data: voucherEntries },
        { data: supplierBills },
        { data: suppliers },
        { data: categories }
    ] = await Promise.all([
        supabase
            .from('ingredients')
            .select('id, name, stock_quantity, reorder_level, unit, cost_per_unit, supplier, category_id')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('day_book_entries')
            .select('*, day_book_sessions(date)')
            .eq('restaurant_id', restaurantId)
            .like('description', '%"status":"pending_approval"%')
            .order('created_at', { ascending: false }),
        supabase
            .from('supplier_bills')
            .select('id, bill_number, amount, paid_amount, supplier_id, due_date, created_at, status, suppliers(name)')
            .eq('restaurant_id', restaurantId)
            .neq('status', 'paid')
            .order('due_date', { ascending: true }),
        supabase
            .from('suppliers')
            .select('id, name, category_id')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('expense_categories')
            .select('id, name, is_stock_category')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true })
    ])

    const lowStock = (ingredients || []).filter(
        i => i.reorder_level !== null && Number(i.stock_quantity) <= Number(i.reorder_level)
    )

    const formattedBills = (supplierBills || []).map(b => {
        const suppliersArr = b.suppliers as unknown as Array<{ name: string }> | null
        return {
            id: b.id,
            bill_number: b.bill_number,
            amount: Number(b.amount),
            paid_amount: Number(b.paid_amount),
            supplier_id: b.supplier_id,
            due_date: b.due_date,
            created_at: b.created_at,
            status: b.status,
            suppliers: Array.isArray(suppliersArr) && suppliersArr.length > 0
                ? { name: suppliersArr[0].name }
                : null
        }
    })

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Critical Alerts" description="Low stock warnings, unpaid supplier bills, and pending approvals." icon={<AlertTriangle size={18} />} color="orange" />
            <CriticalClient
                restaurantId={restaurantId}
                currentUserId={currentUser.id}
                lowStock={lowStock}
                initialVouchers={voucherEntries || []}
                supplierBills={formattedBills}
                suppliers={suppliers || []}
                categories={categories || []}
            />
        </div>
    )
}
