'use client'

import { signOutAndRedirect } from '@/lib/auth/signOut'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function SignOutButton() {
    const router = useRouter()

    const handleSignOut = () => signOutAndRedirect(router)

    return (
        <button
            onClick={handleSignOut}
            className="text-xs text-slate-500 hover:text-red-400 transition duration-200 flex items-center justify-center gap-1 mx-auto cursor-pointer"
        >
            <LogOut size={12} />
            Sign Out
        </button>
    )
}
