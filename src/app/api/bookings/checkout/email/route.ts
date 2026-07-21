import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { computeFolioTotal } from '@/lib/folio'
import { sendEmail } from '@/lib/email'
import { formatInvoiceAddress } from '@/lib/utils'

const fmt = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(n))}`

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { booking_id, email } = body

        if (!booking_id || !email) {
            return NextResponse.json({ error: 'Missing booking_id or email' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Fetch booking info
        const { data: booking, error: fetchError } = await supabase
            .from('bookings')
            .select(`
                id, check_in, check_out, room_id, guest_name, guest_phone, discount_amount, paid_amount,
                rooms!inner (
                    room_number,
                    room_types ( name, base_price )
                )
            `)
            .eq('id', booking_id)
            .eq('restaurant_id', currentUser.restaurantId)
            .maybeSingle()

        if (fetchError) throw fetchError
        if (!booking) {
            return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
        }

        const room = booking.rooms as any
        const roomNumber = room?.room_number || 'Unknown'
        const roomTypeName = room?.room_types?.name || 'Standard'

        // 2. Compute authoritative folio details
        const folio = await computeFolioTotal(supabase, {
            restaurantId: currentUser.restaurantId,
            bookingId: booking_id,
            roomId: booking.room_id,
            checkIn: booking.check_in,
            checkOut: booking.check_out,
            sessionId: null,
            discountAmount: Number(booking.discount_amount) || 0
        })

        // 3. Fetch restaurant name
        const { data: rest } = await supabase
            .from('restaurants')
            .select('name, address, contact_phone')
            .eq('id', currentUser.restaurantId)
            .single()

        const restaurantName = rest?.name || 'KKHANE HOTEL & RESTAURANT'
        const formattedAddress = formatInvoiceAddress(rest?.address)

        // 4. Construct beautiful HTML receipt template
        const chargesRows = folio.charges.map(c => 
            `<tr>
                <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px;">${c.description}</td>
                <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px; text-align: right; font-weight: 600;">${fmt(c.amount)}</td>
            </tr>`
        ).join('')

        const ordersRows = folio.orders.map((o, idx) => 
            `<tr>
                <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px;">Food Order #${o.id.slice(0, 6).toUpperCase()}</td>
                <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px; text-align: right; font-weight: 600;">${fmt(o.total)}</td>
            </tr>`
        ).join('')

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Room Receipt</title>
            <style>
                body {
                    font-family: 'Courier New', Courier, monospace;
                    background-color: #f6f6f6;
                    margin: 0;
                    padding: 20px;
                    color: #111;
                }
                .receipt-container {
                    max-width: 480px;
                    margin: 0 auto;
                    background-color: #fff;
                    padding: 30px;
                    border: 1px solid #ddd;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.05);
                }
                .header {
                    text-align: center;
                    margin-bottom: 20px;
                }
                .header h1 {
                    font-size: 20px;
                    margin: 0 0 5px 0;
                    text-transform: uppercase;
                }
                .header p {
                    font-size: 12px;
                    margin: 0;
                    color: #666;
                }
                .divider {
                    border-top: 1px dashed #000;
                    margin: 15px 0;
                }
                .info-table {
                    width: 100%;
                    font-size: 12px;
                    margin-bottom: 15px;
                }
                .info-table td {
                    padding: 3px 0;
                }
                .items-table {
                    width: 100%;
                    border-collapse: collapse;
                    margin: 15px 0;
                }
                .items-table th {
                    border-bottom: 1px dashed #000;
                    font-size: 12px;
                    padding: 5px 0;
                    text-align: left;
                }
                .total-section {
                    font-size: 13px;
                    margin-top: 20px;
                }
                .total-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 4px 0;
                }
                .grand-total {
                    font-size: 16px;
                    font-weight: bold;
                    border-top: 1px dashed #000;
                    padding-top: 8px;
                    margin-top: 8px;
                }
                .footer {
                    text-align: center;
                    font-size: 11px;
                    color: #777;
                    margin-top: 30px;
                }
            </style>
        </head>
        <body>
            <div class="receipt-container">
                <div class="header">
                    <h1>${restaurantName}</h1>
                    ${formattedAddress ? `<p>${formattedAddress}</p>` : ''}
                    <div class="divider"></div>
                    <p style="font-weight: bold; font-size: 14px;">ROOM BILL RECEIPT</p>
                    <p style="font-size: 11px;">Invoice No: INV-${booking.id.slice(0, 8).toUpperCase()}</p>
                    <p style="font-size: 11px;">Date: ${new Date().toLocaleString()}</p>
                </div>

                <table class="info-table">
                    <tr>
                        <td><strong>GUEST:</strong> ${booking.guest_name}</td>
                        <td style="text-align: right;"><strong>ROOM:</strong> ${roomNumber} (${roomTypeName})</td>
                    </tr>
                    <tr>
                        <td><strong>CHECK IN:</strong> ${new Date(booking.check_in).toLocaleDateString()}</td>
                        <td style="text-align: right;"><strong>CHECK OUT:</strong> ${new Date(booking.check_out).toLocaleDateString()}</td>
                    </tr>
                    <tr>
                        <td><strong>NIGHTS:</strong> ${folio.nights}</td>
                        <td style="text-align: right;"><strong>PHONE:</strong> ${booking.guest_phone || 'N/A'}</td>
                    </tr>
                </table>

                <div class="divider"></div>

                <table class="items-table">
                    <thead>
                        <tr>
                            <th>DESCRIPTION</th>
                            <th style="text-align: right;">AMOUNT</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px;">Room Stay (${folio.nights} nights @ ${fmt(folio.stayCost / folio.nights)})</td>
                            <td style="padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 13px; text-align: right; font-weight: 600;">${fmt(folio.stayCost)}</td>
                        </tr>
                        ${chargesRows}
                        ${ordersRows}
                    </tbody>
                </table>

                <div class="divider"></div>

                <div class="total-section">
                    <div class="total-row">
                        <span>Room Subtotal:</span>
                        <span>${fmt(folio.stayCost)}</span>
                    </div>
                    ${folio.discountAmount > 0 ? `
                    <div class="total-row" style="color: #c2410c;">
                        <span>Bargain Discount:</span>
                        <span>-${fmt(folio.discountAmount)}</span>
                    </div>
                    ` : ''}
                    <div class="total-row">
                        <span>Charges Subtotal:</span>
                        <span>${fmt(folio.chargesTotal)}</span>
                    </div>
                    <div class="total-row">
                        <span>Food Orders:</span>
                        <span>${fmt(folio.ordersTotal)}</span>
                    </div>
                    ${folio.vat > 0 ? `
                    <div class="total-row">
                        <span>VAT (13%):</span>
                        <span>${fmt(folio.vat)}</span>
                    </div>
                    ` : ''}
                    <div class="total-row grand-total">
                        <span>TOTAL DUE:</span>
                        <span>${fmt(folio.total)}</span>
                    </div>
                    <div class="total-row" style="font-weight: bold; margin-top: 4px;">
                        <span>PAID AMOUNT:</span>
                        <span>${fmt(Number(booking.paid_amount || 0))}</span>
                    </div>
                </div>

                <div class="divider"></div>
                <div class="footer">
                    <p>*** THANK YOU FOR YOUR STAY! ***</p>
                    <p>We hope to see you again soon.</p>
                </div>
            </div>
        </body>
        </html>
        `

        // 5. Send Email via Resend
        const emailResponse = await sendEmail({
            to: email,
            subject: `Invoice Receipt Room ${roomNumber} — ${restaurantName}`,
            html
        })

        if (!emailResponse.success) {
            return NextResponse.json({ error: emailResponse.error || 'Failed to send email' }, { status: 500 })
        }

        return NextResponse.json({ success: true, messageId: emailResponse.messageId })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Server error'
        console.error('Email invoice dispatch error:', e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
