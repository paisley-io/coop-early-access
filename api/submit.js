import { neon } from '@neondatabase/serverless';
import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, role, country, ambassador, website } = req.body;

  // Honeypot — bots fill hidden fields, humans don't
  if (website) return res.status(200).json({ success: true });

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Reject obviously malformed emails
  if (email.startsWith('www.') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  // Reject random-string names (bots): low vowel ratio in long strings
  if (name && name.length > 8 && !name.includes(' ')) {
    const vowels = (name.match(/[aeiouAEIOU]/g) || []).length;
    if (vowels / name.length < 0.2) {
      return res.status(200).json({ success: true }); // silent reject
    }
  }

  // Reject random-string countries
  if (country && country.length > 50) {
    return res.status(200).json({ success: true }); // silent reject
  }

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  try {
    // Ensure table exists (original schema — no UNIQUE constraint to avoid breaking existing data)
    await sql`
      CREATE TABLE IF NOT EXISTS paisley_leads (
        id          SERIAL PRIMARY KEY,
        name        TEXT,
        email       TEXT NOT NULL,
        role        TEXT,
        country     TEXT,
        ambassador  TEXT DEFAULT 'no',
        source      TEXT DEFAULT 'early-access',
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Check for existing lead and existing affiliate member separately
    const existing = await sql`
      SELECT id FROM paisley_leads WHERE email = ${email} LIMIT 1
    `;
    const isNew = existing.length === 0;

    if (isNew) {
      await sql`
        INSERT INTO paisley_leads (name, email, role, country, ambassador)
        VALUES (${name || null}, ${email}, ${role || null}, ${country || null}, ${ambassador || 'no'})
      `;
    }

    // Affiliate enrollment — runs for new AND existing leads who aren't enrolled yet
    const existingMember = await sql`
      SELECT email FROM aff_members WHERE email = ${email} LIMIT 1
    `;
    const isNewMember = existingMember.length === 0;

    if (isNewMember) {
      await sql`
        INSERT INTO aff_members (email, name)
        VALUES (${email}, ${name || null})
        ON CONFLICT (email) DO NOTHING
      `;
      await sql`
        INSERT INTO aff_member_programs (member_email, program_id)
        VALUES (${email}, 'paisley-root')
        ON CONFLICT DO NOTHING
      `;
      const code = nanoid(8);
      await sql`
        INSERT INTO aff_invite_codes (code, referrer, program_id)
        VALUES (${code}, ${email}, 'paisley-root')
        ON CONFLICT DO NOTHING
      `;
    }

    // Send emails via Resend (new lead OR existing lead newly enrolled as affiliate)
    if ((isNew || isNewMember) && process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const firstName = name ? name.split(' ')[0] : 'there';

      // Get their invite code for the confirmation email
      const [codeRow] = await sql`
        SELECT code FROM aff_invite_codes WHERE referrer = ${email} LIMIT 1
      `;
      const myLink = codeRow ? `https://paisley.coop/ref?code=${codeRow.code}` : null;

      // Confirmation to user
      await resend.emails.send({
        from: 'Paisley <hello@paisley.coop>',
        to: email,
        subject: "You're on the Paisley early access list",
        html: confirmationEmail(firstName, ambassador === 'yes', myLink),
      });

      // Notification to Rich
      await resend.emails.send({
        from: 'Paisley Signups <hello@paisley.coop>',
        to: 'rich@paisley.coop',
        subject: `New early access signup: ${name || email}`,
        html: `
          <p><strong>Name:</strong> ${name || '—'}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Role:</strong> ${role || '—'}</p>
          <p><strong>Country:</strong> ${country || '—'}</p>
          <p><strong>Ambassador:</strong> ${ambassador || 'no'}</p>
        `,
      });
    }

    // Return code so the UI can display the referral link immediately
    const [codeResult] = await sql`
      SELECT code FROM aff_invite_codes WHERE referrer = ${email} LIMIT 1
    `;
    return res.status(200).json({ success: true, new: isNew, code: codeResult?.code || null });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

function nanoid(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function confirmationEmail(firstName, isAmbassador, myLink) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#F9F9FB;font-family:'Source Sans Pro',Arial,sans-serif;color:#231F56;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9F9FB;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#231F56;padding:32px 40px;">
            <img src="https://paisley.coop/assets/logos/paisley-logo-white.svg" alt="Paisley" height="36"
              onerror="this.style.display='none'" />
            <p style="margin:8px 0 0;font-family:'IBM Plex Sans',Arial,sans-serif;font-size:13px;color:#CAD22C;letter-spacing:0.08em;text-transform:uppercase;">
              Early Access
            </p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 40px 32px;">
            <h1 style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:26px;font-weight:700;margin:0 0 16px;color:#231F56;">
              You're in, ${firstName}.
            </h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#231F56;">
              You're on the Paisley early access list. We'll reach out when your wallet is ready and minting opens.
            </p>

            <table cellpadding="0" cellspacing="0" style="background:#F9F9FB;border-radius:8px;padding:24px;width:100%;margin-bottom:24px;">
              <tr><td>
                <p style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6A54A3;margin:0 0 12px;">
                  Your early access includes
                </p>
                <p style="margin:0 0 8px;font-size:15px;">✓&nbsp; First wallet access</p>
                <p style="margin:0 0 8px;font-size:15px;">✓&nbsp; First minting rights for Time Credits</p>
                <p style="margin:0 0 8px;font-size:15px;">✓&nbsp; Launch updates before the public</p>
                ${isAmbassador ? '<p style="margin:0 0 8px;font-size:15px;">✓&nbsp; Ambassador program invitation</p>' : ''}
              </td></tr>
            </table>

            <p style="font-size:15px;line-height:1.6;margin:0 0 32px;color:#6A54A3;">
              Paisley is a freelancer-owned cooperative — no platform tax, no waiting on invoices.
              We'll keep you posted as we get closer to launch.
            </p>

            ${myLink ? `
            <div style="background:#F9F9FB;border-radius:8px;padding:20px 24px;margin-bottom:24px;">
              <p style="font-family:'IBM Plex Sans',Arial,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#6A54A3;margin:0 0 8px;">Your referral link</p>
              <p style="font-size:13px;color:#0BA9C2;margin:0 0 12px;word-break:break-all;">${myLink}</p>
              <a href="${myLink}" style="display:inline-block;background:#CAD22C;color:#231F56;font-family:'IBM Plex Sans',Arial,sans-serif;font-weight:700;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;">Share your link →</a>
            </div>` : ''}

            <a href="https://paisley.coop" style="display:inline-block;background:#231F56;color:#fff;font-family:'IBM Plex Sans',Arial,sans-serif;font-weight:700;font-size:15px;padding:14px 28px;border-radius:8px;text-decoration:none;">
              Learn more about Paisley →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;border-top:1px solid #F0F0F6;">
            <p style="font-size:13px;color:#6A54A3;margin:0;">
              You're receiving this because you signed up at paisley.coop.
              Not you? You can safely ignore this email.
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
