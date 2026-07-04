import { ReactNode } from 'react'
import IdleTimeout from '@/components/shared/IdleTimeout'

export default function StaffLayout({ children }: { children: ReactNode }) {
    return (
        <>
            {/* Auto-lock POS terminal after 60 seconds of inactivity */}
            <IdleTimeout timeoutMs={60000} />
            {children}
        </>
    )
}
