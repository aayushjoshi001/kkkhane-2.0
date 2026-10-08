'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export default function GatewayCallbackCopy({ url }: { url: string }) {
    const [copied, setCopied] = useState(false)

    async function handleCopy() {
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            // Clipboard API unavailable — nothing actionable
        }
    }

    return (
        <div className="flex items-center gap-2 bg-surface border border-hairline rounded-xl px-3 py-2 font-mono text-xs text-ink-muted group">
            <span className="flex-1 truncate select-all">{url}</span>
            <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 p-1 rounded-lg hover:bg-surface-muted transition-colors text-ink-subtle hover:text-ink"
                title="Copy URL"
            >
                {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
        </div>
    )
}
