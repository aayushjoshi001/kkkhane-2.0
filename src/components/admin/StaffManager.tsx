'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Image from 'next/image'
import Modal from '@/components/ui/Modal'
import { Shield, ChefHat, Users, User, Check, AlertTriangle, Loader2, Pencil, Trash2, Eye, EyeOff, Banknote, Search, Mail, X, RotateCw, DollarSign, List, Plus, Calendar, TrendingUp } from 'lucide-react'
import { updateStaffRoleAction, toggleStaffStatusAction, updateStaffNameAction, resetStaffPasswordAction, deleteStaffAction, updateStaffSalaryAction, updateStaffJoinDateAction, increaseStaffSalaryAction, recordLedgerTransactionAction, fetchStaffLedgerAction, updateOpeningBalanceAction, fetchAutoAccrualPreviewAction, executeAutoAccrualAction } from '@/app/(admin)/admin/staff/actions'
import { fetchTodayAttendanceAction, markAttendanceAction } from '@/app/(admin)/admin/staff/attendance-actions'
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction, updateStaffDepartmentAction } from '@/app/(admin)/admin/staff/department-actions'
import { createInvitationAction, revokeInvitationAction, resendInvitationAction } from '@/app/(admin)/admin/staff/invite-actions'
import { toast } from 'react-hot-toast'
import { useConfirmStore } from '@/lib/stores/confirm'
import { fetchStaffData } from '@/lib/swr-fetchers'
import { useFeatures, useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { FINANCE_GATED_ROLES } from '@/types/database'
import { formatCurrency } from '@/lib/utils'
import PayPartyModal from '@/components/admin/PayPartyModal'
import { computeStaffCurrentDue, type StaffLedgerEntryType } from '@/lib/staffLedger'

// Ledger entry types that represent money actually paid out to staff (as opposed
// to 'accrual', which only increases what's owed, or 'deduction', which reduces it)
const PAY_ENTRY_TYPES = ['salary_payout', 'advance_payment', 'bonus']

function PasswordToggleInput({ value, onChange, placeholder, disabled, show, onToggleShow }: {
    value: string
    onChange: (value: string) => void
    placeholder: string
    disabled: boolean
    show: boolean
    onToggleShow: () => void
}) {
    return (
        <div className="relative">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50 pr-12"
            />
            <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink transition-colors p-1"
            >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    )
}

type StaffMember = {
    id: string
    full_name: string
    avatar_url: string | null
    is_active: boolean
    role_id: number
    email: string | null
    department_id: string | null
    monthly_salary: number
    opening_balance?: number   // optional until migration is applied
    join_date?: string | null   // optional until migration is applied; falls back to created_at
    created_at: string
    // Supabase can return arrays for joins depending on the query shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    departments: any
}

type Role = {
    id: number
    name: string
    description: string | null
}

export type Department = {
    id: string
    name: string
    description: string | null
}

export type Invitation = {
    id: string
    email: string
    role_id: number
    department_id: string | null
    status: 'pending' | 'accepted' | 'revoked' | 'expired'
    expires_at: string
    created_at: string
    // Supabase can return arrays for joins depending on the query shape
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    roles: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    departments: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    invited_by: any
}

interface LedgerEntry {
    id: string
    created_at: string
    entry_type: 'salary_payout' | 'advance_payment' | 'bonus' | 'deduction' | 'accrual'
    amount: number | string
    payment_method: 'cash' | 'bank_transfer' | 'qr_digital' | null
    note: string | null
}

interface AccrualPreviewItem {
    userId: string
    fullName: string
    joinedDate: string
    monthlySalary: number
    computedAmount: number
    daysWorked: number
    totalDaysInMonth: number
    note: string
    isProcessed: boolean
}


export default function StaffManager({
    initialStaff,
    roles,
    departments: initialDepartments,
    invitations: initialInvitations,
    currentUserRole,
    currentUserId,
    restaurantId,
    bankAccounts = []
}: {
    initialStaff: StaffMember[]
    roles: Role[]
    departments: Department[]
    invitations: Invitation[]
    currentUserRole: string
    currentUserId: string
    restaurantId: string
    bankAccounts?: Array<{ id: string; name: string; account_number: string | null }>
}) {
    const { data: staffData = { staff: initialStaff, departments: initialDepartments, invitations: initialInvitations }, mutate } = useSWR<{
        staff: StaffMember[];
        departments: Department[];
        invitations: Invitation[];
    }>(
        ['staff', restaurantId], 
        () => fetchStaffData(restaurantId), 
        { fallbackData: { staff: initialStaff, departments: initialDepartments, invitations: initialInvitations } }
    )
    const { staff, departments, invitations } = staffData

    const { data: attendanceData, mutate: mutateAttendance } = useSWR(
        ['staff-attendance', restaurantId],
        () => fetchTodayAttendanceAction(),
        { fallbackData: { date: '', attendance: {} } }
    )
    const attendanceMap = attendanceData.attendance

    const [activeTab, setActiveTab] = useState<'staff' | 'departments' | 'invitations' | 'salaries'>('staff')
    
    // Salaries & Ledger state
    const [salaryModal, setSalaryModal] = useState<{ isOpen: boolean, user: StaffMember | null, salary: string, saving: boolean }>({
        isOpen: false,
        user: null,
        salary: '',
        saving: false
    })

    const [joinDateModal, setJoinDateModal] = useState<{ isOpen: boolean, user: StaffMember | null, joinDate: string, saving: boolean }>({
        isOpen: false,
        user: null,
        joinDate: '',
        saving: false
    })

    const [salaryIncreaseModal, setSalaryIncreaseModal] = useState<{
        isOpen: boolean
        user: StaffMember | null
        newSalary: string
        effectiveFrom: string
        effectiveTo: string
        saving: boolean
    }>({
        isOpen: false,
        user: null,
        newSalary: '',
        effectiveFrom: '',
        effectiveTo: '',
        saving: false
    })

    // Deduction/Accrual only now — "Pay" (Salary/Advance/Bonus) is a real
    // Payment Voucher via PayPartyModal, since only those two are not an
    // actual payment leaving the business (accrual adds nothing paid yet;
    // deduction reduces what's owed without cash changing hands).
    const [transactionModal, setTransactionModal] = useState<{
        isOpen: boolean
        user: StaffMember | null
        entryType: 'deduction' | 'accrual'
        amount: string
        paymentMethod: 'cash' | 'bank_transfer' | 'qr_digital'
        note: string
        bankName: string
        saving: boolean
    }>({
        isOpen: false,
        user: null,
        entryType: 'accrual',
        amount: '',
        paymentMethod: 'cash',
        note: '',
        bankName: '',
        saving: false
    })

    // Pay (Salary Payout / Advance Payment / Bonus) — routes through the
    // shared voucher-connected modal instead of transactionModal, so it
    // gets a real voucher number, due-validation, and the print prompt.
    const [payPartyUser, setPayPartyUser] = useState<StaffMember | null>(null)

    const [ledgerModal, setLedgerModal] = useState<{
        isOpen: boolean
        user: StaffMember | null
        entries: LedgerEntry[]
        loading: boolean
        openingBalanceEdit: string
        savingOpeningBalance: boolean
        showOpeningBalanceEditor: boolean
    }>({
        isOpen: false,
        user: null,
        entries: [],
        loading: false,
        openingBalanceEdit: '',
        savingOpeningBalance: false,
        showOpeningBalanceEditor: false
    })

    const prevMonthDate = new Date()
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1)
    const [autoAccrualModal, setAutoAccrualModal] = useState<{
        isOpen: boolean
        year: number
        month: number
        previewData: AccrualPreviewItem[]
        loading: boolean
        saving: boolean
    }>({
        isOpen: false,
        year: prevMonthDate.getFullYear(),
        month: prevMonthDate.getMonth() + 1, // 1-12
        previewData: [],
        loading: false,
        saving: false
    })

    const [submittingId, setSubmittingId] = useState<string | null>(null)
    const [invitingId, setInvitingId] = useState<string | null>(null)
    const [markingAttendanceId, setMarkingAttendanceId] = useState<string | null>(null)
    // Once a staff member has been marked for today, their In/Out buttons are
    // locked behind an Edit action so they can't be re-clicked accidentally.
    const [editingAttendanceId, setEditingAttendanceId] = useState<string | null>(null)
    const [attendanceOutModal, setAttendanceOutModal] = useState<{ isOpen: boolean, user: StaffMember | null, reason: string, saving: boolean }>({
        isOpen: false,
        user: null,
        reason: '',
        saving: false
    })
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
        fullName: '',
        email: '',
        password: '',
        confirmPassword: '',
        showPassword: false,
        showConfirmPassword: false,
        phone: '',
        roleId: 4, // Default to waiter
        departmentId: '' as string,
        isCreating: false
    })

    const [inviteModal, setInviteModal] = useState({
        isOpen: false,
        email: '',
        roleId: 4, // Default to waiter
        departmentId: '' as string,
        isInviting: false
    })

    const [editModal, setEditModal] = useState<{
        isOpen: boolean
        user: StaffMember | null
        fullName: string
        departmentId: string | null
        newPassword: string
        confirmPassword: string
        showPassword: boolean
        saving: boolean
        deletingId: string | null
    }>({
        isOpen: false,
        user: null,
        fullName: '',
        departmentId: null,
        newPassword: '',
        confirmPassword: '',
        showPassword: false,
        saving: false,
        deletingId: null,
    })

    const [departmentModal, setDepartmentModal] = useState<{
        isOpen: boolean
        department: Department | null
        name: string
        description: string
        saving: boolean
    }>({
        isOpen: false,
        department: null,
        name: '',
        description: '',
        saving: false
    })

    const handleRoleChange = async () => {
        const user = changeRoleModal.user
        if (!user) return

        setSubmittingId(user.id)
        const res = await updateStaffRoleAction(user.id, changeRoleModal.newRoleId)

        if (res.success) {
            mutate()
            toast.success('Role updated')
        } else {
            toast.error(res.error || 'Failed to update role')
        }

        setSubmittingId(null)
        setChangeRoleModal({ isOpen: false, user: null, newRoleId: 0 })
    }

    const handleUpdateSalary = async () => {
        if (!salaryModal.user) return
        const val = parseFloat(salaryModal.salary)
        if (isNaN(val) || val < 0) {
            toast.error('Invalid salary amount')
            return
        }
        setSalaryModal(prev => ({ ...prev, saving: true }))
        try {
            const res = await updateStaffSalaryAction(salaryModal.user.id, val)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Salary updated successfully')
                setSalaryModal({ isOpen: false, user: null, salary: '', saving: false })
                mutate()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to update salary')
        } finally {
            setSalaryModal(prev => ({ ...prev, saving: false }))
        }
    }

    const handleUpdateJoinDate = async () => {
        if (!joinDateModal.user || !joinDateModal.joinDate) return
        setJoinDateModal(prev => ({ ...prev, saving: true }))
        try {
            const res = await updateStaffJoinDateAction(joinDateModal.user.id, joinDateModal.joinDate)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Join date updated successfully')
                setJoinDateModal({ isOpen: false, user: null, joinDate: '', saving: false })
                mutate()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to update join date')
        } finally {
            setJoinDateModal(prev => ({ ...prev, saving: false }))
        }
    }

    const handleIncreaseSalary = async () => {
        if (!salaryIncreaseModal.user) return
        const val = parseFloat(salaryIncreaseModal.newSalary)
        if (isNaN(val) || val < 0) {
            toast.error('Invalid salary amount')
            return
        }
        if (!salaryIncreaseModal.effectiveFrom) {
            toast.error('Start date is required')
            return
        }
        setSalaryIncreaseModal(prev => ({ ...prev, saving: true }))
        try {
            const res = await increaseStaffSalaryAction(
                salaryIncreaseModal.user.id,
                val,
                salaryIncreaseModal.effectiveFrom,
                salaryIncreaseModal.effectiveTo || null
            )
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Salary change recorded successfully')
                setSalaryIncreaseModal({ isOpen: false, user: null, newSalary: '', effectiveFrom: '', effectiveTo: '', saving: false })
                mutate()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to record salary change')
        } finally {
            setSalaryIncreaseModal(prev => ({ ...prev, saving: false }))
        }
    }

    const handleRecordTransaction = async () => {
        if (!transactionModal.user) return
        const amt = parseFloat(transactionModal.amount)
        if (isNaN(amt) || amt <= 0) {
            toast.error('Amount must be greater than zero')
            return
        }

        const isBank = transactionModal.paymentMethod === 'bank_transfer' || transactionModal.paymentMethod === 'qr_digital'
        if (isBank && bankAccounts.length > 0 && !transactionModal.bankName) {
            toast.error('Please select a bank account')
            return
        }
        
        setTransactionModal(prev => ({ ...prev, saving: true }))
        try {
            const res = await recordLedgerTransactionAction(
                transactionModal.user.id,
                amt,
                transactionModal.entryType,
                transactionModal.entryType === 'accrual' ? null : transactionModal.paymentMethod,
                transactionModal.note,
                isBank ? (transactionModal.bankName || 'General Bank') : undefined
            )
            
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Transaction recorded successfully')
                if ('warning' in res && res.warning) toast.error(res.warning)
                const userId = transactionModal.user.id
                setTransactionModal({
                    isOpen: false,
                    user: null,
                    entryType: 'accrual',
                    amount: '',
                    paymentMethod: 'cash',
                    note: '',
                    bankName: '',
                    saving: false
                })
                mutate()
                // If ledger modal is open for the same user, refresh its entries
                if (ledgerModal.isOpen && ledgerModal.user?.id === userId) {
                    try {
                        const data = await fetchStaffLedgerAction(userId)
                        setLedgerModal(p => ({
                            ...p,
                            entries: data.entries,
                            user: p.user ? { ...p.user, opening_balance: data.openingBalance, monthly_salary: data.monthlySalary } : null
                        }))
                    } catch {}
                }
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to record transaction')
        } finally {
            setTransactionModal(prev => ({ ...prev, saving: false }))
        }
    }

    // Called after PayPartyModal successfully records a Payment Voucher for
    // a staff member — refresh the staff list and, if open, the ledger
    // modal's entries so the new payout shows up immediately.
    const handlePaySettled = async () => {
        const userId = payPartyUser?.id
        mutate()
        if (userId && ledgerModal.isOpen && ledgerModal.user?.id === userId) {
            try {
                const data = await fetchStaffLedgerAction(userId)
                setLedgerModal(p => ({
                    ...p,
                    entries: data.entries,
                    user: p.user ? { ...p.user, opening_balance: data.openingBalance, monthly_salary: data.monthlySalary } : null
                }))
            } catch { /* non-fatal — list still refetches via mutate() */ }
        }
    }

    const handleOpenLedger = async (user: StaffMember) => {
        setLedgerModal({ isOpen: true, user, entries: [], loading: true, openingBalanceEdit: '', savingOpeningBalance: false, showOpeningBalanceEditor: false })
        try {
            const data = await fetchStaffLedgerAction(user.id)
            // Inject fresh opening_balance + monthly_salary from DB into the user object
            const freshUser: StaffMember = {
                ...user,
                opening_balance: data.openingBalance,
                monthly_salary: data.monthlySalary,
            }
            setLedgerModal({ isOpen: true, user: freshUser, entries: data.entries, loading: false, openingBalanceEdit: '', savingOpeningBalance: false, showOpeningBalanceEditor: !data.openingBalance })
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to fetch ledger')
            setLedgerModal(prev => ({ ...prev, loading: false }))
        }
    }

    const loadAutoAccrualPreview = async (yr: number, mth: number) => {
        setAutoAccrualModal(prev => ({ ...prev, loading: true, year: yr, month: mth }))
        try {
            const data = await fetchAutoAccrualPreviewAction(yr, mth)
            setAutoAccrualModal(prev => ({ ...prev, previewData: data, loading: false }))
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to load preview')
            setAutoAccrualModal(prev => ({ ...prev, loading: false }))
        }
    }

    const handleExecuteAutoAccrual = async () => {
        const toProcess = autoAccrualModal.previewData.filter(p => !p.isProcessed && p.computedAmount > 0)
        if (toProcess.length === 0) {
            toast.error('No pending accruals to process')
            return
        }

        const isOk = await confirm({
            title: 'Confirm Bulk Accrual?',
            message: `This will record salary accruals for ${toProcess.length} staff members for ${new Date(autoAccrualModal.year, autoAccrualModal.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}. This cannot be undone.`,
            confirmText: 'Accrue Salaries'
        })
        if (!isOk) return

        setAutoAccrualModal(prev => ({ ...prev, saving: true }))
        try {
            const res = await executeAutoAccrualAction(
                autoAccrualModal.year,
                autoAccrualModal.month,
                toProcess.map(p => ({
                    userId: p.userId,
                    amount: p.computedAmount,
                    note: p.note
                }))
            )
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Salaries processed and accrued successfully')
                setAutoAccrualModal(prev => ({ ...prev, isOpen: false }))
                mutate()
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Failed to process accruals')
        } finally {
            setAutoAccrualModal(prev => ({ ...prev, saving: false }))
        }
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
            mutate()
            toast.success(user.is_active ? 'User suspended' : 'User activated')
        } else {
            toast.error(res.error || 'Failed to update status')
        }
        setSubmittingId(null)
    }

    const handleMarkPresent = async (user: StaffMember) => {
        const isOk = await confirm({
            title: 'Mark Present?',
            message: `Mark ${user.full_name} as present for today?`,
            confirmText: 'Mark Present',
            isDestructive: false
        })
        if (!isOk) return

        setMarkingAttendanceId(user.id)
        const res = await markAttendanceAction(user.id, 'present')
        if (res.error) {
            toast.error(res.error)
        } else {
            toast.success(`${user.full_name} marked present`)
            mutateAttendance()
            setEditingAttendanceId(null)
        }
        setMarkingAttendanceId(null)
    }

    const openMarkAbsentModal = (user: StaffMember) => {
        setAttendanceOutModal({ isOpen: true, user, reason: '', saving: false })
    }

    const handleConfirmAbsent = async () => {
        if (!attendanceOutModal.user) return
        setAttendanceOutModal(prev => ({ ...prev, saving: true }))
        const res = await markAttendanceAction(attendanceOutModal.user.id, 'absent', attendanceOutModal.reason.trim() || undefined)
        if (res.error) {
            toast.error(res.error)
            setAttendanceOutModal(prev => ({ ...prev, saving: false }))
        } else {
            toast.success(`${attendanceOutModal.user.full_name} marked absent`)
            mutateAttendance()
            setEditingAttendanceId(null)
            setAttendanceOutModal({ isOpen: false, user: null, reason: '', saving: false })
        }
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

        if (createModal.password !== createModal.confirmPassword) {
            toast.error('Passwords do not match')
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
                    department_id: createModal.departmentId || undefined,
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
                mutate()
            }

            toast.success(data.message || 'Staff member created successfully')
            setCreateModal({
                isOpen: false,
                fullName: '',
                email: '',
                password: '',
                confirmPassword: '',
                showPassword: false,
                showConfirmPassword: false,
                phone: '',
                roleId: 4,
                departmentId: '',
                isCreating: false
            })
        } catch (error) {
            console.error('Staff creation error:', error)
            toast.error('An error occurred while creating staff')
        } finally {
            setCreateModal(prev => ({ ...prev, isCreating: false }))
        }
    }

    const closeCreateModal = () => {
        setCreateModal({ isOpen: false, fullName: '', email: '', password: '', confirmPassword: '', showPassword: false, showConfirmPassword: false, phone: '', roleId: 4, departmentId: '', isCreating: false })
    }

    const handleSendInvite = async () => {
        if (!inviteModal.email.trim()) {
            toast.error('Please enter an email address')
            return
        }

        setInviteModal(prev => ({ ...prev, isInviting: true }))
        const res = await createInvitationAction({
            email: inviteModal.email.trim(),
            roleId: inviteModal.roleId,
            departmentId: inviteModal.departmentId || null,
        })
        setInviteModal(prev => ({ ...prev, isInviting: false }))

        if (!res.success) {
            toast.error(res.error || 'Failed to send invitation')
            return
        }

        if (res.invitation) {
            mutate()
        }
        toast.success(`Invitation sent to ${inviteModal.email.trim()}`)
        setInviteModal({ isOpen: false, email: '', roleId: 4, departmentId: '', isInviting: false })
    }

    const handleRevokeInvite = async (invitation: Invitation) => {
        const ok = await confirm({
            title: 'Revoke Invitation?',
            message: `The invite link sent to ${invitation.email} will stop working.`,
            confirmText: 'Revoke',
            isDestructive: true,
        })
        if (!ok) return

        setInvitingId(invitation.id)
        const res = await revokeInvitationAction(invitation.id)
        if (res.success) {
            mutate()
            toast.success('Invitation revoked')
        } else {
            toast.error(res.error || 'Failed to revoke invitation')
        }
        setInvitingId(null)
    }

    const handleResendInvite = async (invitation: Invitation) => {
        setInvitingId(invitation.id)
        const res = await resendInvitationAction(invitation.id)
        if (res.success && res.invitation) {
            mutate()
            toast.success(`Invitation resent to ${invitation.email}`)
        } else {
            toast.error(res.error || 'Failed to resend invitation')
        }
        setInvitingId(null)
    }

    const openEditModal = (user: StaffMember) => {
        setEditModal({ isOpen: true, user, fullName: user.full_name, departmentId: user.department_id, newPassword: '', confirmPassword: '', showPassword: false, saving: false, deletingId: null })
    }

    const handleSaveProfile = async () => {
        if (!editModal.user) return
        setEditModal(prev => ({ ...prev, saving: true }))
        
        let success = true
        
        if (editModal.fullName.trim() !== editModal.user.full_name) {
            const res = await updateStaffNameAction(editModal.user.id, editModal.fullName)
            if (res.success) {
                mutate()
            } else {
                toast.error(res.error || 'Failed to update name')
                success = false
            }
        }
        
        if (editModal.departmentId !== editModal.user.department_id) {
            const res = await updateStaffDepartmentAction(editModal.user.id, editModal.departmentId)
            if (res.success) {
                mutate()
            } else {
                toast.error(res.error || 'Failed to update department')
                success = false
            }
        }

        if (success) toast.success('Profile updated')
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
            title: 'Delete Account?',
            message: `This will remove ${user.full_name}'s account and all their access. Their payroll, salary and attendance records are kept for your books. This cannot be undone.`,
            confirmText: 'Delete Account',
            isDestructive: true,
        })
        if (!ok) return
        setEditModal(prev => ({ ...prev, deletingId: user.id }))
        const res = await deleteStaffAction(user.id)
        if (res.success) {
            mutate()
            setEditModal({ isOpen: false, user: null, fullName: '', departmentId: null, newPassword: '', confirmPassword: '', showPassword: false, saving: false, deletingId: null })
            toast.success(`${user.full_name} has been removed`)
        } else {
            toast.error(res.error || 'Failed to delete account')
            setEditModal(prev => ({ ...prev, deletingId: null }))
        }
    }

    const handleSaveDepartment = async () => {
        if (!departmentModal.name.trim()) {
            toast.error('Department name is required')
            return
        }
        setDepartmentModal(prev => ({ ...prev, saving: true }))
        
        if (departmentModal.department) {
            const res = await updateDepartmentAction(departmentModal.department.id, departmentModal.name, departmentModal.description)
            if (res.success) {
                mutate()
                toast.success('Department updated')
                setDepartmentModal({ isOpen: false, department: null, name: '', description: '', saving: false })
            } else {
                toast.error(res.error || 'Failed to update department')
                setDepartmentModal(prev => ({ ...prev, saving: false }))
            }
        } else {
            const res = await createDepartmentAction(departmentModal.name, departmentModal.description)
            if (res.success && res.department) {
                mutate()
                toast.success('Department created')
                setDepartmentModal({ isOpen: false, department: null, name: '', description: '', saving: false })
            } else {
                toast.error(res.error || 'Failed to create department')
                setDepartmentModal(prev => ({ ...prev, saving: false }))
            }
        }
    }

    const handleDeleteDepartment = async (dept: Department) => {
        const staffInDept = staff.filter(s => s.department_id === dept.id).length
        
        const ok = await confirm({
            title: 'Delete Department?',
            message: `Are you sure you want to delete ${dept.name}?${staffInDept > 0 ? ` ${staffInDept} staff members will be unassigned from this department.` : ''}`,
            confirmText: 'Delete Department',
            isDestructive: true,
        })
        if (!ok) return
        
        const res = await deleteDepartmentAction(dept.id)
        if (res.success) {
            mutate()
            toast.success('Department deleted')
        } else {
            toast.error(res.error || 'Failed to delete department')
        }
    }

    const formatRoleName = (name: string) => {
        return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
    }

    const getRoleIcon = (roleName: string) => {
        switch (roleName) {
            case 'super_admin': return <Shield size={16} className="text-purple-500" />
            case 'manager': return <Users size={16} className="text-blue-500" />
            case 'kitchen': return <ChefHat size={16} className="text-brand-500" />
            case 'waiter': return <User size={16} className="text-green-500" />
            case 'cashier': return <Banknote size={16} className="text-emerald-500" />
            default: return <User size={16} className="text-ink-subtle" />
        }
    }

    const { financeEnabled } = useFeatures()
    const bsEnabled = useFeatureEnabled('bsDateEnabled')

    // Business Logic: only super_admin can assign super_admin, and the
    // finance/receptionist roles require the enterprise finance plan.
    const availableRoles = roles.filter(r => {
        if (r.name === 'customer') return false
        if (r.name === 'super_admin' && currentUserRole !== 'super_admin') return false
        if (!financeEnabled && (FINANCE_GATED_ROLES as readonly string[]).includes(r.name)) return false
        return true
    })

    const formatInviteStatus = (invitation: Invitation) => {
        if (invitation.status === 'pending' && new Date(invitation.expires_at) < new Date()) return 'expired'
        return invitation.status
    }

    return (
        <div className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden">
            <div className="p-5 md:p-6 border-b border-hairline flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-surface-muted/30">
                <div>
                    <h3 className="text-h3 font-extrabold text-ink">Staff Management</h3>
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1.5">Manage accounts, roles, and departments</p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    {activeTab === 'staff' && (
                        <>
                            <button
                                onClick={() => setInviteModal(prev => ({ ...prev, isOpen: true }))}
                                className="px-4 py-2.5 text-xs font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors flex items-center gap-2 shrink-0 focus-ring"
                            >
                                <Mail size={16} />
                                <span className="hidden sm:inline">Invite via Email</span>
                            </button>
                            <button
                                onClick={() => setCreateModal(prev => ({ ...prev, isOpen: true }))}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 shrink-0 focus-ring"
                            >
                                <Users size={16} />
                                Add Staff
                            </button>
                        </>
                    )}
                    {activeTab === 'departments' && (
                        <button
                            onClick={() => setDepartmentModal({ isOpen: true, department: null, name: '', description: '', saving: false })}
                            className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 shrink-0 focus-ring"
                        >
                            <Check size={16} />
                            Add Department
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex px-5 md:px-6 border-b border-hairline bg-surface">
                <button
                    onClick={() => setActiveTab('staff')}
                    className={`py-3.5 px-1 mr-6 text-sm font-bold border-b-2 transition-colors ${activeTab === 'staff' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                >
                    Team Roster ({staff.length})
                </button>
                <button
                    onClick={() => setActiveTab('departments')}
                    className={`py-3.5 px-1 mr-6 text-sm font-bold border-b-2 transition-colors ${activeTab === 'departments' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                >
                    Departments ({departments.length})
                </button>
                <button
                    onClick={() => setActiveTab('invitations')}
                    className={`py-3.5 px-1 mr-6 text-sm font-bold border-b-2 transition-colors ${activeTab === 'invitations' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                >
                    Invitations ({invitations.filter(i => formatInviteStatus(i) === 'pending').length})
                </button>
                <button
                    onClick={() => setActiveTab('salaries')}
                    className={`py-3.5 px-1 text-sm font-bold border-b-2 transition-colors ${activeTab === 'salaries' ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                >
                    Staff Payments
                </button>
            </div>

            {activeTab === 'staff' && (
                <>
                    {/* Filters */}
            <div className="px-5 md:px-6 py-4 border-b border-hairline flex flex-col sm:flex-row gap-4 bg-surface">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                        type="text"
                        placeholder="Search staff by name..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-[var(--r-md)] border border-hairline bg-surface text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                    />
                </div>
                <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] sm:w-56"
                >
                    <option value="all">All Roles</option>
                    {availableRoles.map(r => (
                        <option key={r.id} value={r.id.toString()}>{formatRoleName(r.name)}</option>
                    ))}
                </select>
            </div>

            {/* Desktop Table — hidden on mobile */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left whitespace-nowrap">
                    <thead>
                        <tr className="bg-surface-muted border-b border-hairline text-[11px] font-bold text-ink-subtle uppercase tracking-wider">
                            <th className="px-6 py-4">Staff Member</th>
                            <th className="px-6 py-4">System Role</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Department</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                            <th className="px-6 py-4 text-center">Attendance</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {filteredStaff.map((user) => {
                            const isMe = user.id === currentUserId
                            const roleObj = Array.isArray(user.roles) ? user.roles[0] : user.roles
                            const roleName = roleObj?.name || ''
                            const isSuperAdmin = roleName === 'super_admin'
                            const canEdit = currentUserRole === 'super_admin' ? !isMe : (!isSuperAdmin && roleName !== 'manager' && !isMe)
                            const attendance = attendanceMap[user.id]
                            const isPresent = attendance?.status === 'present'
                            const isAbsent = attendance?.status === 'absent'
                            const isMarkingAttendance = markingAttendanceId === user.id
                            const isAttendanceLocked = !!attendance && editingAttendanceId !== user.id

                            return (
                                <tr key={user.id} className="hover:bg-surface-muted/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-surface-muted overflow-hidden shrink-0 border border-hairline flex items-center justify-center shadow-sm">
                                                {user.avatar_url ? (
                                                    <Image src={user.avatar_url} alt={user.full_name} width={40} height={40} className="w-full h-full object-cover" />
                                                ) : (
                                                    <span className="text-ink-subtle font-extrabold text-sm">
                                                        {user.full_name.charAt(0).toUpperCase()}
                                                    </span>
                                                )}
                                            </div>
                                            <div>
                                                <div className="font-extrabold text-ink flex items-center gap-2">
                                                    {user.full_name}
                                                    {isMe && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-50 text-brand-700 uppercase tracking-wider border border-brand-100">You</span>}
                                                </div>
                                                <div className="text-[11px] text-ink-subtle font-mono mt-0.5 uppercase tracking-wider">ID: {user.id.substring(0, 8)}...</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-hairline text-xs font-bold text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                            {getRoleIcon(roleName)}
                                            {formatRoleName(roleName || 'Unknown')}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${user.is_active ? 'bg-success-bg/20 text-success-fg border-success-bg' : 'bg-danger-bg/20 text-danger-fg border-danger-bg'}`}>
                                            {user.is_active ? 'Active' : 'Suspended'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {user.departments ? (
                                            <span className="text-sm font-bold text-ink">{user.departments.name}</span>
                                        ) : (
                                            <span className="text-sm font-bold text-ink-muted italic">Unassigned</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        {canEdit ? (
                                            <div className="flex items-center justify-end gap-2">
                                                <button disabled={submittingId === user.id} onClick={() => openEditModal(user)} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-subtle px-3 py-2 rounded-[var(--r-md)] hover:bg-surface-muted hover:text-ink transition-colors focus-ring">
                                                    <Pencil size={14} /> Edit
                                                </button>
                                                <button disabled={submittingId === user.id} onClick={() => setChangeRoleModal({ isOpen: true, user, newRoleId: user.role_id })} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-600 px-3 py-2 rounded-[var(--r-md)] hover:bg-brand-50 transition-colors focus-ring">
                                                    Role
                                                </button>
                                                <button disabled={submittingId === user.id} onClick={() => handleToggleStatus(user)} className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-[var(--r-md)] transition-colors focus-ring ${user.is_active ? 'text-danger-fg hover:bg-danger-bg/20' : 'text-success-fg hover:bg-success-bg/20'}`}>
                                                    {submittingId === user.id ? <Loader2 size={14} className="animate-spin inline" /> : (user.is_active ? 'Suspend' : 'Activate')}
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-sm text-ink-muted font-bold px-3 py-1.5">—</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col items-center gap-1">
                                            {isAttendanceLocked ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-[11px] uppercase tracking-wider font-black ${isPresent ? 'text-success-fg' : 'text-danger-fg'}`}>
                                                        {isPresent ? 'Present' : 'Absent'}
                                                    </span>
                                                    <button
                                                        onClick={() => setEditingAttendanceId(user.id)}
                                                        className="text-ink-subtle hover:text-brand-500 p-1 rounded hover:bg-surface-muted transition"
                                                    >
                                                        <Pencil size={12} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            disabled={isMarkingAttendance}
                                                            onClick={() => handleMarkPresent(user)}
                                                            className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-[var(--r-sm)] border transition disabled:opacity-50 ${isPresent ? 'bg-success-bg/30 text-success-fg border-success-bg' : 'bg-surface text-ink-subtle border-hairline hover:bg-surface-muted'}`}
                                                        >
                                                            In
                                                        </button>
                                                        <button
                                                            disabled={isMarkingAttendance}
                                                            onClick={() => openMarkAbsentModal(user)}
                                                            className={`px-3 py-1.5 text-[11px] font-black uppercase tracking-wider rounded-[var(--r-sm)] border transition disabled:opacity-50 ${isAbsent ? 'bg-danger-bg/30 text-danger-fg border-danger-bg' : 'bg-surface text-ink-subtle border-hairline hover:bg-surface-muted'}`}
                                                        >
                                                            Out
                                                        </button>
                                                        {attendance && (
                                                            <button
                                                                onClick={() => setEditingAttendanceId(null)}
                                                                title="Cancel edit"
                                                                className="text-ink-subtle hover:text-ink p-1 rounded hover:bg-surface-muted transition"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                    <span className={`text-[9px] uppercase tracking-wider font-bold ${isPresent ? 'text-success-fg' : 'text-danger-fg'}`}>
                                                        {isPresent ? 'Present' : 'Absent'}
                                                    </span>
                                                </>
                                            )}
                                            {isAbsent && attendance?.reason && (
                                                <span className="text-[10px] text-ink-muted italic max-w-[140px] truncate" title={attendance.reason}>{attendance.reason}</span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )
                        })}
                        {filteredStaff.length === 0 && (
                            <tr><td colSpan={6} className="p-8 text-center text-ink-subtle font-bold italic">No staff members found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card List — visible only on small screens */}
            <div className="md:hidden divide-y divide-hairline">
                {filteredStaff.map((user) => {
                    const isMe = user.id === currentUserId
                    const roleObj = Array.isArray(user.roles) ? user.roles[0] : user.roles
                    const roleName = roleObj?.name || ''
                    const isSuperAdmin = roleName === 'super_admin'
                    const canEdit = currentUserRole === 'super_admin' ? !isMe : (!isSuperAdmin && roleName !== 'manager' && !isMe)
                    const attendance = attendanceMap[user.id]
                    const isPresent = attendance?.status === 'present'
                    const isAbsent = attendance?.status === 'absent'
                    const isMarkingAttendance = markingAttendanceId === user.id
                    const isAttendanceLocked = !!attendance && editingAttendanceId !== user.id

                    return (
                        <div key={user.id} className="p-5 space-y-4">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-surface-muted overflow-hidden shrink-0 border border-hairline flex items-center justify-center shadow-sm">
                                    {user.avatar_url ? (
                                        <Image src={user.avatar_url} alt={user.full_name} width={48} height={48} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-ink-subtle font-extrabold text-base">{user.full_name.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-extrabold text-ink flex items-center gap-2 min-w-0">
                                        <span className="truncate">{user.full_name}</span>
                                        {isMe && <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-brand-50 text-brand-700 uppercase border border-brand-100 shrink-0">You</span>}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface border border-hairline text-[11px] font-bold text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                            {getRoleIcon(roleName)} {formatRoleName(roleName || 'Unknown')}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${user.is_active ? 'bg-success-bg/20 text-success-fg border-success-bg' : 'bg-danger-bg/20 text-danger-fg border-danger-bg'}`}>
                                            {user.is_active ? 'Active' : 'Suspended'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            {canEdit && (
                                <div className="grid grid-cols-3 gap-2">
                                    <button disabled={submittingId === user.id} onClick={() => openEditModal(user)} className="py-2.5 text-[11px] uppercase tracking-wider font-bold text-ink bg-surface rounded-[var(--r-md)] border border-hairline active:scale-95 transition flex items-center justify-center gap-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                                        <Pencil size={14} /> Edit
                                    </button>
                                    <button disabled={submittingId === user.id} onClick={() => setChangeRoleModal({ isOpen: true, user, newRoleId: user.role_id })} className="py-2.5 text-[11px] uppercase tracking-wider font-bold text-brand-600 bg-brand-50 rounded-[var(--r-md)] active:scale-95 transition border border-brand-100">
                                        Role
                                    </button>
                                    <button disabled={submittingId === user.id} onClick={() => handleToggleStatus(user)} className={`py-2.5 text-[11px] uppercase tracking-wider font-bold rounded-[var(--r-md)] border active:scale-95 transition ${user.is_active ? 'text-danger-fg bg-danger-bg/20 border-danger-bg' : 'text-success-fg bg-success-bg/20 border-success-bg'}`}>
                                        {submittingId === user.id ? <Loader2 size={14} className="animate-spin mx-auto" /> : (user.is_active ? 'Suspend' : 'Activate')}
                                    </button>
                                </div>
                            )}
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider shrink-0">Attendance</span>
                                {isAttendanceLocked ? (
                                    <>
                                        <span className={`text-[11px] uppercase tracking-wider font-black ${isPresent ? 'text-success-fg' : 'text-danger-fg'}`}>
                                            {isPresent ? 'Present' : 'Absent'}
                                        </span>
                                        <button
                                            onClick={() => setEditingAttendanceId(user.id)}
                                            className="text-ink-subtle hover:text-brand-500 p-1 rounded hover:bg-surface-muted transition"
                                        >
                                            <Pencil size={12} />
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            disabled={isMarkingAttendance}
                                            onClick={() => handleMarkPresent(user)}
                                            className={`flex-1 py-2 text-[11px] uppercase tracking-wider font-bold rounded-[var(--r-md)] border active:scale-95 transition disabled:opacity-50 ${isPresent ? 'bg-success-bg/30 text-success-fg border-success-bg' : 'bg-surface text-ink-subtle border-hairline'}`}
                                        >
                                            In
                                        </button>
                                        <button
                                            disabled={isMarkingAttendance}
                                            onClick={() => openMarkAbsentModal(user)}
                                            className={`flex-1 py-2 text-[11px] uppercase tracking-wider font-bold rounded-[var(--r-md)] border active:scale-95 transition disabled:opacity-50 ${isAbsent ? 'bg-danger-bg/30 text-danger-fg border-danger-bg' : 'bg-surface text-ink-subtle border-hairline'}`}
                                        >
                                            Out
                                        </button>
                                        {attendance && (
                                            <button
                                                onClick={() => setEditingAttendanceId(null)}
                                                title="Cancel edit"
                                                className="text-ink-subtle hover:text-ink p-1 rounded hover:bg-surface-muted transition shrink-0"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                        <span className={`text-[10px] uppercase tracking-wider font-bold shrink-0 ${isPresent ? 'text-success-fg' : 'text-danger-fg'}`}>
                                            {isPresent ? 'Present' : 'Absent'}
                                        </span>
                                    </>
                                )}
                            </div>
                            {isAbsent && attendance?.reason && (
                                <p className="text-[11px] text-ink-muted italic">Reason: {attendance.reason}</p>
                            )}
                        </div>
                    )
                })}
                {filteredStaff.length === 0 && (
                    <div className="p-8 text-center text-ink-subtle font-bold italic">No staff members found.</div>
                )}
            </div>
            </>
            )}

            {activeTab === 'departments' && (
                <div className="divide-y divide-hairline">
                    {departments.length === 0 ? (
                        <div className="p-12 text-center">
                            <div className="w-16 h-16 rounded-full bg-surface-muted border border-hairline flex items-center justify-center mx-auto mb-4">
                                <Users size={24} className="text-ink-subtle" />
                            </div>
                            <h4 className="text-lg font-extrabold text-ink mb-2">No Departments Yet</h4>
                            <p className="text-sm font-medium text-ink-subtle max-w-md mx-auto mb-6">Create departments like &quot;Kitchen&quot;, &quot;Front of House&quot;, or &quot;Delivery&quot; to organize your staff better.</p>
                            <button
                                onClick={() => setDepartmentModal({ isOpen: true, department: null, name: '', description: '', saving: false })}
                                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] transition-all"
                            >
                                <Check size={16} /> Create Department
                            </button>
                        </div>
                    ) : (
                        <div className="p-5 md:p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {departments.map(dept => {
                                const staffCount = staff.filter(s => s.department_id === dept.id).length
                                return (
                                    <div key={dept.id} className="p-5 rounded-card bg-surface border border-hairline shadow-sm hover:shadow-md transition-shadow group relative">
                                        <div className="flex justify-between items-start mb-3">
                                            <h4 className="font-extrabold text-ink text-lg">{dept.name}</h4>
                                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => setDepartmentModal({ isOpen: true, department: dept, name: dept.name, description: dept.description || '', saving: false })}
                                                    className="p-1.5 text-ink-subtle hover:text-ink hover:bg-surface-muted rounded-md transition-colors"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteDepartment(dept)}
                                                    className="p-1.5 text-danger-fg/70 hover:text-danger-fg hover:bg-danger-bg/20 rounded-md transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        {dept.description && <p className="text-sm text-ink-subtle mb-4 line-clamp-2">{dept.description}</p>}
                                        <div className="flex items-center gap-2 mt-auto pt-4 border-t border-hairline">
                                            <Users size={14} className="text-brand-500" />
                                            <span className="text-xs font-bold text-ink">{staffCount} member{staffCount !== 1 ? 's' : ''}</span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'invitations' && (
                <div className="divide-y divide-hairline">
                    {invitations.length === 0 ? (
                        <div className="p-12 text-center">
                            <div className="w-16 h-16 rounded-full bg-surface-muted border border-hairline flex items-center justify-center mx-auto mb-4">
                                <Mail size={24} className="text-ink-subtle" />
                            </div>
                            <h4 className="text-lg font-extrabold text-ink mb-2">No Invitations Yet</h4>
                            <p className="text-sm font-medium text-ink-subtle max-w-md mx-auto mb-6">Invite someone by email — they&apos;ll get a link to set their own password and join as staff.</p>
                            <button
                                onClick={() => setInviteModal(prev => ({ ...prev, isOpen: true }))}
                                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] transition-all"
                            >
                                <Mail size={16} /> Invite via Email
                            </button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left whitespace-nowrap">
                                <thead>
                                    <tr className="bg-surface-muted border-b border-hairline text-[11px] font-bold text-ink-subtle uppercase tracking-wider">
                                        <th className="px-6 py-4">Email</th>
                                        <th className="px-6 py-4">Role</th>
                                        <th className="px-6 py-4">Department</th>
                                        <th className="px-6 py-4">Status</th>
                                        <th className="px-6 py-4">Expires</th>
                                        <th className="px-6 py-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                    {invitations.map(invitation => {
                                        const status = formatInviteStatus(invitation)
                                        const roleObj = Array.isArray(invitation.roles) ? invitation.roles[0] : invitation.roles
                                        const deptObj = Array.isArray(invitation.departments) ? invitation.departments[0] : invitation.departments
                                        const statusStyle = status === 'pending'
                                            ? 'bg-brand-50 text-brand-700 border-brand-100'
                                            : status === 'accepted'
                                                ? 'bg-success-bg/20 text-success-fg border-success-bg'
                                                : 'bg-danger-bg/20 text-danger-fg border-danger-bg'

                                        return (
                                            <tr key={invitation.id} className="hover:bg-surface-muted/30 transition-colors">
                                                <td className="px-6 py-4 font-extrabold text-ink">{invitation.email}</td>
                                                <td className="px-6 py-4">
                                                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-hairline text-xs font-bold text-ink shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                                                        {getRoleIcon(roleObj?.name || '')}
                                                        {formatRoleName(roleObj?.name || 'Unknown')}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {deptObj ? (
                                                        <span className="text-sm font-bold text-ink">{deptObj.name}</span>
                                                    ) : (
                                                        <span className="text-sm font-bold text-ink-muted italic">Unassigned</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusStyle}`}>
                                                        {status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-bold text-ink-subtle">
                                                    {new Date(invitation.expires_at).toLocaleDateString()}
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        {status === 'pending' && (
                                                            <button disabled={invitingId === invitation.id} onClick={() => handleRevokeInvite(invitation)} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-danger-fg px-3 py-2 rounded-[var(--r-md)] hover:bg-danger-bg/20 transition-colors focus-ring">
                                                                <X size={14} /> Revoke
                                                            </button>
                                                        )}
                                                        {(status === 'expired' || status === 'revoked') && (
                                                            <button disabled={invitingId === invitation.id} onClick={() => handleResendInvite(invitation)} className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-600 px-3 py-2 rounded-[var(--r-md)] hover:bg-brand-50 transition-colors focus-ring">
                                                                {invitingId === invitation.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />} Resend
                                                            </button>
                                                        )}
                                                        {status === 'accepted' && (
                                                            <span className="text-sm text-ink-muted font-bold px-3 py-1.5">—</span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'salaries' && (
                <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-sm animate-in fade-in duration-200">
                    <div className="px-5 md:px-6 py-4 border-b border-hairline bg-surface flex items-center justify-between gap-4">
                        <div className="relative w-full max-w-md">
                            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
                            <input
                                type="text"
                                placeholder="Search staff by name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 rounded-[var(--r-md)] border border-hairline bg-surface text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            />
                        </div>
                        <button
                            onClick={() => {
                                const yr = autoAccrualModal.year
                                const mth = autoAccrualModal.month
                                setAutoAccrualModal(prev => ({ ...prev, isOpen: true }))
                                loadAutoAccrualPreview(yr, mth)
                            }}
                            className="px-4 py-2.5 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.15)] whitespace-nowrap"
                        >
                            <DollarSign size={14} />
                            Process Monthly Salaries
                        </button>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left whitespace-nowrap">
                            <thead>
                                <tr className="bg-surface-muted border-b border-hairline text-[11px] font-bold text-ink-subtle uppercase tracking-wider">
                                    <th className="px-6 py-4">Staff Member</th>
                                    <th className="px-6 py-4">Role</th>
                                    <th className="px-6 py-4">Join Date</th>
                                    <th className="px-6 py-4 text-right">Monthly Salary</th>
                                    <th className="px-6 py-4 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                                {filteredStaff.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-sm font-bold text-ink-muted bg-surface-muted/10">
                                            No staff members found
                                        </td>
                                    </tr>
                                ) : (
                                    filteredStaff.map((user) => {
                                        const roleName = formatRoleName(user.roles?.name || '')
                                        return (
                                            <tr key={user.id} className="hover:bg-surface-muted/10 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-[var(--r-md)] bg-brand-50 border border-brand-100 flex items-center justify-center text-brand-600 font-black relative overflow-hidden shrink-0 shadow-sm">
                                                            {user.avatar_url ? (
                                                                <Image src={user.avatar_url} alt={user.full_name} fill className="object-cover" />
                                                            ) : (
                                                                user.full_name.charAt(0).toUpperCase()
                                                            )}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-black text-ink">{user.full_name}</div>
                                                            <div className="text-[11px] text-ink-subtle mt-0.5">{user.email}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-sm font-bold text-ink-muted">
                                                    {roleName}
                                                </td>
                                                <td className="px-6 py-4 text-sm font-bold text-ink">
                                                    {user.join_date ? (
                                                        <div className="flex items-center gap-1.5">
                                                            <span>{new Date(user.join_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>
                                                            <button
                                                                onClick={() => setJoinDateModal({ isOpen: true, user, joinDate: user.join_date || '', saving: false })}
                                                                className="text-ink-subtle hover:text-brand-500 p-1 rounded hover:bg-surface-muted transition"
                                                            >
                                                                <Pencil size={12} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setJoinDateModal({ isOpen: true, user, joinDate: '', saving: false })}
                                                            className="text-xs font-bold text-brand-600 hover:underline inline-flex items-center gap-1"
                                                        >
                                                            <Calendar size={12} /> Set Join Date
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right text-sm font-black text-ink">
                                                    {user.monthly_salary > 0 ? (
                                                        <div className="flex items-center justify-end gap-1.5">
                                                            <span>{formatCurrency(user.monthly_salary)}</span>
                                                            <button 
                                                                onClick={() => setSalaryModal({ isOpen: true, user, salary: user.monthly_salary.toString(), saving: false })}
                                                                className="text-ink-subtle hover:text-brand-500 p-1 rounded hover:bg-surface-muted transition"
                                                            >
                                                                <Pencil size={12} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button 
                                                            onClick={() => setSalaryModal({ isOpen: true, user, salary: '', saving: false })}
                                                            className="text-xs font-bold text-brand-600 hover:underline inline-flex items-center gap-1"
                                                        >
                                                            <DollarSign size={12} /> Set Salary
                                                        </button>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center justify-center gap-3">
                                                        <button
                                                            onClick={() => setPayPartyUser(user)}
                                                            className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-[var(--r-md)] border border-brand-100/50 transition-all focus-ring"
                                                        >
                                                            <DollarSign size={13} /> Pay
                                                        </button>
                                                        <button 
                                                            onClick={() => handleOpenLedger(user)}
                                                            className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-ink-muted hover:text-ink bg-surface-muted hover:bg-surface-muted/80 px-3 py-2 rounded-[var(--r-md)] border border-hairline transition-all focus-ring"
                                                        >
                                                            <List size={13} /> Ledger History
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Edit Staff Modal */}
            {editModal.isOpen && editModal.user && (
                <Modal open onClose={() => setEditModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel="Edit Staff" className="flex flex-col overflow-hidden max-h-[90vh]">
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between shrink-0 bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-lg">Edit Staff</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">{editModal.user.full_name}</p>
                            </div>
                            <button onClick={() => setEditModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            {/* Name */}
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Display Name</label>
                                <div className="flex gap-3">
                                    <input
                                        type="text"
                                        value={editModal.fullName}
                                        onChange={e => setEditModal(prev => ({ ...prev, fullName: e.target.value }))}
                                        className="flex-1 px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                        placeholder="Full name"
                                    />
                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={editModal.saving || (editModal.fullName.trim() === editModal.user.full_name && editModal.departmentId === editModal.user.department_id)}
                                        className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] disabled:opacity-40 hover:opacity-90 transition-all flex items-center gap-1.5 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] focus-ring"
                                    >
                                        {editModal.saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        Save
                                    </button>
                                </div>
                            </div>

                            {/* Department */}
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Department</label>
                                <select
                                    value={editModal.departmentId || ''}
                                    onChange={e => setEditModal(prev => ({ ...prev, departmentId: e.target.value || null }))}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                >
                                    <option value="">No Department</option>
                                    {departments.map(d => (
                                        <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Password */}
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Reset Password</label>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <input
                                            type={editModal.showPassword ? 'text' : 'password'}
                                            value={editModal.newPassword}
                                            onChange={e => setEditModal(prev => ({ ...prev, newPassword: e.target.value }))}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all pr-12"
                                            placeholder="New password (min 8 chars)"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setEditModal(prev => ({ ...prev, showPassword: !prev.showPassword }))}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink transition-colors p-1"
                                        >
                                            {editModal.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    <input
                                        type={editModal.showPassword ? 'text' : 'password'}
                                        value={editModal.confirmPassword}
                                        onChange={e => setEditModal(prev => ({ ...prev, confirmPassword: e.target.value }))}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                        placeholder="Confirm new password"
                                    />
                                    <button
                                        onClick={handleResetPassword}
                                        disabled={editModal.saving || !editModal.newPassword || editModal.newPassword !== editModal.confirmPassword}
                                        className="w-full py-3 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] disabled:opacity-40 hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 focus-ring"
                                    >
                                        {editModal.saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        Update Password
                                    </button>
                                    {editModal.newPassword && editModal.confirmPassword && editModal.newPassword !== editModal.confirmPassword && (
                                        <p className="text-[11px] font-bold text-danger-fg uppercase tracking-wider">Passwords do not match</p>
                                    )}
                                </div>
                            </div>

                            {/* Danger zone */}
                            <div className="border border-danger-bg rounded-[var(--r-md)] p-5 bg-danger-bg/10">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-danger-fg mb-1.5">Danger Zone</p>
                                <p className="text-sm font-medium text-danger-fg/80 mb-4">Deletes the account and revokes all access. Payroll and attendance records are kept. This cannot be undone.</p>
                                <button
                                    onClick={() => handleDeleteStaff(editModal.user!)}
                                    disabled={!!editModal.deletingId}
                                    className="flex w-full justify-center items-center gap-2 text-sm font-bold text-white bg-danger-fg px-4 py-3 rounded-[var(--r-md)] hover:bg-danger-fg/90 active:scale-95 disabled:opacity-50 transition shadow-[0_4px_12px_rgba(239,68,68,0.3)] focus-ring focus:ring-danger-fg/20"
                                >
                                    {editModal.deletingId ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    Delete Account Permanently
                                </button>
                            </div>
                        </div>
                </Modal>
            )}

            {/* Role Change Modal */}
            {changeRoleModal.isOpen && changeRoleModal.user && (
                <Modal open onClose={() => setChangeRoleModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel="Change Role">
                        <div className="p-6">
                            <h3 className="text-h3 font-extrabold text-ink mb-1.5">Change Role</h3>
                            <p className="text-sm text-ink-subtle font-medium mb-6">
                                Select a new role for <span className="font-extrabold text-ink">{changeRoleModal.user.full_name}</span>.
                            </p>

                            <div className="space-y-3">
                                {availableRoles.map(role => (
                                    <label key={role.id} className={`flex items-start gap-4 p-4 border rounded-[var(--r-md)] cursor-pointer transition-all ${changeRoleModal.newRoleId === role.id ? 'border-brand-500 bg-brand-50 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]' : 'border-hairline bg-surface hover:bg-surface-muted/50'}`}>
                                        <input
                                            type="radio"
                                            name="role"
                                            value={role.id}
                                            checked={changeRoleModal.newRoleId === role.id}
                                            onChange={() => setChangeRoleModal({ ...changeRoleModal, newRoleId: role.id })}
                                            className="mt-1 text-brand-500 focus:ring-brand-500/20"
                                        />
                                        <div>
                                            <div className="font-extrabold text-ink flex items-center gap-2">
                                                {getRoleIcon(role.name)}
                                                {formatRoleName(role.name)}
                                            </div>
                                            <p className="text-[11px] text-ink-subtle font-bold uppercase tracking-wider mt-1">{role.description}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>

                            {changeRoleModal.newRoleId === 1 && (
                                <div className="mt-5 p-4 bg-amber-50 text-amber-800 rounded-[var(--r-md)] text-sm font-medium flex items-start gap-3 border border-amber-200 shadow-[inset_0_2px_4px_rgba(245,158,11,0.05)]">
                                    <AlertTriangle size={18} className="shrink-0 text-amber-600 mt-0.5" />
                                    <p>Warning: You are granting full Super Admin access. This user will have complete control over the system.</p>
                                </div>
                            )}
                        </div>

                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button onClick={() => setChangeRoleModal({ isOpen: false, user: null, newRoleId: 0 })} className="px-5 py-2.5 text-sm font-bold text-ink-subtle bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted hover:text-ink transition-colors focus-ring">
                                Cancel
                            </button>
                            <button
                                disabled={submittingId === changeRoleModal.user.id}
                                onClick={handleRoleChange}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {submittingId === changeRoleModal.user.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Save Role
                            </button>
                        </div>
                </Modal>
            )}

            {/* Create Staff Modal */}
            {createModal.isOpen && (
                <Modal open onClose={() => setCreateModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel="Create Staff Account">
                        <div className="p-6 pb-0">
                            <h3 className="text-h3 font-extrabold text-ink mb-1.5">Create Staff Account</h3>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-6">Add a new staff member to your restaurant</p>
                        </div>

                        <div className="px-6 pb-6 space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Full Name *</label>
                                <input
                                    type="text"
                                    value={createModal.fullName}
                                    onChange={(e) => setCreateModal(prev => ({ ...prev, fullName: e.target.value }))}
                                    placeholder="John Doe"
                                    disabled={createModal.isCreating}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Email Address *</label>
                                <input
                                    type="email"
                                    value={createModal.email}
                                    onChange={(e) => setCreateModal(prev => ({ ...prev, email: e.target.value }))}
                                    placeholder="john@example.com"
                                    disabled={createModal.isCreating}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Password *</label>
                                <PasswordToggleInput
                                    value={createModal.password}
                                    onChange={(value) => setCreateModal(prev => ({ ...prev, password: value }))}
                                    placeholder="At least 8 characters"
                                    disabled={createModal.isCreating}
                                    show={createModal.showPassword}
                                    onToggleShow={() => setCreateModal(prev => ({ ...prev, showPassword: !prev.showPassword }))}
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Confirm Password *</label>
                                <PasswordToggleInput
                                    value={createModal.confirmPassword}
                                    onChange={(value) => setCreateModal(prev => ({ ...prev, confirmPassword: value }))}
                                    placeholder="Re-enter password"
                                    disabled={createModal.isCreating}
                                    show={createModal.showConfirmPassword}
                                    onToggleShow={() => setCreateModal(prev => ({ ...prev, showConfirmPassword: !prev.showConfirmPassword }))}
                                />
                                {createModal.confirmPassword && createModal.password !== createModal.confirmPassword && (
                                    <p className="mt-1.5 text-[11px] font-bold text-danger-fg uppercase tracking-wider">Passwords do not match</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Phone Number</label>
                                <input
                                    type="tel"
                                    value={createModal.phone}
                                    onChange={(e) => setCreateModal(prev => ({ ...prev, phone: e.target.value }))}
                                    placeholder="123-456-7890"
                                    disabled={createModal.isCreating}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Initial Role</label>
                                <select
                                    value={createModal.roleId}
                                    onChange={(e) => setCreateModal(prev => ({ ...prev, roleId: parseInt(e.target.value) }))}
                                    disabled={createModal.isCreating}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                >
                                    {availableRoles.map(role => (
                                        <option key={role.id} value={role.id}>{formatRoleName(role.name)}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Department <span className="text-ink-subtle font-normal normal-case">(optional)</span></label>
                                <select
                                    value={createModal.departmentId}
                                    onChange={(e) => setCreateModal(prev => ({ ...prev, departmentId: e.target.value }))}
                                    disabled={createModal.isCreating}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                >
                                    <option value="">No Department</option>
                                    {departments.map(dept => (
                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={closeCreateModal}
                                disabled={createModal.isCreating}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors disabled:opacity-50 focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateStaff}
                                disabled={createModal.isCreating || !createModal.password || createModal.password !== createModal.confirmPassword}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {createModal.isCreating ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Create Staff
                            </button>
                        </div>
                </Modal>
            )}

            {/* Invite Staff Modal */}
            {inviteModal.isOpen && (
                <Modal open onClose={() => setInviteModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel="Invite via Email">
                        <div className="p-6 pb-0">
                            <h3 className="text-h3 font-extrabold text-ink mb-1.5">Invite via Email</h3>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-6">They&apos;ll get a link to set their own password</p>
                        </div>

                        <div className="px-6 pb-6 space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Email Address *</label>
                                <input
                                    type="email"
                                    value={inviteModal.email}
                                    onChange={(e) => setInviteModal(prev => ({ ...prev, email: e.target.value }))}
                                    placeholder="john@example.com"
                                    disabled={inviteModal.isInviting}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Role</label>
                                <select
                                    value={inviteModal.roleId}
                                    onChange={(e) => setInviteModal(prev => ({ ...prev, roleId: parseInt(e.target.value) }))}
                                    disabled={inviteModal.isInviting}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                >
                                    {availableRoles.map(role => (
                                        <option key={role.id} value={role.id}>{formatRoleName(role.name)}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Department <span className="text-ink-subtle font-normal normal-case">(optional)</span></label>
                                <select
                                    value={inviteModal.departmentId}
                                    onChange={(e) => setInviteModal(prev => ({ ...prev, departmentId: e.target.value }))}
                                    disabled={inviteModal.isInviting}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                >
                                    <option value="">No Department</option>
                                    {departments.map(dept => (
                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setInviteModal({ isOpen: false, email: '', roleId: 4, departmentId: '', isInviting: false })}
                                disabled={inviteModal.isInviting}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors disabled:opacity-50 focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSendInvite}
                                disabled={inviteModal.isInviting}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {inviteModal.isInviting ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                Send Invite
                            </button>
                        </div>
                </Modal>
            )}

            {/* Department Modal */}
            {departmentModal.isOpen && (
                <Modal open onClose={() => setDepartmentModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel={departmentModal.department ? 'Edit Department' : 'Create Department'}>
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between shrink-0 bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-lg">{departmentModal.department ? 'Edit Department' : 'Create Department'}</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">Organize your team</p>
                            </div>
                            <button onClick={() => setDepartmentModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>
                        <div className="p-6 space-y-5">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Department Name *</label>
                                <input
                                    type="text"
                                    value={departmentModal.name}
                                    onChange={e => setDepartmentModal(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="e.g. Kitchen, Front of House"
                                    disabled={departmentModal.saving}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Description</label>
                                <textarea
                                    value={departmentModal.description}
                                    onChange={e => setDepartmentModal(prev => ({ ...prev, description: e.target.value }))}
                                    placeholder="Optional description"
                                    disabled={departmentModal.saving}
                                    rows={3}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all resize-none"
                                />
                            </div>
                        </div>
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setDepartmentModal(prev => ({ ...prev, isOpen: false }))}
                                disabled={departmentModal.saving}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors disabled:opacity-50 focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveDepartment}
                                disabled={departmentModal.saving || !departmentModal.name.trim()}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {departmentModal.saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Save Department
                            </button>
                        </div>
                </Modal>
            )}

            {/* Set/Edit Salary Modal */}
            {salaryModal.isOpen && salaryModal.user && (
                <Modal open onClose={() => setSalaryModal(prev => ({ ...prev, isOpen: false }))} size="sm" ariaLabel="Set Monthly Salary">
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Set Monthly Salary</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">{salaryModal.user.full_name}</p>
                            </div>
                            <button onClick={() => setSalaryModal({ isOpen: false, user: null, salary: '', saving: false })} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Monthly Salary</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-subtle">Rs.</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Enter salary amount..."
                                        value={salaryModal.salary}
                                        onChange={e => setSalaryModal(prev => ({ ...prev, salary: e.target.value }))}
                                        disabled={salaryModal.saving}
                                        className="w-full pl-10 pr-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setSalaryModal({ isOpen: false, user: null, salary: '', saving: false })}
                                disabled={salaryModal.saving}
                                className="px-4 py-2 text-xs font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] transition shadow-sm hover:bg-surface-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateSalary}
                                disabled={salaryModal.saving || !salaryModal.salary}
                                className="px-4 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.2)]"
                            >
                                {salaryModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                Save Salary
                            </button>
                        </div>
                </Modal>
            )}

            {joinDateModal.isOpen && joinDateModal.user && (
                <Modal open onClose={() => setJoinDateModal(prev => ({ ...prev, isOpen: false }))} size="sm" ariaLabel="Set Join Date">
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Set Join Date</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">{joinDateModal.user.full_name}</p>
                            </div>
                            <button onClick={() => setJoinDateModal({ isOpen: false, user: null, joinDate: '', saving: false })} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Date Joined</label>
                                <p className="text-[11px] text-ink-subtle mb-3">The day this staff member actually started working — used to prorate their first month&apos;s salary accrual.</p>
                                <input
                                    type="date"
                                    value={joinDateModal.joinDate}
                                    onChange={e => setJoinDateModal(prev => ({ ...prev, joinDate: e.target.value }))}
                                    disabled={joinDateModal.saving}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setJoinDateModal({ isOpen: false, user: null, joinDate: '', saving: false })}
                                disabled={joinDateModal.saving}
                                className="px-4 py-2 text-xs font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] transition shadow-sm hover:bg-surface-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateJoinDate}
                                disabled={joinDateModal.saving || !joinDateModal.joinDate}
                                className="px-4 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.2)]"
                            >
                                {joinDateModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                Save Join Date
                            </button>
                        </div>
                </Modal>
            )}

            {salaryIncreaseModal.isOpen && salaryIncreaseModal.user && (
                <Modal open onClose={() => setSalaryIncreaseModal(prev => ({ ...prev, isOpen: false }))} size="sm" ariaLabel="Increase Salary">
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Increase Salary</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">{salaryIncreaseModal.user.full_name} • Current: {formatCurrency(salaryIncreaseModal.user.monthly_salary)}</p>
                            </div>
                            <button onClick={() => setSalaryIncreaseModal({ isOpen: false, user: null, newSalary: '', effectiveFrom: '', effectiveTo: '', saving: false })} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">New Monthly Salary</label>
                                <div className="relative">
                                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-subtle">Rs.</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Enter new salary amount..."
                                        value={salaryIncreaseModal.newSalary}
                                        onChange={e => setSalaryIncreaseModal(prev => ({ ...prev, newSalary: e.target.value }))}
                                        disabled={salaryIncreaseModal.saving}
                                        className="w-full pl-10 pr-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Starting <span className="text-danger-fg">*</span></label>
                                    <input
                                        type="date"
                                        value={salaryIncreaseModal.effectiveFrom}
                                        onChange={e => setSalaryIncreaseModal(prev => ({ ...prev, effectiveFrom: e.target.value }))}
                                        disabled={salaryIncreaseModal.saving}
                                        className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Ending <span className="text-ink-subtle font-normal normal-case">(optional)</span></label>
                                    <input
                                        type="date"
                                        value={salaryIncreaseModal.effectiveTo}
                                        onChange={e => setSalaryIncreaseModal(prev => ({ ...prev, effectiveTo: e.target.value }))}
                                        disabled={salaryIncreaseModal.saving}
                                        min={salaryIncreaseModal.effectiveFrom || undefined}
                                        className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50"
                                    />
                                </div>
                            </div>
                            <p className="text-[11px] text-ink-subtle">Leave &quot;Ending&quot; blank to keep this salary in effect until you change it again. This only affects {salaryIncreaseModal.user.full_name} — future salary accruals will automatically use the new amount from the start date onward.</p>
                        </div>

                        <div className="px-6 py-4 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setSalaryIncreaseModal({ isOpen: false, user: null, newSalary: '', effectiveFrom: '', effectiveTo: '', saving: false })}
                                disabled={salaryIncreaseModal.saving}
                                className="px-4 py-2 text-xs font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] transition shadow-sm hover:bg-surface-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleIncreaseSalary}
                                disabled={salaryIncreaseModal.saving || !salaryIncreaseModal.newSalary || !salaryIncreaseModal.effectiveFrom}
                                className="px-4 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.2)]"
                            >
                                {salaryIncreaseModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                Save Salary Change
                            </button>
                        </div>
                </Modal>
            )}

            {/* Add Due / Deduction Modal — actual payments (Salary/Advance/Bonus)
                go through PayPartyModal instead, since those are real
                Payment Vouchers, not just ledger bookkeeping entries. */}
            {transactionModal.isOpen && transactionModal.user && (
                <Modal open onClose={() => setTransactionModal(prev => ({ ...prev, isOpen: false }))} size="md" ariaLabel="Add Due / Deduction">
                        <div className="px-6 py-5 border-b border-hairline flex items-center justify-between bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Add Due / Deduction</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-1">{transactionModal.user.full_name}</p>
                            </div>
                            <button onClick={() => setTransactionModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors focus-ring">×</button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Entry Type</label>
                                    <select
                                        value={transactionModal.entryType}
                                        onChange={e => setTransactionModal(prev => ({ ...prev, entryType: e.target.value as typeof transactionModal.entryType }))}
                                        className="w-full px-3 py-2 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    >
                                        <option value="accrual">Add to Amount Due (Not Paid Yet)</option>
                                        <option value="deduction">Deduction / Fine</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Amount</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-subtle">Rs.</span>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={transactionModal.amount}
                                            onChange={e => setTransactionModal(prev => ({ ...prev, amount: e.target.value }))}
                                            className="w-full pl-8 pr-3 py-2 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                        />
                                    </div>
                                </div>
                            </div>

                            {transactionModal.entryType !== 'accrual' && (
                                <div>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Payment Method</label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(['cash', 'bank_transfer', 'qr_digital'] as const).map(method => (
                                            <button
                                                key={method}
                                                type="button"
                                                onClick={() => setTransactionModal(prev => ({ ...prev, paymentMethod: method, bankName: method === 'cash' ? '' : prev.bankName }))}
                                                className={`py-2 rounded-[var(--r-md)] text-xs font-bold border transition ${transactionModal.paymentMethod === method ? 'bg-brand-50 border-brand-500 text-brand-600' : 'bg-surface border-hairline text-ink hover:bg-surface-muted/40'}`}
                                            >
                                                {method === 'cash' ? 'Cash' : method === 'bank_transfer' ? 'Bank Transfer' : 'Digital QR'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(transactionModal.paymentMethod === 'bank_transfer' || transactionModal.paymentMethod === 'qr_digital') && (
                                <div className="animate-in slide-in-from-top-1 duration-150">
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Bank Account</label>
                                    <select
                                        value={transactionModal.bankName}
                                        onChange={e => setTransactionModal(prev => ({ ...prev, bankName: e.target.value }))}
                                        required
                                        className="w-full px-3 py-2 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    >
                                        <option value="">Select Bank Account</option>
                                        {bankAccounts.map(b => (
                                            <option key={b.id} value={b.name}>{b.name} ({b.account_number})</option>
                                        ))}
                                        {bankAccounts.length === 0 && (
                                            <option value="General Bank">General Bank</option>
                                        )}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Note / Reference</label>
                                <input
                                    type="text"
                                    placeholder="e.g. June monthly salary, advance for Dashain..."
                                    value={transactionModal.note}
                                    onChange={e => setTransactionModal(prev => ({ ...prev, note: e.target.value }))}
                                    className="w-full px-3 py-2 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setTransactionModal(prev => ({ ...prev, isOpen: false }))}
                                disabled={transactionModal.saving}
                                className="px-4 py-2 text-xs font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] transition shadow-sm hover:bg-surface-muted"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRecordTransaction}
                                disabled={transactionModal.saving || !transactionModal.amount}
                                className="px-4 py-2 text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.2)]"
                            >
                                {transactionModal.saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                Record Entry
                            </button>
                        </div>
                </Modal>
            )}

            {payPartyUser && (
                <PayPartyModal
                    isOpen={!!payPartyUser}
                    onClose={() => setPayPartyUser(null)}
                    category="staff"
                    partyId={payPartyUser.id}
                    partyName={payPartyUser.full_name}
                    currentDue={
                        ledgerModal.user?.id === payPartyUser.id
                            ? computeStaffCurrentDue(
                                  ledgerModal.entries.map(e => ({ entry_type: e.entry_type as StaffLedgerEntryType, amount: Number(e.amount) })),
                                  Number(ledgerModal.user.opening_balance ?? 0)
                              )
                            : undefined
                    }
                    bsEnabled={bsEnabled}
                    bankAccounts={bankAccounts}
                    onSettled={handlePaySettled}
                />
            )}

            {/* Ledger History Modal */}
            {ledgerModal.isOpen && ledgerModal.user && (
                <Modal open onClose={() => setLedgerModal(prev => ({ ...prev, isOpen: false }))} size="xl" ariaLabel="Staff Ledger Statement" className="max-w-5xl flex flex-col overflow-hidden">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between shrink-0 bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Staff Ledger Statement</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-0.5">{ledgerModal.user.full_name} • Monthly Salary: {formatCurrency(ledgerModal.user.monthly_salary)}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        if (!ledgerModal.user) return
                                        setSalaryIncreaseModal({ isOpen: true, user: ledgerModal.user, newSalary: '', effectiveFrom: '', effectiveTo: '', saving: false })
                                    }}
                                    className="px-3 py-1.5 text-[11px] font-black text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-[var(--r-sm)] flex items-center gap-1.5 transition shadow-sm"
                                >
                                    <TrendingUp size={12} />
                                    Increase Salary
                                </button>
                                <button
                                    onClick={() => setLedgerModal(prev => ({
                                        ...prev,
                                        showOpeningBalanceEditor: !prev.showOpeningBalanceEditor,
                                        // Clear any unsaved draft when collapsing, so reopening later doesn't resurface a stale value
                                        openingBalanceEdit: prev.showOpeningBalanceEditor ? '' : prev.openingBalanceEdit
                                    }))}
                                    className="px-3 py-1.5 text-[11px] font-black text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-[var(--r-sm)] flex items-center gap-1.5 transition shadow-sm"
                                >
                                    <Pencil size={12} />
                                    Edit Opening Balance
                                </button>
                                <button
                                    onClick={() => {
                                        if (!ledgerModal.user) return
                                        setPayPartyUser(ledgerModal.user)
                                    }}
                                    className="px-3 py-1.5 text-[11px] font-black text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-sm)] flex items-center gap-1.5 transition shadow-sm"
                                >
                                    <DollarSign size={12} />
                                    Pay
                                </button>
                                <button
                                    onClick={() => {
                                        if (!ledgerModal.user) return
                                        setTransactionModal({
                                            isOpen: true,
                                            user: ledgerModal.user,
                                            entryType: 'accrual',
                                            amount: '',
                                            paymentMethod: 'cash',
                                            note: '',
                                            bankName: '',
                                            saving: false
                                        })
                                    }}
                                    className="px-3 py-1.5 text-[11px] font-black text-ink bg-surface-muted hover:bg-surface-muted/80 border border-hairline rounded-[var(--r-sm)] flex items-center gap-1.5 transition shadow-sm"
                                >
                                    <Plus size={12} />
                                    Add Due / Deduction
                                </button>
                                <button onClick={() => setLedgerModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors">×</button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
                            {ledgerModal.loading ? (
                                <div className="flex flex-col items-center justify-center py-20 text-ink-subtle gap-2">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span className="text-xs font-bold">Loading statement...</span>
                                </div>
                            ) : (
                                <>
                                    {/* Summary Metrics — compact single row */}
                                    {(() => {
                                        const openingBal = Number(ledgerModal.user.opening_balance ?? 0)
                                        const totalDue = openingBal + ledgerModal.entries.reduce((s, e) => e.entry_type === 'accrual' ? s + Number(e.amount) : s, 0)
                                        const totalPaid = ledgerModal.entries.reduce((s, e) => PAY_ENTRY_TYPES.includes(e.entry_type) ? s + Number(e.amount) : s, 0)
                                        const netBalance = totalDue - totalPaid
                                        return (
                                            <div className="flex gap-2">
                                                <div className="flex-1 px-3 py-2.5 bg-blue-50/60 border border-blue-100 rounded-[var(--r-md)] min-w-0">
                                                    <div className="text-[9px] font-black uppercase tracking-wider text-blue-600 truncate">Opening Bal</div>
                                                    <div className="text-sm font-black text-blue-900 mt-0.5 truncate">{formatCurrency(openingBal)}</div>
                                                </div>
                                                <div className="flex-1 px-3 py-2.5 bg-violet-50/60 border border-violet-100 rounded-[var(--r-md)] min-w-0">
                                                    <div className="text-[9px] font-black uppercase tracking-wider text-violet-600 truncate">Total Due</div>
                                                    <div className="text-sm font-black text-violet-900 mt-0.5 truncate">{formatCurrency(totalDue)}</div>
                                                </div>
                                                <div className="flex-1 px-3 py-2.5 bg-emerald-50/60 border border-emerald-100 rounded-[var(--r-md)] min-w-0">
                                                    <div className="text-[9px] font-black uppercase tracking-wider text-emerald-600 truncate">Total Paid</div>
                                                    <div className="text-sm font-black text-emerald-900 mt-0.5 truncate">{formatCurrency(totalPaid)}</div>
                                                </div>
                                                <div className={`flex-1 px-3 py-2.5 border rounded-[var(--r-md)] min-w-0 ${
                                                    netBalance > 0
                                                        ? 'bg-amber-50/60 border-amber-100'
                                                        : 'bg-emerald-50/60 border-emerald-100'
                                                }`}>
                                                    <div className={`text-[9px] font-black uppercase tracking-wider truncate ${netBalance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>Net Owed</div>
                                                    <div className={`text-sm font-black mt-0.5 truncate ${netBalance > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>{formatCurrency(Math.abs(netBalance))}</div>
                                                </div>
                                                <div className="flex-1 px-3 py-2.5 bg-surface-muted/60 border border-hairline rounded-[var(--r-md)] min-w-0">
                                                    <div className="text-[9px] font-black uppercase tracking-wider text-ink-subtle truncate">Monthly Salary</div>
                                                    <div className="text-sm font-black text-ink mt-0.5 truncate">{formatCurrency(ledgerModal.user.monthly_salary)}</div>
                                                </div>
                                            </div>
                                        )
                                    })()}

                                    {/* Opening Balance Editor */}
                                    {ledgerModal.showOpeningBalanceEditor && (
                                        <div className="flex items-center gap-3 p-3 bg-blue-50/30 border border-blue-100 rounded-[var(--r-md)]">
                                            <div className="text-[11px] font-black text-blue-700 uppercase tracking-wider shrink-0">Set Opening Balance</div>
                                            <div className="text-[11px] text-blue-500 flex-1">Amount owed to this staff before this system was used (e.g. unpaid salary from previous months)</div>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={ledgerModal.openingBalanceEdit}
                                                onChange={e => setLedgerModal(prev => ({ ...prev, openingBalanceEdit: e.target.value }))}
                                                placeholder={String(ledgerModal.user.opening_balance)}
                                                className="w-32 px-2.5 py-1.5 text-xs font-bold border border-blue-200 rounded-[var(--r-sm)] bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                                            />
                                            <button
                                                disabled={ledgerModal.savingOpeningBalance || ledgerModal.openingBalanceEdit === ''}
                                                onClick={async () => {
                                                    if (!ledgerModal.user) return
                                                    setLedgerModal(prev => ({ ...prev, savingOpeningBalance: true }))
                                                    const val = parseFloat(ledgerModal.openingBalanceEdit)
                                                    if (isNaN(val) || val < 0) {
                                                        setLedgerModal(prev => ({ ...prev, savingOpeningBalance: false }))
                                                        return
                                                    }
                                                    await updateOpeningBalanceAction(ledgerModal.user.id, val)
                                                    setLedgerModal(prev => ({
                                                        ...prev,
                                                        savingOpeningBalance: false,
                                                        openingBalanceEdit: '',
                                                        showOpeningBalanceEditor: false,
                                                        user: prev.user ? { ...prev.user, opening_balance: val } : null
                                                    }))
                                                }}
                                                className="px-3 py-1.5 text-[11px] font-black text-white bg-blue-500 hover:bg-blue-600 rounded-[var(--r-sm)] flex items-center gap-1 transition disabled:opacity-50"
                                            >
                                                {ledgerModal.savingOpeningBalance ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                Save
                                            </button>
                                        </div>
                                    )}

                                    {/* Transaction Table */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-black text-ink uppercase tracking-wider">Transaction History</h4>
                                            <span className="text-[10px] font-bold text-ink-subtle">{ledgerModal.entries.length + (Number(ledgerModal.user.opening_balance) > 0 ? 1 : 0)} entries</span>
                                        </div>

                                        <div className="border border-hairline rounded-card overflow-hidden">
                                            <table className="w-full text-left text-xs border-collapse">
                                                <thead>
                                                    <tr className="bg-surface-muted border-b-2 border-hairline">
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] text-center w-6 border-r border-hairline">#</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline whitespace-nowrap">Date & Time</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline">Description</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline whitespace-nowrap">Type</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline whitespace-nowrap">Method</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] text-right border-r border-hairline whitespace-nowrap">Paid Out</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] text-right border-r border-hairline whitespace-nowrap">Earned / Dues</th>
                                                        <th className="px-2 py-2.5 font-black text-ink-subtle uppercase tracking-wider text-[10px] text-right whitespace-nowrap">Balance Owed</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-hairline">
                                                    {/* Opening Balance Row */}
                                                    {Number(ledgerModal.user.opening_balance) > 0 && (
                                                        <tr className="bg-blue-50/30 hover:bg-blue-50/50 transition-colors">
                                                            <td className="px-2 py-2 text-center text-[11px] font-black text-ink-muted border-r border-hairline">0</td>
                                                            <td className="px-2 py-2 font-bold text-ink-subtle border-r border-hairline text-[11px]">
                                                                <div className="italic text-blue-600 whitespace-nowrap">Before system</div>
                                                            </td>
                                                            <td className="px-2 py-2 font-bold text-blue-700 border-r border-hairline text-[11px]">Pre-existing unpaid balance</td>
                                                            <td className="px-2 py-2 border-r border-hairline">
                                                                <span className="inline-flex px-1.5 py-0.5 rounded-[4px] text-[9px] font-black uppercase tracking-wider border bg-blue-50 text-blue-700 border-blue-100 whitespace-nowrap">Opening Bal</span>
                                                            </td>
                                                            <td className="px-2 py-2 text-center text-ink-muted border-r border-hairline">—</td>
                                                            <td className="px-2 py-2 text-right border-r border-hairline text-ink-muted">—</td>
                                                            <td className="px-2 py-2 text-right font-black text-blue-700 border-r border-hairline">{formatCurrency(ledgerModal.user.opening_balance ?? 0)}</td>
                                                            <td className="px-2 py-2 text-right font-black text-blue-700">{formatCurrency(ledgerModal.user.opening_balance ?? 0)}</td>
                                                        </tr>
                                                    )}
                                                    {/* Ledger Entry Rows */}
                                                    {ledgerModal.entries.length === 0 && Number(ledgerModal.user.opening_balance) === 0 ? (
                                                        <tr>
                                                            <td colSpan={8} className="text-center py-10 text-sm text-ink-muted font-bold">No ledger transactions recorded yet</td>
                                                        </tr>
                                                    ) : ledgerModal.entries.map((entry, idx) => {
                                                        const isTaken = PAY_ENTRY_TYPES.includes(entry.entry_type)
                                                        const isAmountToPay = entry.entry_type === 'accrual'
                                                        const typeColors: Record<string, string> = {
                                                            salary_payout: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                                                            advance_payment: 'bg-amber-50 text-amber-700 border-amber-100',
                                                            bonus: 'bg-indigo-50 text-indigo-700 border-indigo-100',
                                                            deduction: 'bg-rose-50 text-rose-700 border-rose-100',
                                                            accrual: 'bg-violet-50 text-violet-700 border-violet-100',
                                                        }
                                                        const colorClass = typeColors[entry.entry_type] || 'bg-gray-50 text-gray-600 border-gray-100'
                                                        const methodLabel = entry.payment_method === 'bank_transfer' ? 'Bank' : entry.payment_method === 'qr_digital' ? 'QR' : entry.payment_method === 'cash' ? 'Cash' : '—'

                                                        // Running balance: starts from opening, accruals add, payments/deductions subtract
                                                        const runningBalance = ledgerModal.entries.slice(0, idx + 1).reduce((bal, e) => {
                                                            if (PAY_ENTRY_TYPES.includes(e.entry_type)) return bal - Number(e.amount)
                                                            if (e.entry_type === 'accrual') return bal + Number(e.amount)
                                                            if (e.entry_type === 'deduction') return bal - Number(e.amount)
                                                            return bal
                                                        }, Number(ledgerModal.user?.opening_balance ?? 0))

                                                        return (
                                                            <tr key={entry.id} className={`transition-colors hover:bg-brand-50/10 ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/15'}`}>
                                                                <td className="px-2 py-2 text-center text-[11px] font-black text-ink-muted border-r border-hairline">{idx + 1}</td>
                                                                <td className="px-2 py-2 border-r border-hairline text-[11px] font-bold text-ink-subtle whitespace-nowrap">
                                                                    <div>{new Date(entry.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                                                                    <div className="text-ink-muted text-[10px]">{new Date(entry.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>
                                                                </td>
                                                                <td className="px-2 py-2 font-bold text-ink border-r border-hairline text-[11px] w-full">
                                                                    {entry.note || <span className="text-ink-muted italic">No description</span>}
                                                                </td>
                                                                <td className="px-2 py-2 border-r border-hairline">
                                                                    <span className={`inline-flex px-1.5 py-0.5 rounded-[4px] text-[9px] font-black uppercase tracking-wider border whitespace-nowrap ${colorClass}`}>
                                                                        {entry.entry_type.replace(/_/g, ' ')}
                                                                    </span>
                                                                </td>
                                                                <td className="px-2 py-2 font-bold text-ink-subtle border-r border-hairline text-[11px] text-center whitespace-nowrap">{methodLabel}</td>
                                                                <td className="px-2 py-2 text-right font-black border-r border-hairline whitespace-nowrap">
                                                                    {isTaken ? <span className="text-emerald-600 text-xs font-black">{formatCurrency(Number(entry.amount))}</span> : <span className="text-ink-muted">—</span>}
                                                                </td>
                                                                <td className="px-2 py-2 text-right font-black border-r border-hairline whitespace-nowrap">
                                                                    {isAmountToPay ? <span className="text-violet-600 text-xs font-black">{formatCurrency(Number(entry.amount))}</span> : entry.entry_type === 'deduction' ? <span className="text-rose-600 text-xs font-black">-{formatCurrency(Number(entry.amount))}</span> : <span className="text-ink-muted">—</span>}
                                                                </td>
                                                                <td className={`px-2 py-2 text-right font-black text-xs whitespace-nowrap ${runningBalance >= 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                                                    {formatCurrency(Math.abs(runningBalance))}
                                                                    <div className={`text-[9px] font-bold ${runningBalance >= 0 ? 'text-amber-500' : 'text-emerald-500'}`}>{runningBalance >= 0 ? 'owed' : 'overpaid'}</div>
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                                <tfoot>
                                                    <tr className="bg-surface-muted/70 border-t-2 border-hairline">
                                                        <td colSpan={5} className="px-2 py-2.5 text-[11px] font-black text-ink uppercase tracking-wider">Totals</td>
                                                        <td className="px-2 py-2.5 text-right font-black text-xs text-emerald-600 border-r border-hairline whitespace-nowrap">
                                                            {formatCurrency(ledgerModal.entries.reduce((sum, e) => PAY_ENTRY_TYPES.includes(e.entry_type) ? sum + Number(e.amount) : sum, 0))}
                                                        </td>
                                                        <td className="px-2 py-2.5 text-right font-black text-xs text-violet-600 border-r border-hairline whitespace-nowrap">
                                                            {formatCurrency(Number(ledgerModal.user.opening_balance ?? 0) + ledgerModal.entries.reduce((sum, e) => e.entry_type === 'accrual' ? sum + Number(e.amount) : e.entry_type === 'deduction' ? sum - Number(e.amount) : sum, 0))}
                                                        </td>
                                                        <td className={`px-2 py-2.5 text-right font-black text-xs whitespace-nowrap ${
                                                            (() => {
                                                                const finalBal = ledgerModal.entries.reduce((bal, e) => {
                                                                    if (PAY_ENTRY_TYPES.includes(e.entry_type)) return bal - Number(e.amount)
                                                                    if (e.entry_type === 'accrual') return bal + Number(e.amount)
                                                                    if (e.entry_type === 'deduction') return bal - Number(e.amount)
                                                                    return bal
                                                                }, Number(ledgerModal.user.opening_balance ?? 0))
                                                                return finalBal >= 0 ? 'text-amber-700' : 'text-emerald-700'
                                                            })()
                                                        }`}>
                                                            {(() => {
                                                                const finalBal = ledgerModal.entries.reduce((bal, e) => {
                                                                    if (PAY_ENTRY_TYPES.includes(e.entry_type)) return bal - Number(e.amount)
                                                                    if (e.entry_type === 'accrual') return bal + Number(e.amount)
                                                                    if (e.entry_type === 'deduction') return bal - Number(e.amount)
                                                                    return bal
                                                                }, Number(ledgerModal.user.opening_balance ?? 0))
                                                                return formatCurrency(Math.abs(finalBal))
                                                            })()}
                                                        </td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end shrink-0">
                            <button
                                onClick={() => setLedgerModal(prev => ({ ...prev, isOpen: false }))}
                                className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition"
                            >
                                Close Statement
                            </button>
                        </div>
                </Modal>
            )}

            {/* Bulk Process Monthly Salaries Modal */}
            {autoAccrualModal.isOpen && (
                <Modal open onClose={() => setAutoAccrualModal(prev => ({ ...prev, isOpen: false }))} size="xl" ariaLabel="Process Monthly Salaries" className="max-w-4xl flex flex-col overflow-hidden max-h-[85vh]">
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between shrink-0 bg-surface-muted/30">
                            <div>
                                <h3 className="font-extrabold text-ink text-base">Process Monthly Salaries</h3>
                                <p className="text-[11px] text-ink-subtle uppercase tracking-wider font-bold mt-0.5">Bulk record salary accruals for active staff</p>
                            </div>
                            <button onClick={() => setAutoAccrualModal(prev => ({ ...prev, isOpen: false }))} className="w-8 h-8 flex items-center justify-center rounded-[var(--r-md)] text-ink-subtle hover:bg-surface-muted hover:text-ink transition-colors">×</button>
                        </div>

                        {/* Month/Year Selectors */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center gap-3 bg-surface shrink-0">
                            <span className="text-xs font-bold text-ink-subtle uppercase tracking-wider">Select Payroll Period:</span>
                            <select
                                value={autoAccrualModal.month}
                                onChange={e => {
                                    const m = parseInt(e.target.value)
                                    loadAutoAccrualPreview(autoAccrualModal.year, m)
                                }}
                                className="px-2.5 py-1.5 text-xs font-bold border border-hairline rounded-[var(--r-sm)] bg-surface text-ink outline-none focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500"
                            >
                                {Array.from({ length: 12 }, (_, i) => (
                                    <option key={i + 1} value={i + 1}>
                                        {new Date(2000, i).toLocaleString('default', { month: 'long' })}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={autoAccrualModal.year}
                                onChange={e => {
                                    const y = parseInt(e.target.value)
                                    loadAutoAccrualPreview(y, autoAccrualModal.month)
                                }}
                                className="px-2.5 py-1.5 text-xs font-bold border border-hairline rounded-[var(--r-sm)] bg-surface text-ink outline-none focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500"
                            >
                                {Array.from({ length: 3 }, (_, i) => {
                                    const y = new Date().getFullYear() - i
                                    return <option key={y} value={y}>{y}</option>
                                })}
                            </select>
                        </div>

                        {/* Preview Table */}
                        <div className="flex-1 overflow-y-auto p-6 min-h-0">
                            {autoAccrualModal.loading ? (
                                <div className="flex flex-col items-center justify-center py-20 text-ink-subtle gap-2">
                                    <Loader2 size={24} className="animate-spin" />
                                    <span className="text-xs font-bold">Calculating payroll preview...</span>
                                </div>
                            ) : autoAccrualModal.previewData.length === 0 ? (
                                <div className="text-center py-12 text-sm text-ink-muted bg-surface-muted/20 border border-hairline rounded-card font-bold">
                                    No active staff members found to process
                                </div>
                            ) : (
                                <div className="border border-hairline rounded-card overflow-hidden">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="bg-surface-muted border-b border-hairline">
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline">Staff Member</th>
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline whitespace-nowrap">Join Date</th>
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline text-center whitespace-nowrap">Days Worked</th>
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline text-right whitespace-nowrap">Monthly Salary</th>
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] border-r border-hairline text-right whitespace-nowrap">Calculated Accrual</th>
                                                <th className="px-4 py-3 font-black text-ink-subtle uppercase tracking-wider text-[10px] whitespace-nowrap">Status / Note</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-hairline">
                                            {autoAccrualModal.previewData.map((item) => (
                                                <tr key={item.userId} className={`transition-colors ${item.isProcessed ? 'bg-surface-muted/30 text-ink-muted' : 'hover:bg-brand-50/5'}`}>
                                                    <td className="px-4 py-3 font-black text-ink border-r border-hairline">{item.fullName}</td>
                                                    <td className="px-4 py-3 font-bold border-r border-hairline">
                                                        {new Date(item.joinedDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </td>
                                                    <td className="px-4 py-3 font-bold text-center border-r border-hairline whitespace-nowrap">
                                                        {item.daysWorked} / {item.totalDaysInMonth} days
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-black border-r border-hairline">{formatCurrency(item.monthlySalary)}</td>
                                                    <td className={`px-4 py-3 text-right font-black border-r border-hairline text-sm ${item.isProcessed ? 'text-ink-muted' : 'text-violet-600'}`}>
                                                        {formatCurrency(item.computedAmount)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {item.isProcessed ? (
                                                            <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase tracking-wider border bg-emerald-50 text-emerald-700 border-emerald-100">
                                                                Already Processed
                                                            </span>
                                                        ) : item.computedAmount === 0 ? (
                                                            <span className="text-ink-muted italic text-[11px]">{item.note}</span>
                                                        ) : item.daysWorked < item.totalDaysInMonth ? (
                                                            <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase tracking-wider border bg-amber-50 text-amber-700 border-amber-100" title={item.note}>
                                                                Prorated First Month
                                                            </span>
                                                        ) : (
                                                            <span className="text-ink-subtle text-[11px] font-bold">Ready to accrue</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex items-center justify-between shrink-0">
                            <div className="text-xs font-bold text-ink-subtle">
                                {(() => {
                                    const pending = autoAccrualModal.previewData.filter(p => !p.isProcessed && p.computedAmount > 0)
                                    const totalAccrual = pending.reduce((sum, p) => sum + p.computedAmount, 0)
                                    return (
                                        <span>Total to accrue: <strong className="text-violet-600 text-sm">{formatCurrency(totalAccrual)}</strong> for {pending.length} staff</span>
                                    )
                                })()}
                            </div>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => setAutoAccrualModal(prev => ({ ...prev, isOpen: false }))}
                                    className="px-4 py-2 text-xs font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    disabled={autoAccrualModal.saving || autoAccrualModal.previewData.filter(p => !p.isProcessed && p.computedAmount > 0).length === 0}
                                    onClick={handleExecuteAutoAccrual}
                                    className="px-5 py-2 text-xs font-black text-white bg-brand-500 hover:bg-brand-600 rounded-[var(--r-md)] flex items-center gap-1.5 transition shadow-[0_4px_12px_rgba(251,99,3,0.15)] disabled:opacity-50"
                                >
                                    {autoAccrualModal.saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                    Process & Accrue
                                </button>
                            </div>
                        </div>
                </Modal>
            )}

            {/* Mark Absent Modal — optional reason for today's "Out" */}
            {attendanceOutModal.isOpen && attendanceOutModal.user && (
                <Modal open onClose={() => setAttendanceOutModal(prev => ({ ...prev, isOpen: false }))} size="sm" ariaLabel="Mark Absent">
                        <div className="p-6 pb-0">
                            <h3 className="text-h3 font-extrabold text-ink mb-1.5">Mark Absent</h3>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-6">{attendanceOutModal.user.full_name} • Today</p>
                        </div>

                        <div className="px-6 pb-6">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">
                                Reason <span className="text-ink-subtle font-normal normal-case">(optional)</span>
                            </label>
                            <textarea
                                value={attendanceOutModal.reason}
                                onChange={(e) => setAttendanceOutModal(prev => ({ ...prev, reason: e.target.value }))}
                                placeholder="e.g. Sick leave, personal emergency..."
                                rows={3}
                                disabled={attendanceOutModal.saving}
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all disabled:opacity-50 resize-none"
                            />
                        </div>

                        <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                            <button
                                onClick={() => setAttendanceOutModal({ isOpen: false, user: null, reason: '', saving: false })}
                                disabled={attendanceOutModal.saving}
                                className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors disabled:opacity-50 focus-ring"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmAbsent}
                                disabled={attendanceOutModal.saving}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-danger-fg hover:bg-danger-fg/90 rounded-[var(--r-md)] shadow-sm transition-all disabled:opacity-50 flex items-center gap-2 focus-ring"
                            >
                                {attendanceOutModal.saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Mark Absent
                            </button>
                        </div>
                </Modal>
            )}

        </div>
    )
}
