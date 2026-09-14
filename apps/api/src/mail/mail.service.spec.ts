import { MailService } from './mail.service';

describe('MailService', () => {
  const previous = process.env.SMTP_URL;

  afterEach(() => {
    if (previous === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = previous;
  });

  it('logs mail when SMTP is not configured', async () => {
    delete process.env.SMTP_URL;
    const mail = new MailService();
    const result = await mail.sendVerification('user@example.com', 'token-value');
    expect(result).toEqual({ delivered: false, logged: true });
  });
});
