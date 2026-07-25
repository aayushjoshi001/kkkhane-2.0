import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'

// Simple CRC-32 calculator for Store-only ZIP archives
function crc32(data: Uint8Array): number {
    const table = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
        let c = i
        for (let j = 0; j < 8; j++) {
            c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1))
        }
        table[i] = c
    }
    let crc = 0 ^ -1
    for (let i = 0; i < data.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF]
    }
    return (crc ^ -1) >>> 0
}

// Pure JS Store-only ZIP archive builder (no external dependencies needed)
function createZipStore(files: { name: string; content: string }[]): Uint8Array {
    const encoder = new TextEncoder()
    const fileDatas = files.map(f => {
        const nameBytes = encoder.encode(f.name)
        const contentBytes = encoder.encode(f.content)
        const crc = crc32(contentBytes)
        return {
            name: f.name,
            nameBytes,
            contentBytes,
            crc,
            size: contentBytes.length
        }
    })

    let localHeadersSize = 0
    let centralDirectorySize = 0
    
    fileDatas.forEach(fd => {
        localHeadersSize += 30 + fd.nameBytes.length + fd.size
        centralDirectorySize += 46 + fd.nameBytes.length
    })
    
    const eocdSize = 22
    const totalSize = localHeadersSize + centralDirectorySize + eocdSize
    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const uint8 = new Uint8Array(buffer)
    
    let offset = 0
    const fileOffsets: number[] = []
    
    // Write Local File Headers
    fileDatas.forEach((fd, idx) => {
        fileOffsets.push(offset)
        view.setUint32(offset, 0x04034b50, true); offset += 4 // signature
        view.setUint16(offset, 10, true); offset += 2 // version needed
        view.setUint16(offset, 0, true); offset += 2 // flags
        view.setUint16(offset, 0, true); offset += 2 // compression (0=store)
        view.setUint16(offset, 0, true); offset += 2 // mod time
        view.setUint16(offset, 0, true); offset += 2 // mod date
        view.setUint32(offset, fd.crc, true); offset += 4 // crc
        view.setUint32(offset, fd.size, true); offset += 4 // compressed size
        view.setUint32(offset, fd.size, true); offset += 4 // uncompressed size
        view.setUint16(offset, fd.nameBytes.length, true); offset += 2 // name len
        view.setUint16(offset, 0, true); offset += 2 // extra len
        
        uint8.set(fd.nameBytes, offset); offset += fd.nameBytes.length
        uint8.set(fd.contentBytes, offset); offset += fd.size
    })
    
    const centralDirectoryStartOffset = offset
    
    // Write Central Directory Headers
    fileDatas.forEach((fd, idx) => {
        view.setUint32(offset, 0x02014b50, true); offset += 4 // signature
        view.setUint16(offset, 20, true); offset += 2 // version made by
        view.setUint16(offset, 10, true); offset += 2 // version needed
        view.setUint16(offset, 0, true); offset += 2 // flags
        view.setUint16(offset, 0, true); offset += 2 // compression
        view.setUint16(offset, 0, true); offset += 2 // mod time
        view.setUint16(offset, 0, true); offset += 2 // mod date
        view.setUint32(offset, fd.crc, true); offset += 4 // crc
        view.setUint32(offset, fd.size, true); offset += 4 // compressed size
        view.setUint32(offset, fd.size, true); offset += 4 // uncompressed size
        view.setUint16(offset, fd.nameBytes.length, true); offset += 2 // name len
        view.setUint16(offset, 0, true); offset += 2 // extra len
        view.setUint16(offset, 0, true); offset += 2 // comment len
        view.setUint16(offset, 0, true); offset += 2 // disk start
        view.setUint16(offset, 0, true); offset += 2 // internal attrs
        view.setUint32(offset, 0, true); offset += 4 // external attrs
        view.setUint32(offset, fileOffsets[idx], true); offset += 4 // local header offset
        
        uint8.set(fd.nameBytes, offset); offset += fd.nameBytes.length
    })
    
    const centralDirectoryEndOffset = offset
    const centralDirectorySizeCalc = centralDirectoryEndOffset - centralDirectoryStartOffset
    
    // Write EOCD
    view.setUint32(offset, 0x06054b50, true); offset += 4 // signature
    view.setUint16(offset, 0, true); offset += 2 // disk num
    view.setUint16(offset, 0, true); offset += 2 // central disk num
    view.setUint16(offset, fileDatas.length, true); offset += 2 // disk entries
    view.setUint16(offset, fileDatas.length, true); offset += 2 // total entries
    view.setUint32(offset, centralDirectorySizeCalc, true); offset += 4 // size of central dir
    view.setUint32(offset, centralDirectoryStartOffset, true); offset += 4 // offset of central dir
    view.setUint16(offset, 0, true); offset += 2 // comment len
    
    return uint8
}

function toCsv(columns: { key: string; label: string }[], rows: Record<string, any>[]): string {
    const escape = (val: any) => {
        if (val === null || val === undefined) return ''
        const str = String(val)
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
    }
    const header = columns.map(c => escape(c.label)).join(',')
    const lines = rows.map(row => columns.map(c => escape(row[c.key])).join(','))
    return [header, ...lines].join('\r\n')
}

