'use server'

import { createAdminClient, createServerClient } from '@/lib/supabase/server'

import { verifyTurnstileToken } from '@/lib/turnstile'

export async function loginWithEmail(email: string, password: string, turnstileToken?: string | null) {
    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.' }
    }
    const supabase = await createServerClient()
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    })

    if (error) {
        return { error: error.message }
    }

    return { user: data.user }
}

export async function signUpCustomerWithEmail(
    email: string, 
    password: string, 
    phone: string, 
    displayName: string, 
    restaurantId: string,
    turnstileToken?: string | null
) {
    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.' }
    }
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: displayName,
                phone: phone,
            }
        }
    })

    if (authError) {
        return { error: authError.message }
    }

    if (!authData.user) {
        return { error: 'Failed to create user.' }
    }

    // Get customer role id dynamically
    const { data: roleData } = await adminSupabase.from('roles').select('id').eq('name', 'customer').single()
    const customerRoleId = roleData?.id || 6

    // Upsert into users table
    const { error: updateError } = await adminSupabase
        .from('users')
        .upsert({
            id: authData.user.id,
            restaurant_id: restaurantId,
            full_name: displayName,
            role_id: customerRoleId,
            is_active: true,
        }, { onConflict: 'id' })

    if (updateError) {
        console.error('Customer profile creation error:', updateError)
        return { error: 'Failed to create customer profile.' }
    }

    // Auto link to loyalty member if phone provided
    if (phone) {
        // Look up by phone
        const { data: loyaltyMember } = await adminSupabase
            .from('loyalty_members')
            .select('id, auth_user_id')
            .eq('restaurant_id', restaurantId)
            .eq('phone', phone)
            .single()

        if (loyaltyMember && !loyaltyMember.auth_user_id) {
            await adminSupabase
                .from('loyalty_members')
                .update({ auth_user_id: authData.user.id, email })
                .eq('id', loyaltyMember.id)
        } else if (!loyaltyMember) {
            // Auto create loyalty member
            await adminSupabase
                .from('loyalty_members')
                .insert({
                    restaurant_id: restaurantId,
                    auth_user_id: authData.user.id,
                    phone: phone,
                    email: email,
                    display_name: displayName,
                    tier: 'bronze',
                    points_balance: 0,
                    lifetime_points: 0,
                    lifetime_spend: 0,
                    visit_count: 0
                })
        }
    }

    return { user: authData.user }
}

export async function sendPhoneOtp(phone: string, turnstileToken?: string | null) {
    const isTokenValid = await verifyTurnstileToken(turnstileToken)
    if (!isTokenValid) {
        return { error: 'Security check failed. Please try again.' }
    }
    const supabase = await createServerClient()
    const { error } = await supabase.auth.signInWithOtp({
        phone
    })

    if (error) {
        return { error: error.message }
    }
    return { success: true }
}

export async function verifyPhoneOtp(phone: string, token: string, restaurantId: string) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data, error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: 'sms'
    })

    if (error) {
        return { error: error.message }
    }

    if (!data.user) {
        return { error: 'Verification failed.' }
    }

    // Ensure they exist in users table
    const { data: existingUser } = await adminSupabase
        .from('users')
        .select('id')
        .eq('id', data.user.id)
        .single()
        
    if (!existingUser) {
        const { data: roleData } = await adminSupabase.from('roles').select('id').eq('name', 'customer').single()
        const customerRoleId = roleData?.id || 6

        await adminSupabase
            .from('users')
            .upsert({
                id: data.user.id,
                restaurant_id: restaurantId,
                full_name: phone, // Default to phone
                role_id: customerRoleId, // Customer
                is_active: true,
            }, { onConflict: 'id' })
            
        // Auto create loyalty member
        await adminSupabase
            .from('loyalty_members')
            .insert({
                restaurant_id: restaurantId,
                auth_user_id: data.user.id,
                phone: phone,
                display_name: phone,
                tier: 'bronze',
                points_balance: 0,
                lifetime_points: 0,
                lifetime_spend: 0,
                visit_count: 0
            })
    }

    return { user: data.user }
}
