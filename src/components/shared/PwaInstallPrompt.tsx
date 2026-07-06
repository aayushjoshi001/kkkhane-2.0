'use client'

import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

// BeforeInstallPromptEvent is not yet in the standard lib types
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function PwaInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [showPrompt, setShowPrompt] = useState(false)

    useEffect(() => {
        // Only show the prompt once, ever (persisted after the user dismisses it)
        if (localStorage.getItem('pwa_prompt_dismissed')) return

        const handleBeforeInstallPrompt = (e: Event) => {
            // Prevent the mini-infobar from appearing on mobile
            e.preventDefault()
            // Stash the event so it can be triggered later.
            setDeferredPrompt(e as BeforeInstallPromptEvent)
            // Update UI notify the user they can install the PWA
            setShowPrompt(true)
        }

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
        }
    }, [])

    const handleInstallClick = async () => {
        if (!deferredPrompt) return

        // Show the install prompt
        deferredPrompt.prompt()

        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice
        console.log(`User response to the install prompt: ${outcome}`)

        // We've used the prompt, and can't use it again, throw it away
        setDeferredPrompt(null)
        setShowPrompt(false)
        localStorage.setItem('pwa_prompt_dismissed', 'true')
    }

    const dismissPrompt = () => {
        setShowPrompt(false)
        localStorage.setItem('pwa_prompt_dismissed', 'true')
    }

    if (!showPrompt) return null

    return (
        <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-8 md:bottom-8 md:w-96 bg-ink text-white rounded-2xl shadow-2xl p-4 z-50 animate-in slide-in-from-bottom flex items-start gap-4">
            <div className="bg-[var(--color-primary)]/20 p-3 rounded-xl shrink-0">
                <Download className="text-[var(--color-primary)]" size={24} />
            </div>

            <div className="flex-1">
                <h3 className="font-bold mb-1">Install App</h3>
                <p className="text-sm text-gray-300 mb-3 leading-tight">
                    Install kkkhane for faster ordering and restaurant management.
                </p>

                <div className="flex gap-2">
                    <button
                        onClick={dismissPrompt}
                        className="px-3 py-1.5 text-sm font-medium text-ink-subtle hover:text-white transition"
                    >
                        Later
                    </button>
                    <button
                        onClick={handleInstallClick}
                        className="flex-1 px-3 py-1.5 text-sm font-bold bg-[var(--color-primary)] text-white rounded-lg hover:opacity-90 transition shadow-sm"
                    >
                        Install Now
                    </button>
                </div>
            </div>

            <button
                onClick={dismissPrompt}
                className="absolute top-3 right-3 text-ink-subtle hover:text-white"
            >
                <X size={16} />
            </button>
        </div>
    )
}
