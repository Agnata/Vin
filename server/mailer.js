import nodemailer from "nodemailer";

// Returns { enabled, send(msg) }. Without SMTP configured, messages are
// written to the log instead, so development and tests work without a mail server.
export function createMailer(mail) {
  const transport = mail.smtp ? nodemailer.createTransport(mail.smtp) : null;
  const sent = [];
  return {
    enabled: !!transport,
    sent, // kept for tests when no transport is configured
    async send({ to, subject, text, html, headers }) {
      const msg = { from: mail.from, to, subject, text, html, headers };
      if (!transport) {
        sent.push(msg);
        console.log(`[e-post ej konfigurerad] Till: ${to} | ${subject}\n${text}\n`);
        return;
      }
      await transport.sendMail(msg);
    },
  };
}
