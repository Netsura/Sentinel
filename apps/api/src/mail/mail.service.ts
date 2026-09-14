import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export type MailMessage = { to: string; subject: string; text: string };

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor() {
    this.from = process.env.MAIL_FROM ?? 'Sentinel <noreply@localhost>';
    this.transport = process.env.SMTP_URL ? createTransport(process.env.SMTP_URL) : null;
  }

  async send(message: MailMessage) {
    if (!this.transport) {
      this.logger.log(JSON.stringify({ level: 'info', message: 'mail.logged', to: message.to, subject: message.subject, text: message.text }));
      return { delivered: false, logged: true };
    }

    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
    return { delivered: true, logged: false };
  }

  async sendVerification(email: string, token: string) {
    const url = `${this.appOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email,
      subject: 'Verify your Sentinel account',
      text: `Confirm this email address to finish setting up Sentinel.\n\n${url}\n\nThis link expires in 24 hours.`,
    });
  }

  async sendPasswordReset(email: string, token: string) {
    const url = `${this.appOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
    return this.send({
      to: email,
      subject: 'Reset your Sentinel password',
      text: `A password reset was requested for this Sentinel account.\n\n${url}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`,
    });
  }

  private appOrigin() {
    return process.env.WEB_ORIGIN ?? 'http://localhost:3000';
  }
}
