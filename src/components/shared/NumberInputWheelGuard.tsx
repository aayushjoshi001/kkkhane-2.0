'use client'

import { useEffect } from 'react'

/**
 * Stops the mouse wheel from silently changing money amounts.
 *
 * A focused `<input type="number">` treats a wheel scroll as a spinner step, so
 * scrolling the page with the cursor still over an amount field walks the value
 * down one unit per tick. A cashier who typed 1000, then scrolled to check the
 * order list below, would submit 998 — with nothing on screen to suggest the
 * figure had changed since they typed it. Money was being altered by an
 * incidental gesture, and the settlement is built from that number.
 *
 * Blurring on wheel rather than calling preventDefault: preventDefault would
 * also swallow the page scroll the cashier actually intended, which reads as
 * the page being frozen. Dropping focus stops the spinner, lets the scroll
 * through, and leaves the typed value exactly as entered.
 *
 * Mounted once at the root so it covers every numeric input in the app,
 * including ones added later — there are ~21 in the settlement screens alone,
 * and guarding them one at a time would leave the next one to be written
 * unprotected.
 */
export default function NumberInputWheelGuard() {
    useEffect(() => {
        function onWheel(e: WheelEvent) {
            const el = document.activeElement
            if (
                el instanceof HTMLInputElement &&
                el.type === 'number' &&
                el === e.target
            ) {
                el.blur()
            }
        }

        // Capture phase: the input's own spinner handling runs at target, so
        // focus has to be dropped before the event reaches it.
        document.addEventListener('wheel', onWheel, { capture: true, passive: true })
        return () => document.removeEventListener('wheel', onWheel, { capture: true })
    }, [])

    return null
}
