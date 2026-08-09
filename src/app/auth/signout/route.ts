import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { ensureAutoClockOut } from '@/lib/autoClockIn'

export async function POST(request: Request) {
    const requestUrl = new URL(request.url)
    const cookieStore = await cookies()
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookieStore.get(name)?.value
                },
                set(name: string, value: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value, ...options }) } catch (error) {}
                },
                remove(name: string, options: CookieOptions) {
                    try { cookieStore.set({ name, value: '', ...options }) } catch (error) {}
                },
            },
        }
    )

    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.id) {
            await ensureAutoClockOut(user.id)
        }
    } catch (err) {
        console.error('Signout auto clock-out error:', err)
    }

    await supabase.auth.signOut()

    // Redirect to the referrer or homepage
    return NextResponse.redirect(requestUrl.origin, {
        status: 301,
    })
}
