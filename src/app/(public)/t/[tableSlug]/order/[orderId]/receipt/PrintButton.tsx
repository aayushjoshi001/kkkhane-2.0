'use client'

export default function PrintButton() {
    return (
        <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition active:scale-95"
        >
            🖨️ Print Receipt
        </button>
    )
}
