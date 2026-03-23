import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, role, country, ambassador } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

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

    await sql`
      INSERT INTO paisley_leads (name, email, role, country, ambassador)
      VALUES (${name || null}, ${email}, ${role || null}, ${country || null}, ${ambassador || 'no'})
    `;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('DB error:', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
