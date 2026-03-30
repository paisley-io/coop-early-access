// GET /api/affiliates/admin
// Returns full program tree, all members, pending reward totals.
// Protected by x-admin-secret header.
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  const programs = await sql`
    SELECT p.*,
      COUNT(DISTINCT mp.member_email)::int AS member_count,
      COALESCE(SUM(r.reward), 0) AS total_rewards_owed
    FROM aff_programs p
    LEFT JOIN aff_member_programs mp ON mp.program_id = p.id
    LEFT JOIN aff_referrals r ON r.program_id = p.id AND r.status = 'pending'
    GROUP BY p.id
    ORDER BY p.created_at ASC
  `;

  const members = await sql`
    SELECT m.*,
      COUNT(r.id)::int AS referral_count,
      COALESCE(SUM(r.reward), 0) AS pending_reward
    FROM aff_members m
    LEFT JOIN aff_referrals r ON r.referrer = m.email AND r.status = 'pending'
    GROUP BY m.email, m.name, m.referrer, m.created_at
    ORDER BY m.created_at DESC
  `;

  const [summary] = await sql`
    SELECT
      COUNT(DISTINCT m.email)::int AS total_members,
      COALESCE(SUM(r.reward), 0) AS total_pending_pai
    FROM aff_members m
    LEFT JOIN aff_referrals r ON r.referrer = m.email AND r.status = 'pending'
  `;

  return res.status(200).json({
    summary: {
      total_members: summary.total_members,
      total_pending_pai: Number(summary.total_pending_pai),
    },
    programs: programs.map(p => ({
      ...p,
      total_rewards_owed: Number(p.total_rewards_owed),
    })),
    members: members.map(m => ({
      email: m.email,
      name: m.name,
      referrer: m.referrer,
      referral_count: m.referral_count,
      pending_reward: Number(m.pending_reward),
      joined: m.created_at,
    })),
  });
}
