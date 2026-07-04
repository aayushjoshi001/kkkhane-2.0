import { useEffect, useState } from 'react'
import { HomepageConfig } from '@/types/database'

export function useHomepageConfig(restaurantId: string) {
    const [config, setConfig] = useState<HomepageConfig | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!restaurantId) return

        const controller = new AbortController()

        async function fetchConfig() {
            try {
                setIsLoading(true)
                const response = await fetch(`/api/homepage/get?restaurant_id=${restaurantId}`, {
                    signal: controller.signal,
                })

                if (!response.ok) {
                    if (response.status === 404) {
                        const data = await response.json()
                        setConfig(data)
                        setError(null)
                        return
                    }
                    throw new Error('Failed to fetch homepage config')
                }

                const data = await response.json()
                setConfig(data)
                setError(null)
            } catch (err) {
                // Aborted requests (restaurantId changed / unmount) are expected — ignore.
                if (controller.signal.aborted) return
                const message = err instanceof Error ? err.message : 'Failed to load config'
                setError(message)
                console.error('Error fetching homepage config:', err)
            } finally {
                if (!controller.signal.aborted) setIsLoading(false)
            }
        }

        fetchConfig()

        return () => controller.abort()
    }, [restaurantId])

    return { config, isLoading, error }
}
