'use client'

interface DayData {
    label: string   // e.g. "Mon"
    date: string    // e.g. "2026-05-12"
    revenue: number
    orders: number
}

export default function RevenueTrendChart({ days }: { days: DayData[] }) {
    const maxRevenue = Math.max(...days.map(d => d.revenue), 1)
    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0)
    const totalOrders = days.reduce((s, d) => s + d.orders, 0)

    const chartH = 180
    const barGap = 8
    const barW = Math.floor((100 - barGap * (days.length - 1)) / days.length)

    function fmt(n: number) {
        if (n >= 100_000) return `Rs. ${(n / 1000).toFixed(0)}k`
        return `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(n))}`
    }

    return (
        <div className="w-full">
            {/* Summary row */}
            <div className="flex gap-6 mb-4 text-sm">
                <div>
                    <span className="text-ink-subtle">7-day revenue</span>
                    <p className="font-bold text-ink text-base">{fmt(totalRevenue)}</p>
                </div>
                <div>
                    <span className="text-ink-subtle">7-day orders</span>
                    <p className="font-bold text-ink text-base">{totalOrders}</p>
                </div>
            </div>

            {/* SVG bar chart */}
            <svg
                viewBox={`0 0 100 ${chartH + 24}`}
                className="w-full"
                preserveAspectRatio="none"
                style={{ height: 220 }}
            >
                {days.map((day, i) => {
                    const barH = maxRevenue > 0 ? (day.revenue / maxRevenue) * chartH : 0
                    const x = i * (barW + barGap)
                    const y = chartH - barH
                    const isEmpty = day.revenue === 0

                    return (
                        <g key={day.date}>
                            {/* Bar */}
                            <rect
                                x={x}
                                y={isEmpty ? chartH - 2 : y}
                                width={barW}
                                height={isEmpty ? 2 : barH}
                                rx="2"
                                fill={isEmpty ? '#e5e7eb' : '#FB6303'}
                                opacity={isEmpty ? 0.5 : 0.9}
                            />
                            {/* Day label */}
                            <text
                                x={x + barW / 2}
                                y={chartH + 14}
                                textAnchor="middle"
                                fontSize="6"
                                fill="#9ca3af"
                            >
                                {day.label}
                            </text>
                            {/* Revenue label on bar (only if tall enough) */}
                            {barH > 18 && (
                                <text
                                    x={x + barW / 2}
                                    y={y + 10}
                                    textAnchor="middle"
                                    fontSize="5"
                                    fill="white"
                                    fontWeight="bold"
                                >
                                    {day.orders}
                                </text>
                            )}
                        </g>
                    )
                })}
                {/* Baseline */}
                <line x1="0" y1={chartH} x2="100" y2={chartH} stroke="#f3f4f6" strokeWidth="0.5" />
            </svg>

            <p className="text-xs text-ink-subtle mt-1 text-center">Numbers on bars = orders that day</p>
        </div>
    )
}
