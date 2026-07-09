import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import OrderTracker from '@/components/customer/OrderTracker'
import InvoiceBanner from '@/components/customer/InvoiceBanner'
import Link from 'next/link'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0 // Don't cache this page - fetch fresh DB state

export default async function OrderPage(props: {
    params: Promise<{ tableSlug: string; orderId: string }>
}) {
    const params = await props.params;
    const adminSupabase = await createAdminClient()

    // Verify the order exists, fetch with nested item relations
    // Using adminSupabase to bypass RLS
    // Implement retry logic to handle potential replication lag or slight delays in DB commits
    let order = null;
    let fetchError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const { data, error } = await adminSupabase
            .from('orders')
            .select(`
          *,
          invoice_number,
          order_items (
            *,
            menu_items (name),
            order_item_modifiers (*)
          )
        `)
            .eq('id', params.orderId)
            .single()

        if (data) {
            order = data;
            break;
        } else {
            fetchError = error;
            if (attempt < 3) {
                // Order is committed via the same (primary) admin client, so attempt 1
                // almost always succeeds; short backoff only covers rare commit races.
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
    }

    if (fetchError && !order) {
        console.error("Order fetch error:", fetchError)
    }

    if (!order) {
        return notFound()
    }

    // Fetch restaurant info for invoice display + payment QR + features + table info in parallel
    const [restaurantResult, features, tableResult] = await Promise.all([
        order.restaurant_id
            ? adminSupabase
                .from('restaurants')
                .select('pan_number, vat_registered, name, payment_qr_url, payment_qr_label')
                .eq('id', order.restaurant_id)
                .single()
            : Promise.resolve({ data: null }),
        order.restaurant_id
            ? getRestaurantFeatures(order.restaurant_id)
            : Promise.resolve(null),
        adminSupabase
            .from('tables')
            .select('label')
            .eq('qr_token', params.tableSlug)
            .single()
    ])

    const restaurantInfo = restaurantResult?.data as {
        pan_number?: string
        vat_registered?: boolean
        name?: string
        payment_qr_url?: string
        payment_qr_label?: string
    } | null

    // 2. Fetch all active sibling orders placed in this session/stay
    let sessionOrders: any[] = []
    if (order) {
        let query: any = adminSupabase
            .from('orders')
            .select(`
              *,
              order_items (
                *,
                menu_items (name),
                order_item_modifiers (*)
              )
            `)
            .neq('status', 'cancelled')

        if (order.booking_id) {
            query = query.eq('booking_id', order.booking_id)
        } else if (order.session_id) {
            query = query.eq('session_id', order.session_id)
        } else {
            query = null
        }

        if (query) {
            const { data: siblingData, error: siblingError } = await query
                .order('placed_at', { ascending: true })

            if (siblingError) {
                console.error("Sibling orders fetch error:", siblingError)
            } else {
                sessionOrders = siblingData || []
            }
        }
    }

    const tableInfo = tableResult?.data as { label: string } | null

    return (
        <div className="min-h-screen bg-surface pb-12 text-ink">
            <main className="max-w-xl mx-auto">
                <OrderTracker
                    orderId={params.orderId}
                    initialOrder={order}
                    tableLabel={tableInfo?.label || 'T3'}
                    features={features}
                    restaurantInfo={restaurantInfo}
                    tableSlug={params.tableSlug}
                    sessionOrders={sessionOrders}
                />

                <div className="px-4">
                    {/* Invoice / PAN display + print — always show if invoice exists */}
                    {order.invoice_number && (
                        <>
                            <InvoiceBanner
                                invoiceNumber={order.invoice_number}
                                panNumber={restaurantInfo?.pan_number}
                                restaurantName={restaurantInfo?.name}
                                vatRegistered={restaurantInfo?.vat_registered}
                            />
                            <div className="mt-3 text-center">
                                <a
                                    href={`/t/${params.tableSlug}/order/${params.orderId}/receipt`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-subtle border border-hairline bg-surface rounded-xl px-4 py-2.5 hover:bg-surface-muted active:scale-95 transition shadow-sm"
                                >
                                    🖨️ Print / Download Receipt
                                </a>
                            </div>
                        </>
                    )}

                    {/* Support note */}
                    <div className="mt-8 text-center space-y-3">
                        <Link href={`/t/${params.tableSlug}`} className="inline-block text-[var(--color-primary)] font-bold text-xs hover:underline">
                            ← Back to Menu
                        </Link>
                        <p className="text-xs text-ink-subtle font-semibold">Need help? Ask a waiter for assistance.</p>
                    </div>
                </div>
            </main>
        </div>
    )
}
