'use client'

import { useState, useEffect } from 'react'
import { Star } from 'lucide-react'
import { submitFeedback } from '@/app/(public)/t/[tableSlug]/order/actions'
import { toast } from 'react-hot-toast'

export default function FeedbackPrompt({ orderId }: { orderId: string }) {
    const [rating, setRating] = useState(0)
    const [hovered, setHovered] = useState(0)
    const [comment, setComment] = useState('')
    const [submitted, setSubmitted] = useState(false)
    const [loading, setLoading] = useState(false)

    // Persist submitted state across refreshes
    const storageKey = `feedback-submitted-${orderId}`
    useEffect(() => {
        if (localStorage.getItem(storageKey)) setSubmitted(true)
    }, [storageKey])

    if (submitted) {
        return (
            <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
                <p className="text-emerald-700 font-semibold text-base">Thank you for your feedback! 🙏</p>
                <p className="text-emerald-600 text-sm mt-1">Your review helps us improve.</p>
            </div>
        )
    }

    const handleSubmit = async () => {
        if (rating === 0) { toast.error('Please select a star rating.'); return }
        setLoading(true)
        const result = await submitFeedback(orderId, rating, comment)
        setLoading(false)
        if (result.error) { toast.error(result.error); return }
        localStorage.setItem(storageKey, '1')
        toast.success('Thanks for your feedback!')
        setSubmitted(true)
    }

    return (
        <div className="mt-6 bg-surface border border-hairline-strong rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-ink text-base mb-1">How was your experience?</h3>
            <p className="text-ink-subtle text-sm mb-4">Rate your meal and leave a comment.</p>

            {/* Star selector */}
            <div className="flex gap-1 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                    <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        onMouseEnter={() => setHovered(star)}
                        onMouseLeave={() => setHovered(0)}
                        className="p-1 transition-transform hover:scale-110"
                        aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                    >
                        <Star
                            size={32}
                            className={`transition-colors ${
                                star <= (hovered || rating)
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-gray-300'
                            }`}
                        />
                    </button>
                ))}
            </div>

            <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 500))}
                placeholder="Any comments? (optional)"
                rows={3}
                className="w-full border border-hairline-strong rounded-xl px-3 py-2 text-sm text-ink-muted resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 mb-3"
            />
            <div className="text-right text-xs text-ink-subtle -mt-2 mb-3">{comment.length}/500</div>

            <button
                onClick={handleSubmit}
                disabled={loading || rating === 0}
                className="w-full py-2.5 px-4 bg-brand-500 text-white font-semibold rounded-xl hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
                {loading ? 'Submitting…' : 'Submit Feedback'}
            </button>
        </div>
    )
}
