// GET /api/affiliates/dashboard?email=alice@example.com
// Returns member's referral stats, their invite code, pending rewards.
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  const [member] = await sql`SELECT * FROM aff_members WHERE email = ${email}`;
  if (!member) return res.status(404).json({ error: 'Not a member' });

  // Their referrals (people they brought in)
  const referrals = await sql`
    SELECT r.referred, r.reward, r.status, r.created_at, m.name
    FROM aff_referrals r
    LEFT JOIN aff_members m ON m.email = r.referred
    WHERE r.referrer = ${email}
    ORDER BY r.created_at DESC
  `;

  // Total pending PAI
  const [totals] = await sql`
    SELECT
      COUNT(*)::int AS total_referrals,
      COALESCE(SUM(reward), 0) AS total_reward,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN reward ELSE 0 END), 0) AS pending_reward
    FROM aff_referrals
    WHERE referrer = ${email}
  `;

  // Their active invite code(s)
  const codes = await sql`
    SELECT code, program_id, redeemed, max_uses, active
    FROM aff_invite_codes
    WHERE referrer = ${email} AND active = true
    ORDER BY created_at ASC
  `;

  // Their programs
  const programs = await sql`
    SELECT p.id, p.name, p.active, p.budget_cap
    FROM aff_programs p
    JOIN aff_member_programs mp ON mp.program_id = p.id
    WHERE mp.member_email = ${email}
  `;

  return res.status(200).json({
    member: {
      email: member.email,
      name: member.name,
      referrer: member.referrer,
      joined: member.created_at,
    },
    stats: {
      total_referrals: totals.total_referrals,
      total_reward: Number(totals.total_reward),
      pending_reward: Number(totals.pending_reward),
    },
    referrals: referrals.map(r => ({
      email: r.referred,
      name: r.name || null,
      reward: Number(r.reward),
      status: r.status,
      joined: r.created_at,
    })),
    codes: codes.map(c => ({
      code: c.code,
      program_id: c.program_id,
      link: `https://paisley.coop/ref?code=${c.code}`,
      redeemed: c.redeemed,
      max_uses: c.max_uses,
    })),
    programs,
  });
}
