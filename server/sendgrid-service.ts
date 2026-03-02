import sgMail from '@sendgrid/mail';

function getCredentials(): { apiKey: string; fromEmail: string } | null {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || 'noreply@hcpcrm.com';

  if (!apiKey) {
    return null;
  }

  return { apiKey, fromEmail };
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export class SendGridService {
  async sendEmail({ to, subject, html, text }: SendEmailParams): Promise<void> {
    const credentials = getCredentials();

    if (!credentials) {
      console.warn('[SendGrid] SENDGRID_API_KEY not set — skipping email to', to);
      return;
    }

    try {
      sgMail.setApiKey(credentials.apiKey);

      await sgMail.send({
        to,
        from: credentials.fromEmail,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
      });

      console.log(`[SendGrid] Email sent successfully to ${to}`);
    } catch (error) {
      console.error('[SendGrid] Email send error:', error);
      throw new Error('Failed to send email');
    }
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const subject = 'Welcome to HVAC CRM';
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to HVAC CRM!</h1>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>Welcome to your HVAC CRM system! We're excited to have you on board.</p>
            <p>Your account has been successfully created. You can now log in and start managing your customers, leads, and jobs.</p>
            <p>If you have any questions or need assistance, please don't hesitate to reach out to our support team.</p>
            <p>Best regards,<br>The HVAC CRM Team</p>
          </div>
          <div class="footer">
            <p>&copy; 2025 HVAC CRM. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({ to, subject, html });
  }

  async sendPasswordResetEmail(to: string, name: string, resetToken: string): Promise<void> {
    const appUrl = process.env.APP_URL || 'https://hcpcrm.com';
    const resetUrl = `${appUrl}/reset-password?token=${resetToken}`;
    const subject = 'Reset Your Password';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .button { display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
          .warning { background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Reset Request</h1>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>We received a request to reset your password for your HVAC CRM account.</p>
            <p>Click the button below to reset your password:</p>
            <p>
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #2563eb;">${resetUrl}</p>
            <div class="warning">
              <strong>Security Notice:</strong>
              <ul>
                <li>This link will expire in 1 hour for security reasons</li>
                <li>If you didn't request this reset, please ignore this email</li>
                <li>Your password will remain unchanged until you create a new one</li>
              </ul>
            </div>
            <p>Best regards,<br>The HVAC CRM Team</p>
          </div>
          <div class="footer">
            <p>&copy; 2025 HVAC CRM. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({ to, subject, html });
  }

  async sendPasswordChangedEmail(to: string, name: string): Promise<void> {
    const subject = 'Your Password Has Been Changed';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #059669; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9fafb; }
          .footer { padding: 20px; text-align: center; font-size: 12px; color: #6b7280; }
          .warning { background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Changed Successfully</h1>
          </div>
          <div class="content">
            <p>Hi ${name},</p>
            <p>This is a confirmation that your HVAC CRM password has been successfully changed.</p>
            <div class="warning">
              <strong>Security Alert:</strong><br>
              If you did not make this change, please contact our support team immediately.
            </div>
            <p>You can now log in with your new password.</p>
            <p>Best regards,<br>The HVAC CRM Team</p>
          </div>
          <div class="footer">
            <p>&copy; 2025 HVAC CRM. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await this.sendEmail({ to, subject, html });
  }
}

export const sendGridService = new SendGridService();
