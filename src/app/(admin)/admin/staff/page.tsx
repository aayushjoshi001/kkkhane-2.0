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
            email,
            department_id,
            monthly_salary,
            join_date,
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
        .is('deleted_at', null) // Soft-deleted accounts keep their payroll history but leave the roster
        .order('created_at', { ascending: false })

    // 4. Fetch departments
    const { data: departments } = await adminSupabase
        .from('departments')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true })

    // 5. Fetch invitations (pending + recent history)
    const { data: invitations } = await adminSupabase
        .from('invitations')
        .select('id, email, role_id, department_id, status, expires_at, created_at, roles(id, name, description), departments(id, name), invited_by(id, full_name)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })

    // 6. Fetch active bank accounts
    const { data: bankAccounts } = await adminSupabase
        .from('bank_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
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
                invitations={invitations || []}
                currentUserRole={currentUserRole}
                currentUserId={userId}
                restaurantId={restaurantId}
                bankAccounts={bankAccounts || []}
            />
        </div>
    )
}