export async function POST(request: Request) {
    try {
        const currentUser = await getCurrentUser()
        const { restaurantId } = currentUser

        const body = await request.json().catch(() => ({}))
        const { password } = body

        if (!password) {
            return NextResponse.json({ error: 'Password is required' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Verify backup password from Settings
        const { data: settings, error: settingsError } = await supabase
            .from('settings')
            .select('features_v2')
            .eq('restaurant_id', restaurantId)
            .single()

        if (settingsError || !settings) {
            return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
        }

        const correctPassword = settings.features_v2?.backup_password
        if (!correctPassword || password !== correctPassword) {
            return NextResponse.json({ error: 'Incorrect backup password' }, { status: 403 })
        }

        // 2. Fetch all required data
        const [
            ordersRes,
            daybookRes,
            incomeRes,
            expenseRes,
            bookingRes,
            inventoryRes,
            bankRes,
            sessionsRes
        ] = await Promise.all([
            supabase.from('orders').select('*').eq('restaurant_id', restaurantId).order('placed_at', { ascending: false }),
            supabase.from('day_book_entries').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
            supabase.from('income_entries').select('*, income_categories(name)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
            supabase.from('expenses').select('*, expense_categories(name)').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }),
            supabase.from('bookings').select('*, rooms(room_number)').eq('restaurant_id', restaurantId).order('check_in', { ascending: false }),
            supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId),
            supabase.from('bank_accounts').select('*').eq('restaurant_id', restaurantId),
            supabase.from('day_book_sessions').select('*').eq('restaurant_id', restaurantId).order('date', { ascending: false }).limit(1)
        ])

        // 3. Format CSVs
        const files: { name: string; content: string }[] = []

        // Orders
        files.push({
            name: 'order_history.csv',
            content: toCsv([
                { key: 'id', label: 'Order ID' },
                { key: 'total_amount', label: 'Total Amount' },
                { key: 'tax_amount', label: 'Tax Amount' },
                { key: 'tip_amount', label: 'Tip Amount' },
                { key: 'discount_amount', label: 'Discount Amount' },
                { key: 'payment_status', label: 'Payment Status' },
                { key: 'status', label: 'Status' },
                { key: 'placed_at', label: 'Placed At' }
            ], ordersRes.data || [])
        })

        // Daybook
        files.push({
            name: 'daybook.csv',
            content: toCsv([
                { key: 'id', label: 'Entry ID' },
                { key: 'type', label: 'Entry Type' },
                { key: 'amount', label: 'Amount' },
                { key: 'description', label: 'Description' },
                { key: 'category', label: 'Category' },
                { key: 'bank_name', label: 'Bank Name' },
                { key: 'created_at', label: 'Timestamp' }
            ], daybookRes.data || [])
        })

        // Income
        files.push({
            name: 'income_records.csv',
            content: toCsv([
                { key: 'id', label: 'Income ID' },
                { key: 'amount', label: 'Amount' },
                { key: 'description', label: 'Description' },
                { key: 'category_name', label: 'Category' },
                { key: 'created_at', label: 'Date' }
            ], (incomeRes.data || []).map((r: any) => ({ ...r, category_name: r.income_categories?.name || 'Other' })))
        })

        // Expenses
        files.push({
            name: 'expense_records.csv',
            content: toCsv([
                { key: 'id', label: 'Expense ID' },
                { key: 'amount', label: 'Amount' },
                { key: 'description', label: 'Description' },
                { key: 'category_name', label: 'Category' },
                { key: 'status', label: 'Status' },
                { key: 'created_at', label: 'Date' }
            ], (expenseRes.data || []).map((r: any) => ({ ...r, category_name: r.expense_categories?.name || 'Other' })))
        })

        // Bookings
        files.push({
            name: 'room_bookings.csv',
            content: toCsv([
                { key: 'id', label: 'Booking ID' },
                { key: 'room_number', label: 'Room Number' },
                { key: 'guest_name', label: 'Guest Name' },
                { key: 'check_in', label: 'Check In Date' },
                { key: 'check_out', label: 'Check Out Date' },
                { key: 'total_amount', label: 'Total Amount' },
                { key: 'status', label: 'Status' }
            ], (bookingRes.data || []).map((r: any) => ({ ...r, room_number: r.rooms?.room_number || 'N/A' })))
        })

        // Inventory
        files.push({
            name: 'inventory.csv',
            content: toCsv([
                { key: 'id', label: 'Ingredient ID' },
                { key: 'name', label: 'Name' },
                { key: 'unit', label: 'Unit' },
                { key: 'min_stock', label: 'Min Stock Limit' },
                { key: 'current_stock', label: 'Current Quantity' }
            ], inventoryRes.data || [])
        })

        // Balances & Cash/Bank Book Status
        const currentSession = sessionsRes.data?.[0]
        const cashBalance = currentSession ? (currentSession.opening_balance + (currentSession.cash_in || 0) - (currentSession.cash_out || 0)) : 0
        const bankBalancesRows = (bankRes.data || []).map((b: any) => ({
            name: b.name,
            account_number: b.account_number,
            balance: b.balance
        }))

        const balanceData = [
            { asset: 'Cash in Hand (Till)', details: 'Current cash ledger balance', balance: cashBalance },
            ...bankBalancesRows.map(b => ({ asset: `Bank: ${b.name}`, details: `A/C ${b.account_number}`, balance: b.balance }))
        ]

        files.push({
            name: 'balances.csv',
            content: toCsv([
                { key: 'asset', label: 'Account/Asset Name' },
                { key: 'details', label: 'Account Details' },
                { key: 'balance', label: 'Current Balance (Rs.)' }
            ], balanceData)
        })

        // 4. Generate ZIP archive
        const zipBytes = createZipStore(files)

        const filename = `operational_backup_${new Date().toISOString().slice(0, 10)}.zip`

        return new Response(zipBytes as any, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        })

    } catch (err: any) {
        console.error('Backup zip export failed:', err)
        return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
    }
}
