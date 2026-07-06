import { RowSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
    return (
        <div className="space-y-6">
            <header className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-h2 font-extrabold text-ink">End-of-Day Reports</h1>
                    <p className="text-ink-subtle font-medium mt-1">Generate and view daily operational summaries</p>
                </div>
            </header>
            <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)}
            </div>
        </div>
    )
}
