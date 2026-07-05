/**
 * Email Service Integration
 * Supports: Resend (default), SendGrid, or custom SMTP
 */

import { Resend } from 'resend'

let resendInstance: Resend | null = null

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
}

/**
 * Send email via Resend
 * Requires RESEND_API_KEY environment variable
 */
export async function sendEmail(options: EmailOptions) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — email will not be sent')
    return { success: false, error: 'Email service not configured' }
  }

  if (!resendInstance) {
    resendInstance = new Resend(process.env.RESEND_API_KEY)
  }

  try {
    const response = await resendInstance.emails.send({
      from: options.from || process.env.RESEND_FROM_EMAIL || 'noreply@khane.com',
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    })

    if (response.error) {
      console.error('Resend email error:', response.error)
      return { success: false, error: response.error.message }
    }

    console.log('Email sent:', response.data?.id)
    return { success: true, messageId: response.data?.id }
  } catch (error) {
    console.error('Failed to send email:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

/**
 * Send verification email to new owner/manager
 */
export async function sendVerificationEmail(email: string, verificationLink: string, recipientName: string) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; padding: 12px 24px; background: #FB6303; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
          .footer { color: #666; font-size: 12px; margin-top: 40px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Welcome to SRMS! 🚀</h2>
          <p>Hi ${recipientName},</p>
          <p>Your restaurant management system account has been created. Click the button below to verify your email and set up your account.</p>
          <a href="${verificationLink}" class="button">Verify Email & Complete Setup</a>
          <p>Or copy this link: <a href="${verificationLink}">${verificationLink}</a></p>
          <p>This link expires in 24 hours.</p>
          <div class="footer">
            <p>If you didn't request this, please ignore this email.</p>
            <p>© 2026 SRMS — Smart Restaurant Management System</p>
          </div>
        </div>
      </body>
    </html>
  `

  return sendEmail({
    to: email,
    subject: 'Verify Your Email — SRMS Account Setup',
    html,
  })
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(email: string, resetLink: string, recipientName: string) {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; padding: 12px 24px; background: #FB6303; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
          .footer { color: #666; font-size: 12px; margin-top: 40px; }
          .warning { background: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Reset Your Password</h2>
          <p>Hi ${recipientName},</p>
          <p>We received a request to reset your SRMS account password. Click the button below to set a new password.</p>
          <a href="${resetLink}" class="button">Reset Password</a>
          <p>Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
          <div class="warning">
            <p><strong>⚠️ Security Note:</strong> If you didn't request this, do not click the link. Your password will remain unchanged.</p>
          </div>
          <p>This link expires in 1 hour.</p>
          <div class="footer">
            <p>© 2026 SRMS — Smart Restaurant Management System</p>
          </div>
        </div>
      </body>
    </html>
  `

  return sendEmail({
    to: email,
    subject: 'Reset Your SRMS Password',
    html,
  })
}

/**
 * Send new tenant onboarding email with initial credentials
 */
export async function sendOnboardingEmail(
  email: string,
  restaurantName: string,
  ownerName: string,
  dashboardUrl: string,
  tempPassword?: string
) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://kkkhane.com'
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; padding: 12px 24px; background: #FB6303; color: white; text-decoration: none; border-radius: 8px; margin: 20px 0; }
          .credentials { background: #f5f5f5; padding: 15px; border-radius: 6px; font-family: monospace; margin: 20px 0; }
          .footer { color: #666; font-size: 12px; margin-top: 40px; }
          .feature-list { list-style: none; padding: 0; }
          .feature-list li { padding: 8px 0; padding-left: 25px; position: relative; }
          .feature-list li:before { content: "✓"; position: absolute; left: 0; color: #FB6303; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Welcome to SRMS! 🎉</h2>
          <p>Hi ${ownerName},</p>
          <p>Your restaurant <strong>${restaurantName}</strong> has been successfully set up on SRMS. You can now log in to your admin dashboard and start managing orders, menu, staff, and more.</p>
          
          <a href="${dashboardUrl}" class="button">Access Your Dashboard</a>
          
          ${tempPassword ? `
          <div class="credentials">
            <p><strong>Temporary Login Credentials:</strong></p>
            <p>Email: <code>${email}</code></p>
            <p>Password: <code>${tempPassword}</code></p>
            <p style="color: #d9534f; margin-top: 10px;">⚠️ Please change your password immediately after first login.</p>
          </div>
          ` : ''}
          
          <h3>What You Can Do Now:</h3>
          <ul class="feature-list">
            <li>Manage your menu items, categories, and pricing</li>
            <li>Create QR codes for tables and accept customer orders</li>
            <li>Process payments via eSewa, Khalti, and Fonepay</li>
            <li>Set up staff accounts and manage shifts</li>
            <li>View analytics and track revenue</li>
            <li>Enable loyalty programs and promo codes</li>
          </ul>
          
          <h3>Next Steps:</h3>
          <ol>
            <li>Log in to your dashboard</li>
            <li>Update your restaurant profile (phone, address, etc.)</li>
            <li>Add your menu items with images</li>
            <li>Create tables and generate QR codes</li>
            <li>Invite staff members to your account</li>
          </ol>
          
          <p><strong>Questions?</strong> Check our documentation or reply to this email. We're here to help!</p>
          
          <div class="footer">
            <p>© 2026 SRMS — Smart Restaurant Management System</p>
            <p><a href="${appUrl}/legal/privacy">Privacy Policy</a> | <a href="${appUrl}/legal/terms">Terms of Service</a> | <a href="${appUrl}/contact">Help Center</a></p>
          </div>
        </div>
      </body>
    </html>
  `

  return sendEmail({
    to: email,
    subject: `Welcome to SRMS — Your Account is Ready! (${restaurantName})`,
    html,
  })
}

/**
 * Send payment receipt email to customer
 */
export async function sendPaymentReceiptEmail(
  customerEmail: string,
  customerName: string,
  restaurantName: string,
  orderNumber: string,
  amount: number,
  items: Array<{ name: string; quantity: number; price: number }>
) {
  const itemsHtml = items
    .map(
      item =>
        `<tr><td>${item.name}</td><td style="text-align: right;">${item.quantity}x</td><td style="text-align: right;">Rs. ${item.price.toFixed(2)}</td></tr>`
    )
    .join('')

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f5f5f5; }
          .total-row { font-weight: bold; font-size: 1.1em; }
          .footer { color: #666; font-size: 12px; margin-top: 40px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Payment Receipt</h2>
          <p>Hi ${customerName},</p>
          <p>Thank you for dining at <strong>${restaurantName}</strong>! Here's your receipt.</p>
          
          <p><strong>Order Number:</strong> #${orderNumber}</p>
          
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align: right;">Qty</th>
                <th style="text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              <tr class="total-row">
                <td colspan="2" style="text-align: right;">Total:</td>
                <td style="text-align: right;">Rs. ${amount.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          
          <p>We hope to see you again soon!</p>
          
          <div class="footer">
            <p>© 2026 SRMS — Smart Restaurant Management System</p>
          </div>
        </div>
      </body>
    </html>
  `

  return sendEmail({
    to: customerEmail,
    subject: `Receipt #${orderNumber} — ${restaurantName}`,
    html,
  })
}

export async function sendStaffInviteEmail(
    staffEmail: string,
    restaurantName: string,
    roleName: string,
    inviteUrl: string,
    expiresInDays: number
) {
    const formattedRole = roleName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1B263B;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px">You've been invited to ${restaurantName}</h1>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 16px;color:#374151">Hi there,</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px">
      You've been invited to join <strong>${restaurantName}</strong> as <strong>${formattedRole}</strong>. Click below to set your password and get started.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;background:#FB6303;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Accept Invitation &amp; Set Password →</a>
    <p style="margin:20px 0 0;font-size:13px;color:#6b7280">This invite link expires in ${expiresInDays} day${expiresInDays !== 1 ? 's' : ''}.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#9ca3af">If you did not expect this invitation, please ignore this email.</p>
  </div>
</div></body></html>`

    return sendEmail({
        to: staffEmail,
        subject: `You've been invited to ${restaurantName}`,
        html,
    })
}

export async function sendLowStockAlertEmail(
    managerEmail: string,
    restaurantName: string,
    items: { name: string; stock_quantity: number; reorder_level: number; unit: string }[]
) {
    const rows = items
        .map(i => `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6">${i.name}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:center;color:#dc2626;font-weight:600">${i.stock_quantity} ${i.unit}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:center;color:#6b7280">${i.reorder_level} ${i.unit}</td></tr>`)
        .join('')

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#fef2f2;border-bottom:1px solid #fecaca;padding:16px 24px;display:flex;align-items:center;gap:8px">
    <span style="font-size:20px">⚠️</span>
    <h2 style="margin:0;color:#dc2626;font-size:16px">Low Stock Alert — ${restaurantName}</h2>
  </div>
  <div style="padding:20px 24px">
    <p style="margin:0 0 16px;color:#374151;font-size:14px">The following ingredients have dropped below their reorder threshold:</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f9fafb">
        <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600">Ingredient</th>
        <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Current Stock</th>
        <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:600">Reorder Level</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af">Log in to the admin panel to restock these items.</p>
  </div>
</div></body></html>`

    return sendEmail({
        to: managerEmail,
        subject: `[${restaurantName}] Low Stock Alert — ${items.length} item${items.length !== 1 ? 's' : ''} need restocking`,
        html,
    })
}
