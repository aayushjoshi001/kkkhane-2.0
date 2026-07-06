'use client'

import { useState } from 'react'
import Image from 'next/image'
import { BookOpen, X, ChevronLeft, ChevronRight } from 'lucide-react'

export default function PhysicalMenuGallery({ images, restaurantName }: { images: string[], restaurantName: string }) {
    const [isOpen, setIsOpen] = useState(false)
    const [currentIndex, setCurrentIndex] = useState(0)

    if (!images || images.length === 0) return null

    const handleNext = (e: React.MouseEvent) => {
        e.stopPropagation()
        setCurrentIndex(prev => (prev + 1) % images.length)
    }

    const handlePrev = (e: React.MouseEvent) => {
        e.stopPropagation()
        setCurrentIndex(prev => (prev - 1 + images.length) % images.length)
    }

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="flex items-center justify-center gap-2 w-full py-3 mb-6 bg-surface border border-hairline-strong rounded-xl shadow-sm text-sm font-semibold text-ink hover:bg-surface-muted transition"
            >
                <BookOpen size={18} className="text-ink-subtle" />
                View Physical Menu
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center">
                    {/* Header */}
                    <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent">
                        <h3 className="text-white font-medium text-sm drop-shadow-md">
                            {restaurantName} — Menu ({currentIndex + 1} of {images.length})
                        </h3>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-2 bg-black/20 hover:bg-black/40 rounded-full text-white backdrop-blur-md transition"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Image Viewer */}
                    <div className="relative w-full h-full flex items-center justify-center p-4">
                        <Image
                            src={images[currentIndex]}
                            alt={`Menu Page ${currentIndex + 1}`}
                            fill
                            sizes="100vw"
                            className="object-contain drop-shadow-2xl"
                        />

                        {images.length > 1 && (
                            <>
                                <button
                                    onClick={handlePrev}
                                    className="absolute left-4 p-3 bg-surface/10 hover:bg-surface/20 rounded-full text-white backdrop-blur-md transition"
                                >
                                    <ChevronLeft size={24} />
                                </button>
                                <button
                                    onClick={handleNext}
                                    className="absolute right-4 p-3 bg-surface/10 hover:bg-surface/20 rounded-full text-white backdrop-blur-md transition"
                                >
                                    <ChevronRight size={24} />
                                </button>
                            </>
                        )}
                    </div>

                    {/* Thumbnails */}
                    {images.length > 1 && (
                        <div className="absolute bottom-6 inset-x-0 flex justify-center gap-2 px-4 overflow-x-auto pb-2">
                            {images.map((img, idx) => (
                                <button
                                    key={idx}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setCurrentIndex(idx)
                                    }}
                                    className={`relative shrink-0 w-12 h-16 rounded-md overflow-hidden border-2 transition-all ${
                                        idx === currentIndex ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-50 hover:opacity-100'
                                    }`}
                                >
                                    <Image src={img} alt="Menu page preview" fill sizes="48px" className="object-cover" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    )
}
