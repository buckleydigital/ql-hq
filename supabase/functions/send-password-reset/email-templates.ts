// =============================================================================
// QuoteLeadsHQ — Email Templates
// =============================================================================
// Co-located email templates for this edge function.
// All templates use inline styles for maximum email client compatibility.
// =============================================================================

const BRAND_COLOR = "#1f6fff";
const BRAND_NAME = "QuoteLeadsHQ";

function baseLayout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f9;padding:40px 20px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)">
<tr><td style="background:${BRAND_COLOR};padding:24px 32px">
  <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600">${BRAND_NAME}</h1>
</td></tr>
<tr><td style="padding:32px">
  ${content}
</td></tr>
<tr><td style="padding:16px 32px;background:#f8f9fb;border-top:1px solid #e5e7eb">
  <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
    &copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function buttonHtml(text: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${text}</a>
</td></tr></table>`;
}

// ── Notification emails ───────────────────────────────────────────────────────

export function callbackBookedEmail(leadName: string, scheduledTime: string, companyName: string): { subject: string; html: string } {
  return {
    subject: `Callback booked with ${leadName}`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Callback Booked</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Your AI assistant has booked a callback with <strong>${leadName}</strong>.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Scheduled for:</strong> ${scheduledTime}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Company:</strong> ${companyName}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to your dashboard to view details and prepare for the call.</p>
    `),
  };
}

export function onsiteBookedEmail(leadName: string, scheduledTime: string, companyName: string): { subject: string; html: string } {
  return {
    subject: `On-site visit booked with ${leadName}`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">On-Site Visit Booked</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Your AI assistant has booked an on-site visit with <strong>${leadName}</strong>.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Scheduled for:</strong> ${scheduledTime}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Company:</strong> ${companyName}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to your dashboard to view details and prepare for the visit.</p>
    `),
  };
}

export function quoteDraftedEmail(leadName: string, quoteNumber: string, total: string, companyName: string): { subject: string; html: string } {
  return {
    subject: `Quote ${quoteNumber} drafted for ${leadName}`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Quote Drafted</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Your AI assistant has drafted a quote for <strong>${leadName}</strong>.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Quote:</strong> ${quoteNumber}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Total:</strong> ${total}</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Company:</strong> ${companyName}</p>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">Log in to review the quote, make adjustments, and send it to the lead.</p>
    `),
  };
}

export function inviteRepEmail(repName: string, companyName: string, inviteLink: string): { subject: string; html: string } {
  return {
    subject: `You've been invited to join ${companyName} on QuoteLeadsHQ`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">You're Invited!</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Hi ${repName},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151">You've been invited to join <strong>${companyName}</strong> on ${BRAND_NAME}. Click the button below to set up your account and get started.</p>
      ${buttonHtml("Accept Invitation", inviteLink)}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">If you didn't expect this invitation, you can safely ignore this email.</p>
    `),
  };
}

export function passwordResetEmail(resetLink: string): { subject: string; html: string } {
  return {
    subject: "Reset your QuoteLeadsHQ password",
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Password Reset</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#374151">We received a request to reset your password. Click the button below to choose a new password.</p>
      ${buttonHtml("Reset Password", resetLink)}
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280">This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
    `),
  };
}

export function welcomeEmail(userName: string): { subject: string; html: string } {
  return {
    subject: `Welcome to ${BRAND_NAME}!`,
    html: baseLayout(`
      <h2 style="margin:0 0 16px;font-size:18px;color:#111827">Welcome to ${BRAND_NAME}!</h2>
      <p style="margin:0 0 8px;font-size:14px;color:#374151">Hi ${userName},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#374151">Your account has been created. You can now log in to manage your leads, quotes, and appointments with AI-powered automation.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#374151"><strong>Here's what you can do:</strong></p>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#374151">
        <li style="margin-bottom:6px">Set up your AI SMS agent for automated lead responses</li>
        <li style="margin-bottom:6px">Configure callback and on-site scheduling</li>
        <li style="margin-bottom:6px">Create and send professional quotes</li>
        <li style="margin-bottom:6px">Track your sales pipeline</li>
      </ul>
      <p style="margin:0;font-size:13px;color:#6b7280">Need help getting started? Check out our documentation or reach out to support.</p>
    `),
  };
}
