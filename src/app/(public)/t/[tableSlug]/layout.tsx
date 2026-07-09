import { ReactNode } from 'react'
import { getTableByToken } from '@/lib/tables'
import { getRestaurantFeatures, getRestaurantMode } from '@/lib/features'
import { FeatureProvider, BusinessModeProvider } from '@/lib/contexts/FeatureContext'

export default async function TableLayout({
    children,
    params,
}: {
    children: ReactNode
    params: Promise<{ tableSlug: string }>
}) {
    const { tableSlug } = await params

    // Look up restaurant from the table's QR token (memoized per-request — the
    // page below resolves the same table again and shares this result).
    const tableData = await getTableByToken(tableSlug)

    const [features, mode] = tableData?.restaurant_id
        ? await Promise.all([
            getRestaurantFeatures(tableData.restaurant_id),
            getRestaurantMode(tableData.restaurant_id),
        ])
        : [null, 'dine_in' as const]

    return (
        <FeatureProvider features={features}>
        <BusinessModeProvider mode={mode}>
            {children}
        </BusinessModeProvider>
        </FeatureProvider>
    )
}
