import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import CashierClient, { type UnpaidOrder, type ActiveOrder } from '@/components/waiter/CashierClient'
import { type PaymentClaim } from '@/components/waiter/PaymentVerificationFeed'

export const revalidate = 0

export default async function CashierPage() {
    const { id: userId, restaurantId } = await requireRole('cashier', 'waiter', 'manager', 'super_admin')
    const adminSupabase = await createAdminClient()

    const [
        { data: unpaidOrders },
        { data: activeOrders },
        { data: tables },
        { data: paymentClaims },
    ] = await Promise.all([
        // Delivered but not yet paid — ready for cashier
        adminSupabase
            .from('orders')
            .select(`
                id, total_amount, delivered_at, payment_status, payment_method, session_id,
                sessions ( id, tables ( id, label ) ),
                order_items ( quantity, menu_items ( name ) )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('status', 'delivered')
            .eq('payment_status', 'unpaid')
            .order('delivered_at', { ascending: true })
            .limit(50),

        // Currently being prepared / pending — so cashier can see incoming
        adminSupabase
            .from('orders')
            .select(`
                id, status, total_amount, placed_at, session_id, order_type, customer_name, customer_phone, delivery_address,
                sessions ( id, tables ( label ) ),
                order_items ( id, quantity, status, menu_items ( name ) )
            `)
            .eq('restaurant_id', restaurantId)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .order('placed_at', { ascending: true }),

        // All active tables
        adminSupabase
            .from('tables')
            .select('id, label, capacity')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('label', { ascending: true }),

        // Online payment claims (UPI/card) awaiting staff verification
        adminSupabase
            .from('payment_verifications')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(20),
    ])

    return (
        <CashierClient
            restaurantId={restaurantId}
            userId={userId}
            initialUnpaid={(unpaidOrders || []) as unknown as UnpaidOrder[]}
            initialActive={(activeOrders || []) as unknown as ActiveOrder[]}
            initialClaims={(paymentClaims || []) as unknown as PaymentClaim[]}
            tables={(tables || []).map(t => ({ id: t.id, label: t.label, capacity: t.capacity }))}
        />
    )
}
