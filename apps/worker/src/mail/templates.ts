export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const ROLE_NAMES = { admin: 'an admin', instructor: 'an instructor', student: 'a student' } as const;

export interface InvitationEmail {
  email: string;
  role: keyof typeof ROLE_NAMES;
  schoolName: string;
  inviterName: string | null;
  url: string;
  expiresAt: string;
}

/** Plain text first; the HTML is the same words, every value escaped. */
export function invitationEmail(invitation: InvitationEmail): Email {
  const who = invitation.inviterName ?? 'Someone';
  const role = ROLE_NAMES[invitation.role];
  const expires = new Date(invitation.expiresAt).toUTCString().replace(/:\d\d GMT$/, ' UTC');
  const subject = `${who} invited you to ${invitation.schoolName} on Grand LMS`;
  const text = [
    `${who} invited you to join ${invitation.schoolName} on Grand LMS as ${role}.`,
    '',
    `Accept the invitation: ${invitation.url}`,
    '',
    `The link works until ${expires}, and only for ${invitation.email}.`,
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
      <p style="margin:0 0 8px;font-size:14px;color:#71717a">Grand LMS</p>
      <h1 style="margin:0 0 16px;font-size:22px">Join ${escapeHtml(invitation.schoolName)}</h1>
      <p style="margin:0 0 24px;line-height:1.5">${escapeHtml(who)} invited you to join <strong>${escapeHtml(invitation.schoolName)}</strong> as ${role}.</p>
      <p style="margin:0 0 24px"><a href="${escapeHtml(invitation.url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Accept invitation</a></p>
      <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a">The link works until ${escapeHtml(expires)}, and only for ${escapeHtml(invitation.email)}. If you weren't expecting this, you can ignore this email.</p>
    </div>
  </body>
</html>`;
  return { to: invitation.email, subject, text, html };
}
