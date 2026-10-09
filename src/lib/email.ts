/**
 * Transactional email delivery.
 *
 * Brevo is preferred when configured because it is also the production SMTP
 * provider for Supabase Auth. Resend remains a fallback for existing
 * deployments while they migrate.
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

export async function sendEmail(options: EmailOptions) {
  if (process.env.BREVO_API_KEY) {
    const senderEmail = options.from || process.env.BREVO_FROM_EMAIL || process.env.RESEND_FROM_EMAIL
    if (!senderEmail) {
      console.warn('BREVO_FROM_EMAIL not set — email will not be sent')
      return { success: false, error: 'Email sender is not configured' }
    }

    try {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sender: {
            email: senderEmail,
            name: process.env.BREVO_FROM_NAME || 'KKKhane',
          },
          to: [{ email: options.to }],
          subject: options.subject,
          htmlContent: options.html,
          textContent: options.text,
        }),
      })

      const payload = await response.json().catch(() => null) as { messageId?: string; message?: string } | null
      if (!response.ok) {
        console.error('Brevo email error:', payload?.message || response.statusText)
        return { success: false, error: payload?.message || 'Brevo rejected the email' }
      }

      return { success: true, messageId: payload?.messageId }
    } catch (error) {
      console.error('Failed to send email through Brevo:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown email error' }
    }
  }

  if (process.env.RESEND_API_KEY) {
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

      return { success: true, messageId: response.data?.id }
    } catch (error) {
      console.error('Failed to send email through Resend:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown email error' }
    }
  }

  console.warn('Neither BREVO_API_KEY nor RESEND_API_KEY is set — email will not be sent')
  return { success: false, error: 'Email service not configured' }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character)
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
    staffName: string,
    restaurantName: string,
    roleName: string,
    inviteUrl: string,
    expiresInDays: number
) {
    const formattedRole = escapeHtml(roleName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))
    const safeStaffName = escapeHtml(staffName)
    const safeRestaurantName = escapeHtml(restaurantName)
    const safeInviteUrl = escapeHtml(inviteUrl)

    const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1B263B;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px">You've been invited to ${safeRestaurantName}</h1>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 16px;color:#374151">Hi ${safeStaffName},</p>
    <p style="margin:0 0 16px;color:#374151;font-size:14px">
      You've been invited to join <strong>${safeRestaurantName}</strong> as <strong>${formattedRole}</strong>. Click below to complete your profile and join the team.
    </p>
    <a href="${safeInviteUrl}" style="display:inline-block;background:#FB6303;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Join Team →</a>
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

export async function sendPasswordResetCodeEmail(email: string, code: string) {
  const safeCode = escapeHtml(code)
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1B263B;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px">Reset your KKKhane password</h1>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 16px;color:#374151;font-size:14px">Enter this verification code on the password reset screen:</p>
    <div style="margin:20px 0;padding:16px;border-radius:10px;background:#fff7ed;color:#c2410c;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${safeCode}</div>
    <p style="margin:0;font-size:13px;color:#6b7280">This code expires in 1 hour and can be used only once.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#9ca3af">If you did not request a password reset, you can safely ignore this email.</p>
  </div>
</div></body></html>`

  return sendEmail({
    to: email,
    subject: `${code} is your KKKhane password reset code`,
    html,
    text: `Your KKKhane password reset code is ${code}. It expires in 1 hour.`,
  })
}

export async function sendSignupVerificationCodeEmail(email: string, code: string, recipientName: string) {
  const safeCode = escapeHtml(code)
  const safeName = escapeHtml(recipientName)
  const html = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
  <div style="background:#1B263B;padding:20px 24px">
    <h1 style="margin:0;color:#fff;font-size:18px">Verify your KKKhane email</h1>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 16px;color:#374151;font-size:14px">Hi ${safeName}, enter this code to verify your email and continue setting up your business:</p>
    <div style="margin:20px 0;padding:16px;border-radius:10px;background:#fff7ed;color:#c2410c;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center">${safeCode}</div>
    <p style="margin:0;font-size:13px;color:#6b7280">This code expires in 1 hour and can be used only once.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#9ca3af">If you did not create a KKKhane account, you can safely ignore this email.</p>
  </div>
</div></body></html>`

  return sendEmail({
    to: email,
    subject: `${code} is your KKKhane verification code`,
    html,
    text: `Hi ${recipientName}, your KKKhane verification code is ${code}. It expires in 1 hour.`,
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
