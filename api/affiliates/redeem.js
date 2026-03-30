// POST /api/affiliates/redeem
// Body: { code, name, email }
// Looks up invite code, joins user as member, fires welcome email.
import { neon } from '@neondatabase/serverless';
import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, name, email } = req.body || {};
  if (!code || !email) return res.status(400).json({ error: 'code and email required' });

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  // Look up the invite code
  const [invite] = await sql`
    SELECT * FROM aff_invite_codes
    WHERE code = ${code} AND active = true
  `;
  if (!invite) return res.status(404).json({ error: 'Invalid or expired link' });
  if (invite.max_uses > 0 && invite.redeemed >= invite.max_uses) {
    return res.status(410).json({ error: 'This link has reached its limit' });
  }

  // Check if already a member
  const [existing] = await sql`SELECT email FROM aff_members WHERE email = ${email}`;
  if (existing) {
    // Return their info so the UI can show their dashboard
    const myCode = await getOrCreateCode(sql, email, invite.program_id);
    return res.status(200).json({ already_member: true, code: myCode });
  }

  // Join as member
  await sql`
    INSERT INTO aff_members (email, name, referrer)
    VALUES (${email}, ${name || null}, ${invite.referrer})
  `;

  // Add to root program + the specific program
  await sql`
    INSERT INTO aff_member_programs (member_email, program_id)
    VALUES (${email}, 'paisley-root')
    ON CONFLICT DO NOTHING
  `;
  if (invite.program_id !== 'paisley-root') {
    await sql`
      INSERT INTO aff_member_programs (member_email, program_id)
      VALUES (${email}, ${invite.program_id})
      ON CONFLICT DO NOTHING
    `;
  }

  // Record referral (debt ledger — reward = 0 until PAI live)
  await sql`
    INSERT INTO aff_referrals (referrer, referred, program_id)
    VALUES (${invite.referrer}, ${email}, ${invite.program_id})
  `;

  // Increment redemption count
  await sql`
    UPDATE aff_invite_codes SET redeemed = redeemed + 1 WHERE code = ${code}
  `;

  // Generate their own invite code
  const myCode = await getOrCreateCode(sql, email, invite.program_id);

  // Send welcome email
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const firstName = name ? name.split(' ')[0] : 'there';
    const myLink = `https://paisley.coop/ref?code=${myCode}`;

    await resend.emails.send({
      from: 'Paisley <hello@paisley.coop>',
      to: email,
      subject: "You joined Paisley — here's your referral link",
      html: welcomeEmail(firstName, myLink, invite.referrer),
    });

    // Notify referrer
    await resend.emails.send({
      from: 'Paisley <hello@paisley.coop>',
      to: invite.referrer,
      subject: `${name || email} joined Paisley through your link`,
      html: `
        <p style="font-family:Arial,sans-serif;color:#231F56;">
          <strong>${name || email}</strong> just joined Paisley using your referral link.
          Their reward will be credited to your account when PAI launches.
        </p>
        <p style="font-family:Arial,sans-serif;color:#6A54A3;font-size:14px;">
          <a href="https://paisley.coop/affiliates?email=${encodeURIComponent(invite.referrer)}">View your dashboard →</a>
        </p>
      `,
    });
  }

  return res.status(200).json({ success: true, code: myCode });
}

async function getOrCreateCode(sql, email, programId) {
  const [existing] = await sql`
    SELECT code FROM aff_invite_codes WHERE referrer = ${email} AND program_id = ${programId} LIMIT 1
  `;
  if (existing) return existing.code;

  const code = nanoid(8);
  await sql`
    INSERT INTO aff_invite_codes (code, referrer, program_id)
    VALUES (${code}, ${email}, ${programId})
    ON CONFLICT DO NOTHING
  `;
  return code;
}

// Tiny nanoid — no dependency needed for 8-char alphanumeric codes
function nanoid(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function welcomeEmail(firstName, myLink, referrerEmail) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#F9F9FB;font-family:'Source Sans Pro',Arial,sans-serif;color:#231F56;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F9FB;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">
        <tr>
          <td style="background:#231F56;padding:32px 40px;">
            <img src="https://paisley.coop/assets/logos/paisley-logo-white.svg" alt="Paisley" height="36"
              onerror="this.style.display='none'" />
          </td>
        </tr>
        <tr>
          <td style="padding:40px 40px 32px;">
            <h1 style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:26px;font-weight:700;margin:0 0 16px;color:#231F56;">
              Welcome to Paisley, ${firstName}.
            </h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 24px;">
              You joined through a referral from <strong>${referrerEmail}</strong>.
              When PAI launches, you'll both earn rewards.
            </p>

            <table cellpadding="0" cellspacing="0" style="background:#F9F9FB;border-radius:8px;padding:24px;width:100%;margin-bottom:24px;">
              <tr><td>
                <p style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6A54A3;margin:0 0 12px;">
                  Your referral link
                </p>
                <p style="font-size:14px;margin:0 0 16px;word-break:break-all;color:#0BA9C2;">
                  ${myLink}
                </p>
                <a href="${myLink}" style="display:inline-block;background:#CAD22C;color:#231F56;font-family:'IBM Plex Sans',Arial,sans-serif;font-weight:700;font-size:14px;padding:12px 24px;border-radius:6px;text-decoration:none;">
                  Copy &amp; share your link →
                </a>
              </td></tr>
            </table>

            <p style="font-size:15px;line-height:1.6;margin:0;color:#6A54A3;">
              Every person you refer earns you PAI rewards at launch.
              <a href="https://paisley.coop/affiliates?email=${encodeURIComponent('')}" style="color:#0BA9C2;">View your dashboard</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #F0F0F6;">
            <p style="font-size:13px;color:#6A54A3;margin:0;">
              You're receiving this because you joined Paisley Co-op via a referral link.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
  `.trim();
}
