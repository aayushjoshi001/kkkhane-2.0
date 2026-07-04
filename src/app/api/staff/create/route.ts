import { createAdminClient } from '@/lib/supabase/server'
import { CreateStaffSchema } from '@/lib/validation'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
    try {
        // Verify user is authenticated and is a manager or super admin
        const user = await getCurrentUser()
        const supabase = await createAdminClient()

        // Get user's role
        const { data: userData } = await supabase
            .from('users')
            .select('role_id, roles(name)')
            .eq('id', user.id)
            .single()

        const userRole = (userData?.roles as unknown as { name: string } | null)?.name || ''
        
        // Only managers and super admins can create staff
        if (!['manager', 'super_admin'].includes(userRole)) {
            return NextResponse.json(
                { error: 'You do not have permission to create staff' },
                { status: 403 }
            )
        }

        const body = await req.json()
        
        // Validate input
        const validation = CreateStaffSchema.safeParse(body)
        if (!validation.success) {
            return NextResponse.json(
                { error: 'Invalid input', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { email, full_name, role_id, password, phone, restaurant_id } = validation.data

        // Managers cannot create super_admin accounts
        if (userRole === 'manager' && role_id === 1) {
            return NextResponse.json(
                { error: 'Managers cannot create super admin accounts.' },
                { status: 403 }
            )
        }

        // Caller's restaurant must match the restaurant_id in the request body
        const { data: callerRecord } = await supabase
            .from('users')
            .select('restaurant_id')
            .eq('id', user.id)
            .single()

        if (userRole !== 'super_admin' && callerRecord?.restaurant_id !== restaurant_id) {
            return NextResponse.json(
                { error: 'Cannot create staff for a different restaurant.' },
                { status: 403 }
            )
        }

        // Verify restaurant exists
        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('id, subscription_tier')
            .eq('id', restaurant_id)
            .single()

        if (!restaurant) {
            return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
        }

        // Check subscription limits
        const tierLimits: Record<string, number> = {
            free: 3,
            basic: 10,
            pro: 50,
            enterprise: 999,
        }

        const maxStaff = tierLimits[restaurant.subscription_tier] || 3

        // Count existing staff (excluding customers)
        const { count: staffCount } = await supabase
            .from('users')
            .select('id', { count: 'exact', head: true })
            .eq('restaurant_id', restaurant_id)
            .neq('role_id', 5) // Exclude customers

        if ((staffCount || 0) >= maxStaff) {
            return NextResponse.json(
                { error: `Staff limit reached. Your ${restaurant.subscription_tier} plan allows ${maxStaff} staff members.` },
                { status: 429 }
            )
        }

        // Create auth user — createUser returns a specific error if email already exists
        const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
            email: email.toLowerCase(),
            password,
            email_confirm: true,
            user_metadata: { full_name },
        })

        if (authError || !authUser) {
            const isEmailTaken = authError?.message?.toLowerCase().includes('already registered') ||
                authError?.message?.toLowerCase().includes('already been registered')
            return NextResponse.json(
                { error: isEmailTaken ? 'Email already registered' : (authError?.message || 'Failed to create auth user') },
                { status: isEmailTaken ? 409 : 400 }
            )
        }

        // The auth trigger creates the public.users row synchronously in the same
        // transaction as auth.users, so it already exists by the time createUser()
        // resolves — upsert by id rather than waiting an arbitrary delay then update.
        const { error: updateError } = await supabase
            .from('users')
            .upsert({
                id: authUser.user.id,
                restaurant_id,
                full_name,
                role_id,
                is_active: true,
            }, { onConflict: 'id' })

        if (updateError) {
            console.error('User update error details:', {
                error: updateError,
                userId: authUser.user.id,
                restaurantId: restaurant_id,
                roleId: role_id
            })
            return NextResponse.json(
                { error: `Failed to update user details: ${updateError.message}` },
                { status: 400 }
            )
        }

        // Update Auth user metadata with phone if provided
        if (phone) {
            await supabase.auth.admin.updateUserById(authUser.user.id, {
                user_metadata: { 
                    full_name,
                    phone 
                }
            })
        }

        // Fetch and return created staff member
        const { data: newStaff } = await supabase
            .from('users')
            .select(`
                id,
                full_name,
                avatar_url,
                is_active,
                role_id,
                department_id,
                created_at,
                roles(id, name, description),
                departments(id, name)
            `)
            .eq('id', authUser.user.id)
            .single()

        return NextResponse.json(
            {
                success: true,
                staff: newStaff,
                message: `Staff member ${full_name} created successfully`,
            },
            { status: 201 }
        )
    } catch (error) {
        console.error('Staff creation error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
