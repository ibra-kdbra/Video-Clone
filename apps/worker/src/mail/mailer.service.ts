import { Inject, Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import type { Email } from './templates.js';

/**
 * Sends email over SMTP. Without SMTP_URL (allowed outside production) emails are written to the
 * log instead, links included, so invitations can be tried locally without a mail server.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(WORKER_CONFIG) private readonly config: WorkerConfig) {
    this.transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  async send(email: Email): Promise<void> {
    if (!this.transport) {
      this.logger.log(`Email to ${email.to} (no SMTP_URL set, not sent): ${email.subject}\n${email.text}`);
      return;
    }
    await this.transport.sendMail({ from: this.config.MAIL_FROM, to: email.to, subject: email.subject, text: email.text, html: email.html });
  }
}
