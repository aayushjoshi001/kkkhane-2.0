import { useEffect, useState } from 'react'

export interface QrCodeOption {
    id: string
    label: string
}

// The restaurant's active payment QR codes (Settings → QR Payment). Shared by
// every place staff record a QR payment, so each can offer a "which QR did
// the customer scan" picker instead of guessing a bank account.
export function useQrCodes() {
    const [qrCodes, setQrCodes] = useState<QrCodeOption[]>([])

    useEffect(() => {
        let cancelled = false
        fetch('/api/qr-codes')
            .then(res => res.json())
            .then(data => {
                if (!cancelled && data.success) setQrCodes(data.data || [])
            })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])

    return qrCodes
}
