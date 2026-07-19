'use client'

import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { RefreshCw } from 'lucide-react'

/**
 * next-pwa's skipWaiting:true activates a new service worker in already-open
 * tabs immediately after a deploy, without waiting for them to close — so an
 * open tab keeps running JS built against the OLD asset manifest while the SW
 * now serves NEW hashed chunk URLs (the classic PWA "ChunkLoadError" on the
 * next navigation). Prompt for a refresh instead of forcing one, so a
 * customer mid-order or a waiter mid-shift isn't interrupted without warning.
 */
export default function PwaUpdatePrompt() {
    useEffect(() => {
        if (!('serviceWorker' in navigator)) return

        let reloaded = false
        let hadController = !!navigator.serviceWorker.controller

        const onControllerChange = () => {
            if (reloaded) return
            
            // If the page was initially uncontrolled, this first controllerchange 
            // event means the SW just installed for the first time. We shouldn't
            // prompt for a refresh here.
            if (!hadController) {
                hadController = true
                return
            }

            toast.custom((t) => (
                <div className={`${t.visible ? 'animate-enter' : 'animate-leave'} max-w-sm w-full bg-ink text-white shadow-2xl rounded-2xl px-4 py-3 flex items-center gap-3`}>
                    <RefreshCw size={18} className="text-[var(--color-primary)] shrink-0" />
                    <p className="flex-1 text-sm font-semibold">A new version is ready.</p>
                    <button
                        onClick={() => { reloaded = true; window.location.reload() }}
                        className="px-3 py-1.5 text-sm font-bold bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition shrink-0"
                    >
                        Refresh
                    </button>
                </div>
            ), { duration: Infinity, id: 'pwa-update' })
        }

        navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
        return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }, [])

    return null
}
