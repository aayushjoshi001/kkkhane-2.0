'use client'

import { useEffect, useState } from 'react'
import { Download, X, Share, SquarePlus } from 'lucide-react'

// BeforeInstallPromptEvent is not yet in the standard lib types
interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// iPadOS 13+ reports itself as "MacIntel" (desktop Safari UA) but is
// touch-capable, unlike a real Mac — the standard way to tell them apart.
function isIosDevice(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandaloneDisplay(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
        // iOS Safari's own (non-standard) flag — matchMedia alone misses it there.
        || (navigator as unknown as { standalone?: boolean }).standalone === true
}

// Shared by the initial-state computation and the effect's subscribe guard
// below — both need to agree on "has this user already opted out".
function isDismissedOrInstalled(): boolean {
    return !!localStorage.getItem('pwa_prompt_dismissed') || isStandaloneDisplay()
}

export default function PwaInstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    // iOS has no `beforeinstallprompt` — there's nothing to trigger a native
    // install, only Safari/any-browser's Share sheet. Computed via a lazy
    // initializer (not an effect) so it's ready before showPrompt's own
    // initializer needs it; guarded for SSR, where `navigator` doesn't exist.
    const [isIos] = useState(() => typeof navigator !== 'undefined' && isIosDevice())
    // iOS can be decided immediately (no event to wait for); Android/Chromium
    // waits for `beforeinstallprompt` in the effect below.
    const [showPrompt, setShowPrompt] = useState(() => {
        if (typeof window === 'undefined' || isDismissedOrInstalled()) return false
        return isIos
    })

    useEffect(() => {
        // iOS's decision was already made in the initializer above; only
        // Android/Chromium needs to subscribe and wait for the event.
        if (isIos || isDismissedOrInstalled()) return

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
    }, [isIos])

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

    if (isIos) {
        return (
            <div className="fixed bottom-24 left-4 right-4 md:left-auto md:right-8 md:bottom-8 md:w-96 bg-ink text-white rounded-2xl shadow-2xl p-4 z-50 animate-in slide-in-from-bottom">
                <div className="flex items-start gap-4">
                    <div className="bg-[var(--color-primary)]/20 p-3 rounded-xl shrink-0">
                        <Download className="text-[var(--color-primary)]" size={24} />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold mb-1">Install App</h3>
                        <p className="text-sm text-gray-300 leading-tight">
                            Add kkkhane to your Home Screen for faster ordering.
                        </p>
                    </div>
                </div>

                <ol className="mt-4 space-y-2.5">
                    <li className="flex items-center gap-3 text-sm text-gray-200">
                        <span className="flex items-center justify-center size-7 rounded-lg bg-white/10 shrink-0 font-bold text-xs">1</span>
                        Tap <Share size={16} className="text-[var(--color-primary)] shrink-0" /> in the browser toolbar
                    </li>
                    <li className="flex items-center gap-3 text-sm text-gray-200">
                        <span className="flex items-center justify-center size-7 rounded-lg bg-white/10 shrink-0 font-bold text-xs">2</span>
                        Then tap <SquarePlus size={16} className="text-[var(--color-primary)] shrink-0" /> &ldquo;Add to Home Screen&rdquo;
                    </li>
                </ol>

                <button
                    onClick={dismissPrompt}
                    className="mt-4 w-full px-3 py-1.5 text-sm font-medium text-ink-subtle hover:text-white transition text-center"
                >
                    Got it
                </button>

                <button
                    onClick={dismissPrompt}
                    className="absolute top-3 right-3 text-ink-subtle hover:text-white"
                    aria-label="Dismiss"
                >
                    <X size={16} />
                </button>
            </div>
        )
    }

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
                aria-label="Dismiss"
            >
                <X size={16} />
            </button>
        </div>
    )
}
