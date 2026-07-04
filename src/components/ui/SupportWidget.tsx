'use client'

import { useState } from 'react'
import { HeadphonesIcon, MessageCircle, Star, MessageSquareText, ChevronRight, X } from 'lucide-react'
import Image from 'next/image'

export function SupportWidget() {
    const [isOpen, setIsOpen] = useState(false)

    if (!isOpen) {
        return (
            <button 
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 bg-[var(--color-primary)] text-white p-4 rounded-full shadow-2xl hover:scale-105 transition-transform z-50 flex items-center justify-center"
            >
                <HeadphonesIcon size={24} />
            </button>
        )
    }

    return (
        <div className="fixed bottom-6 right-6 w-[360px] bg-white rounded-2xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-8 fade-in duration-200 border border-gray-100">
            {/* Header */}
            <div className="bg-blue-600 text-white p-6 relative">
                <button 
                    onClick={() => setIsOpen(false)}
                    className="absolute top-4 right-4 text-white/70 hover:text-white"
                >
                    <X size={20} />
                </button>
                <div className="flex items-center gap-2 text-blue-100 text-xs font-bold tracking-wider mb-2">
                    <HeadphonesIcon size={14} /> KKKHANE SUPPORT
                </div>
                <h3 className="text-xl font-bold">We're here to help you 👋</h3>
            </div>

            {/* Main Content */}
            <div className="p-5 space-y-6">
                {/* Primary Contact (WhatsApp) */}
                <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
                            {/* Generic Avatar Placeholder for Kkkhane Support */}
                            <div className="w-full h-full flex items-center justify-center text-gray-400 font-bold">KK</div>
                            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-900">Kkkhane Support</h4>
                            <p className="text-sm text-gray-500">+977 9800000000</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
                            <MessageCircle size={18} /> Chat on WhatsApp
                        </button>
                        <button className="w-11 h-11 border border-gray-200 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
                            <span className="text-xs">QR</span>
                        </button>
                    </div>
                </div>

                {/* Talk to Sales */}
                <div>
                    <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Talk to sales</h5>
                    <button className="w-full bg-gray-50 hover:bg-gray-100 border border-gray-100 rounded-xl p-3 flex items-center justify-between transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                                <MessageSquareText size={18} />
                            </div>
                            <div className="text-left">
                                <h4 className="font-bold text-sm text-gray-900">Aayush Sir</h4>
                                <p className="text-xs text-gray-500">+977 9800000001</p>
                            </div>
                        </div>
                        <ChevronRight size={16} className="text-gray-400" />
                    </button>
                </div>

                {/* Feedback & Support */}
                <div>
                    <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Feedback & Support</h5>
                    <div className="grid grid-cols-2 gap-3">
                        <button className="border border-gray-200 hover:bg-gray-50 rounded-xl py-2.5 px-3 flex items-center justify-center gap-2 text-sm font-semibold text-gray-700 transition-colors">
                            <MessageSquareText size={16} className="text-purple-500" /> Give feedback
                        </button>
                        <button className="border border-gray-200 hover:bg-gray-50 rounded-xl py-2.5 px-3 flex items-center justify-center gap-2 text-sm font-semibold text-gray-700 transition-colors">
                            <Star size={16} className="text-orange-500" /> Rate Us
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
