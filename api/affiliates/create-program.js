// POST /api/affiliates/create-program
// Body: { owner_email, name, parent_id?, budget_cap? }
// Protected by x-admin-secret (admin creates programs) or open for members (TBD).
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { owner_email, name, parent_id = 'paisley-root', budget_cap = 0 } = req.body || {};
  if (!owner_email || !name) return res.status(400).json({ error: 'owner_email and name required' });

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  // Generate a slug-style ID from the name
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).slice(2, 6);

  await sql`
    INSERT INTO aff_programs (id, owner_email, parent_id, name, budget_cap)
    VALUES (${id}, ${owner_email}, ${parent_id}, ${name}, ${budget_cap})
  `;

  return res.status(200).json({ ok: true, program_id: id });
}
