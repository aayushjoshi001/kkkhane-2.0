'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Shield, ChefHat, Users, User, Check, AlertTriangle, Loader2, Pencil, Trash2, Eye, EyeOff, Banknote, Search, KeyRound, Copy, Link2 } from 'lucide-react'
import { updateStaffRoleAction, toggleStaffStatusAction, updateStaffNameAction, resetStaffPasswordAction, deleteStaffAction, createStaffPinAction } from '@/app/(admin)/admin/staff/actions'
import { PIN_ELIGIBLE_ROLE_IDS, isPinEligibleRole } from '@/lib/staffPin'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'

type StaffMember = {
    id: string
    full_name: string
    avatar_url: string | null
    is_active: boolean
    role_id: number
    created_at: string
    // Supabase can return arrays for joins depending on the query shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles: any
}

type Role = {
    id: number
    name: string
    description: string | null
}

export default function StaffManager({
    initialStaff,
    roles,
    currentUserRole,
    currentUserId,
    restaurantId,
    restaurantSlug,
}: {
    initialStaff: StaffMember[]
    roles: Role[]
    currentUserRole: string
    currentUserId: string
    restaurantId: string
    restaurantSlug: string
}) {
    const [staff, setStaff] = useState<StaffMember[]>(initialStaff)
    const [submittingId, setSubmittingId] = useState<string | null>(null)
    const { confirm } = useConfirmStore()

    const [searchQuery, setSearchQuery] = useState('')
    const [roleFilter, setRoleFilter] = useState('all')

    const filteredStaff = staff.filter(user => {
        const matchesSearch = user.full_name.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesRole = roleFilter === 'all' || user.role_id.toString() === roleFilter
        return matchesSearch && matchesRole
    })

    // Modals
    const [changeRoleModal, setChangeRoleModal] = useState<{ isOpen: boolean, user: StaffMember | null, newRoleId: number }>({
        isOpen: false,
        user: null,
        newRoleId: 0
    })

    const [createModal, setCreateModal] = useState({
        isOpen: false,
        mode: 'pin' as 'pin' | 'email',
        fullName: '',
        email: '',
        password: '',
        phone: '',
        roleId: 4, // Default to waiter
        isCreating: false
    })
    // Set once a PIN account is created — shown in place of the form until "Done".
    const [pinResult, setPinResult] = useState<{ pin: string; fullName: string } | null>(null)

    const [editModal, setEditModal] = useState<{
        isOpen: boolean
        user: StaffMember | null
        fullName: string
        newPassword: string
        confirmPassword: string
        showPassword: boolean
        saving: boolean
        deletingId: string | null
    }>({
        isOpen: false,
        user: null,
        fullName: '',
        newPassword: '',
        confirmPassword: '',
        showPassword: false,
        saving: false,
        deletingId: null,
    })

    const handleRoleChange = async () => {
        const user = changeRoleModal.user
        if (!user) return

        setSubmittingId(user.id)
        const res = await updateStaffRoleAction(user.id, changeRoleModal.newRoleId)

        if (res.success) {
            const newRoleName = roles.find(r => r.id === changeRoleModal.newRoleId)?.name || ''
            setStaff(staff.map(s => s.id === user.id ? { ...s, role_id: changeRoleModal.newRoleId, roles: { ...s.roles, name: newRoleName } } : s))
            toast.success('Role updated')
        } else {
            toast.error(res.error || 'Failed to update role')
        }

        setSubmittingId(null)
        setChangeRoleModal({ isOpen: false, user: null, newRoleId: 0 })
    }

    const handleToggleStatus = async (user: StaffMember) => {
        const isOk = await confirm({
            title: user.is_active ? 'Suspend User?' : 'Activate User?',
            message: `Are you sure you want to ${user.is_active ? 'suspend' : 'activate'} ${user.full_name}?`,
            confirmText: user.is_active ? 'Suspend' : 'Activate',
            isDestructive: user.is_active
        })
        if (!isOk) return

        setSubmittingId(user.id)
        const res = await toggleStaffStatusAction(user.id, !user.is_active)

        if (res.success) {
            setStaff(staff.map(s => s.id === user.id ? { ...s, is_active: !user.is_active } : s))
            toast.success(user.is_active ? 'User suspended' : 'User activated')
        } else {
            toast.error(res.error || 'Failed to update status')
        }
        setSubmittingId(null)
    }

    const handleCreateStaff = async () => {
        if (!createModal.fullName || !createModal.email || !createModal.password) {
            toast.error('Please fill in all required fields')
            return
        }

        if (createModal.password.length < 8) {
            toast.error('Password must be at least 8 characters')
            return
        }

        setCreateModal(prev => ({ ...prev, isCreating: true }))

        try {
            const response = await fetch('/api/staff/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    full_name: createModal.fullName,
                    email: createModal.email,
                    password: createModal.password,
                    phone: createModal.phone || undefined,
                    role_id: createModal.roleId,
                    restaurant_id: restaurantId,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                toast.error(data.error || 'Failed to create staff member')
                return
            }

            // Add new staff to list
            if (data.staff) {
                setStaff(prev => [data.staff, ...prev])
            }

            toast.success(data.message || 'Staff member created successfully')
            setCreateModal({
                isOpen: false,
                mode: 'pin',
                fullName: '',
                email: '',
                password: '',
                phone: '',
                roleId: 4,
                isCreating: false
            })
        } catch (error) {
            console.error('Staff creation error:', error)
            toast.error('An error occurred while creating staff')
        } finally {
            setCreateModal(prev => ({ ...prev, isCreating: false }))
        }
    }

    const handleCreateStaffPin = async () => {
        if (!createModal.fullName.trim()) {
            toast.error('Please enter a name')
            return
        }

        setCreateModal(prev => ({ ...prev, isCreating: true }))
        const res = await createStaffPinAction({ fullName: createModal.fullName, roleId: createModal.roleId })
        setCreateModal(prev => ({ ...prev, isCreating: false }))

        if (!res.success || !res.pin) {
            toast.error(res.error || 'Failed to create staff member')
            return
        }

        if (res.staff) setStaff(prev => [res.staff as StaffMember, ...prev])
        setPinResult({ pin: res.pin, fullName: createModal.fullName.trim() })
    }

    const closeCreateModal = () => {
        setCreateModal({ isOpen: false, mode: 'pin', fullName: '', email: '', password: '', phone: '', roleId: 4, isCreating: false })
        setPinResult(null)
    }

    // Computed post-mount (needs window.location.origin) — avoids an SSR/client mismatch.
    const [terminalLink, setTerminalLink] = useState('')
    useEffect(() => {
        if (restaurantSlug) setTerminalLink(`${window.location.origin}/login?r=${restaurantSlug}`)
    }, [restaurantSlug])

    const handleCopyTerminalLink = () => {
        if (!terminalLink) return
        navigator.clipboard.writeText(terminalLink)
        toast.success('Staff terminal link copied')
    }

    const openEditModal = (user: StaffMember) => {
        setEditModal({ isOpen: true, user, fullName: user.full_name, newPassword: '', confirmPassword: '', showPassword: false, saving: false, deletingId: null })
    }

    const handleSaveName = async () => {
        if (!editModal.user) return
        setEditModal(prev => ({ ...prev, saving: true }))
        const res = await updateStaffNameAction(editModal.user!.id, editModal.fullName)
        if (res.success) {
            setStaff(prev => prev.map(s => s.id === editModal.user!.id ? { ...s, full_name: editModal.fullName.trim() } : s))
            toast.success('Name updated')
        } else {
            toast.error(res.error || 'Failed to update name')
        }
        setEditModal(prev => ({ ...prev, saving: false }))
    }

    const handleResetPassword = async () => {
        if (!editModal.user) return
        if (editModal.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
        if (editModal.newPassword !== editModal.confirmPassword) { toast.error('Passwords do not match'); return }
        setEditModal(prev => ({ ...prev, saving: true }))
        const res = await resetStaffPasswordAction(editModal.user!.id, editModal.newPassword)
        if (res.success) {
            setEditModal(prev => ({ ...prev, newPassword: '', confirmPassword: '', saving: false }))
            toast.success('Password updated')
        } else {
            toast.error(res.error || 'Failed to update password')
            setEditModal(prev => ({ ...prev, saving: false }))
        }
    }

    const handleDeleteStaff = async (user: StaffMember) => {
        const ok = await confirm({
            title: 'Permanently Delete Account?',
            message: `This will permanently delete ${user.full_name}'s account and remove all their access. This cannot be undone.`,
            confirmText: 'Delete Permanently',
            isDestructive: true,
        })
        if (!ok) return
        setEditModal(prev => ({ ...prev, deletingId: user.id }))
        const res = await deleteStaffAction(user.id)
        if (res.success) {
            setStaff(prev => prev.filter(s => s.id !== user.id))
            setEditModal({ isOpen: false, user: null, fullName: '', newPassword: '', confirmPassword: '', showPassword: false, saving: false, deletingId: null })
            toast.success(`${user.full_name} has been removed`)
        } else {
            toast.error(res.error || 'Failed to delete account')
            setEditModal(prev => ({ ...prev, deletingId: null }))
        }
    }

    const formatRoleName = (name: string) => {
        return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }

    const getRoleIcon = (roleName: string) => {
        switch (roleName) {
            case 'super_admin': return <Shield size={16} className="text-purple-500" />
            case 'manager': return <Users size={16} className="text-blue-500" />
            case 'kitchen': return <ChefHat size={16} className="text-orange-500" />
            case 'waiter': return <User size={16} className="text-green-500" />
            case 'cashier': return <Banknote size={16} className="text-emerald-500" />
            default: return <User size={16} className="text-gray-500" />
        }
    }

    // Business Logic: Only super_admin can assign super_admin
    const availableRoles = roles.filter(r => r.name !== 'customer' && (currentUserRole === 'super_admin' || r.name !== 'super_admin'))
    // PIN login only makes sense for POS roles (waiter/kitchen/cashier) — never managers/super admins.
    const pinEligibleRoles = availableRoles.filter(r => (PIN_ELIGIBLE_ROLE_IDS as readonly number[]).includes(r.id))

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-4 md:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 bg-gray-50/50">
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Team Roster ({staff.length})</h3>
                    <p className="text-sm text-gray-500 mt-1">Create staff accounts and manage roles</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    {restaurantSlug && (
                        <button
                            onClick={handleCopyTerminalLink}
                            title="Copy the link staff use to sign in with their name + PIN on a shared device"
                            className="px-3.5 py-2 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 shrink-0"
                        >
                            <Link2 size={16} className="text-gray-400" />
                            <span className="hidden sm:inline">Staff Terminal Link</span>
                        </button>
                    )}
                    <button
                        onClick={() => setCreateModal(prev => ({ ...prev, isOpen: true }))}
                        className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 shrink-0"
                    >
                        <Users size={16} />
                        Add Staff
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="px-4 md:px-6 py-3 border-b border-gray-100 flex flex-col sm:flex-row gap-3 bg-white">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search staff by name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-48"
                >
                    <option value="all">All Roles</option>
                    {roles.map(r => (
                        <option key={r.id} value={r.id.toString()}>{formatRoleName(r.name)}</option>
                    ))}
                </select>
            </div>

            {/* Desktop Table — hidden on mobile */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-gray-50 border-b border-gray-100 text-sm font-semibold text-gray-600">
                            <th className="p-4 font-medium pl-6">Staff Member</th>
                            <th className="p-4 font-medium">System Role</th>
                            <th className="p-4 font-medium">Status</th>
                            <th className="p-4 font-medium text-right pr-6">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredStaff.map((user) => {
                            const isMe = user.id === currentUserId
                            const roleObj = Array.isArray(user.roles) ? user.roles[0] : user.roles
                            const roleName = roleObj?.name || ''
                            const isSuperAdmin = roleName === 'super_admin'
                            const canEdit = currentUserRole === 'super_admin' ? !isMe : (!isSuperAdmin && roleName !== 'manager' && !isMe)

                            return (
                                <tr key={user.id} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="p-4 pl-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden shrink-0 border border-gray-200 flex items-center justify-center">
                                                {user.avatar_url ? (
                                                    <Image src={user.avatar_url} alt={user.full_name} width={40} height={40} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-gray-500 font-medium text-sm">
                                                        {user.full_name.charAt(0).toUpperCase()}
                                                    </span>
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-medium text-gray-900 flex items-center gap-2">
                                                    {user.full_name}
                                                    {isMe && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 uppercase">You</span>}
                                                </div>
                                                <div className="text-xs text-gray-500">ID: {user.id.substring(0, 8)}...</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-200 text-sm font-medium text-gray-700">
                                            {getRoleIcon(roleName)}
                                            {formatRoleName(roleName || 'Unknown')}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {user.is_active ? 'Active' : 'Suspended'}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right pr-6">
                                        {canEdit ? (
                                            <div className="flex items-center justify-end gap-1.5">
                                                <button disabled={submittingId === user.id} onClick={() => openEditModal(user)} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                                                    <Pencil size={13} /> Edit
                                                </button>
                                                <button disabled={submittingId === user.id} onClick={() => setChangeRoleModal({ isOpen: true, user, newRoleId: user.role_id })} className="text-sm font-medium text-primary px-2.5 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
                                                    Role
                                                </button>
                                                <button disabled={submittingId === user.id} onClick={() => handleToggleStatus(user)} className={`text-sm font-medium px-2.5 py-1.5 rounded-lg transition-colors ${user.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                                                    {submittingId === user.id ? <Loader2 size={14} className="animate-spin inline" /> : (user.is_active ? 'Suspend' : 'Activate')}
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-sm text-gray-400 font-medium px-3 py-1.5">—</span>
                                        )}
                                    </td>
                                </tr>
                            )
                        })}
                        {filteredStaff.length === 0 && (
                            <tr><td colSpan={4} className="p-8 text-center text-gray-500">No staff members found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card List — visible only on small screens */}
            <div className="md:hidden divide-y divide-gray-100">
                {filteredStaff.map((user) => {
                    const isMe = user.id === currentUserId
                    const roleObj = Array.isArray(user.roles) ? user.roles[0] : user.roles
                    const roleName = roleObj?.name || ''
                    const isSuperAdmin = roleName === 'super_admin'
                    const canEdit = currentUserRole === 'super_admin' ? !isMe : (!isSuperAdmin && roleName !== 'manager' && !isMe)

                    return (
                        <div key={user.id} className="p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden shrink-0 border border-gray-200 flex items-center justify-center">
                                    {user.avatar_url ? (
                                        <Image src={user.avatar_url} alt={user.full_name} width={40} height={40} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-gray-500 font-medium text-sm">{user.full_name.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium text-gray-900 flex items-center gap-2 truncate">
                                        {user.full_name}
                                        {isMe && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 uppercase shrink-0">You</span>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700">
                                            {getRoleIcon(roleName)} {formatRoleName(roleName || 'Unknown')}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${user.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {user.is_active ? 'Active' : 'Suspended'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {canEdit && (
                                <div className="grid grid-cols-3 gap-2">
                                    <button disabled={submittingId === user.id} onClick={() => openEditModal(user)} className="py-2 text-sm font-medium text-gray-700 bg-gray-50 rounded-lg border border-gray-200 active:scale-95 transition flex items-center justify-center gap-1">
                                        <Pencil size={12} /> Edit
                                    </button>
                                    <button disabled={submittingId === user.id} onClick={() => setChangeRoleModal({ isOpen: true, user, newRoleId: user.role_id })} className="py-2 text-sm font-medium text-primary bg-primary/5 rounded-lg border border-primary/20 active:scale-95 transition">
                                        Role
                                    </button>
                                    <button disabled={submittingId === user.id} onClick={() => handleToggleStatus(user)} className={`py-2 text-sm font-medium rounded-lg border active:scale-95 transition ${user.is_active ? 'text-red-600 bg-red-50 border-red-200' : 'text-green-600 bg-green-50 border-green-200'}`}>
                                        {submittingId === user.id ? <Loader2 size={14} className="animate-spin mx-auto" /> : (user.is_active ? 'Suspend' : 'Activate')}
                                    </button>
                                </div>
                            )}
                        </div>
                    )
                })}
                {filteredStaff.length === 0 && (
                    <div className="p-8 text-center text-gray-500">No staff members found.</div>
                )}
            </div>

            {/* Edit Staff Modal */}
            {editModal.isOpen && editModal.user && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div>
                                <h3 className="font-bold text-gray-900">Edit Staff</h3>
                                <p className="text-xs text-gray-400 mt-0.5">{editModal.user.full_name}</p>
                            </div>
                            <button onClick={() => setEditModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">×</button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* Name */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-3">Display Name</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={editModal.fullName}
                                        onChange={e => setEditModal(prev => ({ ...prev, fullName: e.target.value }))}
                                        className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        placeholder="Full name"
                                    />
                                    <button
                                        onClick={handleSaveName}
                                        disabled={editModal.saving || editModal.fullName.trim() === editModal.user.full_name}
                                        className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-xl disabled:opacity-40 hover:opacity-90 transition flex items-center gap-1.5"
                                    >
                                        {editModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                        Save
                                    </button>
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-3">Reset Password</label>
                                <div className="space-y-2">
                                    <div className="relative">
                                        <input
                                            type={editModal.showPassword ? 'text' : 'password'}
                                            value={editModal.newPassword}
                                            onChange={e => setEditModal(prev => ({ ...prev, newPassword: e.target.value }))}
                                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary pr-10"
                                            placeholder="New password (min 8 chars)"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setEditModal(prev => ({ ...prev, showPassword: !prev.showPassword }))}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                                        >
                                            {editModal.showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                    </div>
                                    <input
                                        type={editModal.showPassword ? 'text' : 'password'}
                                        value={editModal.confirmPassword}
                                        onChange={e => setEditModal(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        placeholder="Confirm new password"
                                    />
                                    <button
                                        onClick={handleResetPassword}
                                        disabled={editModal.saving || !editModal.newPassword || editModal.newPassword !== editModal.confirmPassword}
                                        className="w-full py-2 text-sm font-semibold text-white bg-primary rounded-xl disabled:opacity-40 hover:opacity-90 transition flex items-center justify-center gap-2"
                                    >
                                        {editModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                        Update Password
                                    </button>
                                    {editModal.newPassword && editModal.confirmPassword && editModal.newPassword !== editModal.confirmPassword && (
                                        <p className="text-xs text-red-500">Passwords do not match</p>
                                    )}
                                </div>
                            </div>

                            {/* Danger zone */}
                            <div className="border border-red-100 rounded-xl p-4 bg-red-50/50">
                                <p className="text-sm font-semibold text-red-800 mb-1">Danger Zone</p>
                                <p className="text-xs text-red-600 mb-3">Permanently deletes the account and revokes all access. This cannot be undone.</p>
                                <button
                                    onClick={() => handleDeleteStaff(editModal.user!)}
                                    disabled={!!editModal.deletingId}
                                    className="flex items-center gap-2 text-sm font-semibold text-red-600 bg-white border border-red-200 px-4 py-2 rounded-xl hover:bg-red-50 active:scale-95 disabled:opacity-50 transition"
                                >
                                    {editModal.deletingId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    Delete Account Permanently
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Role Change Modal */}
            {changeRoleModal.isOpen && changeRoleModal.user && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="p-6">
                            <h3 className="text-lg font-extrabold text-gray-900 mb-2">Change Role</h3>
                            <p className="text-sm text-gray-500 mb-6">
                                Select a new role for <span className="font-semibold text-gray-900">{changeRoleModal.user.full_name}</span>.
                            </p>

                            <div className="space-y-3">
                                {availableRoles.map(role => (
                                    <label key={role.id} className={`flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors ${changeRoleModal.newRoleId === role.id ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'}`}>
                                        <input
                                            type="radio"
                                            name="role"
                                            value={role.id}
                                            checked={changeRoleModal.newRoleId === role.id}
                                            onChange={() => setChangeRoleModal({ ...changeRoleModal, newRoleId: role.id })}
                                            className="mt-1 text-primary focus:ring-primary"
                                        />
                                        <div>
                                            <div className="font-medium text-gray-900 flex items-center gap-2">
                                                {getRoleIcon(role.name)}
                                                {formatRoleName(role.name)}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">{role.description}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            {changeRoleModal.newRoleId === 1 && (
                                <div className="mt-4 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm flex items-start gap-2 border border-amber-200">
                                    <AlertTriangle size={18} className="shrink-0 text-amber-500" />
                                    <p>Warning: You are granting full Super Admin access. This user will have complete control over the system.</p>
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button onClick={() => setChangeRoleModal({ isOpen: false, user: null, newRoleId: 0 })} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50">
                                Cancel
                            </button>
                            <button
                                disabled={submittingId === changeRoleModal.user.id}
                                onClick={handleRoleChange}
                                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                            >
                                {submittingId === changeRoleModal.user.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Save Role
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Create Staff Modal */}
            {createModal.isOpen && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        {pinResult ? (
                            // ── PIN success panel ──
                            <div className="p-8 text-center">
                                <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-5 animate-in zoom-in-50 duration-300">
                                    <Check size={30} className="text-emerald-500" strokeWidth={3} />
                                </div>
                                <h3 className="text-lg font-extrabold text-gray-900">{pinResult.fullName} is all set!</h3>
                                <p className="text-sm text-gray-500 mt-1.5 mb-6 leading-relaxed">
                                    Share this PIN with them — they&apos;ll tap their name on the staff terminal and enter it to sign in.
                                </p>
                                <div className="flex justify-center gap-2.5 mb-6">
                                    {pinResult.pin.split('').map((digit, i) => (
                                        <div key={i} className="w-14 h-16 rounded-2xl bg-gray-50 border-2 border-gray-100 flex items-center justify-center text-3xl font-black text-gray-900 tabular-nums">
                                            {digit}
                                        </div>
                                    ))}
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(pinResult.pin); toast.success('PIN copied') }}
                                        className="flex-1 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <Copy size={14} /> Copy PIN
                                    </button>
                                    <button
                                        onClick={closeCreateModal}
                                        className="flex-1 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:opacity-90 transition-opacity"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="p-6 pb-0">
                                    <h3 className="text-lg font-extrabold text-gray-900 mb-2">Create Staff Account</h3>
                                    <p className="text-sm text-gray-500 mb-5">Add a new staff member to your restaurant.</p>

                                    {/* Login method toggle */}
                                    <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl mb-5">
                                        <button
                                            type="button"
                                            onClick={() => setCreateModal(prev => ({ ...prev, mode: 'pin', roleId: isPinEligibleRole(prev.roleId) ? prev.roleId : 4 }))}
                                            className={`py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${createModal.mode === 'pin' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            <KeyRound size={14} /> Quick PIN
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setCreateModal(prev => ({ ...prev, mode: 'email' }))}
                                            className={`py-2 rounded-lg text-sm font-semibold transition-all ${createModal.mode === 'email' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            Email &amp; Password
                                        </button>
                                    </div>
                                </div>

                                <div className="px-6 pb-6 space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name *</label>
                                        <input
                                            type="text"
                                            value={createModal.fullName}
                                            onChange={(e) => setCreateModal(prev => ({ ...prev, fullName: e.target.value }))}
                                            placeholder="John Doe"
                                            disabled={createModal.isCreating}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                        />
                                    </div>

                                    {createModal.mode === 'pin' ? (
                                        <>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Role</label>
                                                <select
                                                    value={createModal.roleId}
                                                    onChange={(e) => setCreateModal(prev => ({ ...prev, roleId: parseInt(e.target.value) }))}
                                                    disabled={createModal.isCreating}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                                >
                                                    {pinEligibleRoles.map(role => (
                                                        <option key={role.id} value={role.id}>{formatRoleName(role.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700 flex items-start gap-2 leading-relaxed">
                                                <KeyRound size={14} className="shrink-0 mt-0.5" />
                                                A random 4-digit PIN will be generated after you create the account. Staff sign in by tapping their name on the shared terminal and entering it — no email or password needed.
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address *</label>
                                                <input
                                                    type="email"
                                                    value={createModal.email}
                                                    onChange={(e) => setCreateModal(prev => ({ ...prev, email: e.target.value }))}
                                                    placeholder="john@example.com"
                                                    disabled={createModal.isCreating}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password *</label>
                                                <input
                                                    type="password"
                                                    value={createModal.password}
                                                    onChange={(e) => setCreateModal(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder="At least 8 characters"
                                                    disabled={createModal.isCreating}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number</label>
                                                <input
                                                    type="tel"
                                                    value={createModal.phone}
                                                    onChange={(e) => setCreateModal(prev => ({ ...prev, phone: e.target.value }))}
                                                    placeholder="123-456-7890"
                                                    disabled={createModal.isCreating}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Initial Role</label>
                                                <select
                                                    value={createModal.roleId}
                                                    onChange={(e) => setCreateModal(prev => ({ ...prev, roleId: parseInt(e.target.value) }))}
                                                    disabled={createModal.isCreating}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:bg-gray-50"
                                                >
                                                    {availableRoles.map(role => (
                                                        <option key={role.id} value={role.id}>{formatRoleName(role.name)}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                                    <button
                                        onClick={closeCreateModal}
                                        disabled={createModal.isCreating}
                                        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={createModal.mode === 'pin' ? handleCreateStaffPin : handleCreateStaff}
                                        disabled={createModal.isCreating}
                                        className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg shadow-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {createModal.isCreating
                                            ? <Loader2 size={16} className="animate-spin" />
                                            : createModal.mode === 'pin' ? <KeyRound size={16} /> : <Check size={16} />}
                                        {createModal.mode === 'pin' ? 'Generate PIN & Create' : 'Create Staff'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

        </div>
    )
}
