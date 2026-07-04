import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import StaffManager from '@/components/admin/StaffManager'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Users } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function StaffManagementPage() {
    const { id: userId, restaurantId } = await getCurrentUser()
    const adminSupabase = await createAdminClient()

    // Get current user's role
    const { data: currentUserData } = await adminSupabase
        .from('users')
        .select('role_id, roles(name)')
        .eq('id', userId)
        .single()

    const currentUserRole = (currentUserData?.roles as unknown as { name: string } | null)?.name || ''

    // Restaurant slug — used to build the shareable "Staff Terminal" login link
    const { data: restaurant } = await adminSupabase
        .from('restaurants')
        .select('slug')
        .eq('id', restaurantId)
        .single()

    // 2. Fetch all roles available
    const { data: roles } = await adminSupabase
        .from('roles')
        .select('*')
        .order('id', { ascending: true })

    // 3. Fetch all staff for this restaurant (excluding customers if any)
    const { data: staffMembers } = await adminSupabase
        .from('users')
        .select(`
            id,
            full_name,
            avatar_url,
            is_active,
            role_id,
            department_id,
            created_at,
            roles (
                id,
                name,
                description
            ),
            departments (
                id,
                name
            )
        `)
        .eq('restaurant_id', restaurantId)
        .neq('role_id', 5) // Exclude standard customers from the staff dashboard
        .order('created_at', { ascending: false })

    // 4. Fetch departments
    const { data: departments } = await adminSupabase
        .from('departments')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true })

    return (
        <div className="space-y-6">
            <PremiumPageHeader 
                title="Staff Accounts" 
                description="Manage employee access and roles" 
                icon={<Users size={18} />}
                color="purple"
            />

            <StaffManager
                initialStaff={staffMembers || []}
                roles={roles || []}
                departments={departments || []}
                currentUserRole={currentUserRole}
                currentUserId={userId}
                restaurantId={restaurantId}
                restaurantSlug={restaurant?.slug || ''}
            />
        </div>
    )
}
