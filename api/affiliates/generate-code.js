// POST /api/affiliates/generate-code
// Body: { email, program_id? }
// Creates (or returns existing) invite code for a member.
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email, program_id = 'paisley-root' } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  // Must be a member
  const [member] = await sql`SELECT email FROM aff_members WHERE email = ${email}`;
  if (!member) return res.status(403).json({ error: 'Not a member' });

  // Return existing code if they already have one for this program
  const [existing] = await sql`
    SELECT code FROM aff_invite_codes
    WHERE referrer = ${email} AND program_id = ${program_id} AND active = true
    LIMIT 1
  `;
  if (existing) {
    return res.status(200).json({
      code: existing.code,
      link: `https://paisley.coop/ref?code=${existing.code}`,
    });
  }

  // Create new code
  const code = nanoid(8);
  await sql`
    INSERT INTO aff_invite_codes (code, referrer, program_id)
    VALUES (${code}, ${email}, ${program_id})
  `;

  return res.status(200).json({
    code,
    link: `https://paisley.coop/ref?code=${code}`,
  });
}

function nanoid(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}
