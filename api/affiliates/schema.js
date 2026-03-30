// Run once to set up affiliate tables.
// Call: POST /api/affiliates/schema  (protect with ADMIN_SECRET in production)
import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-admin-secret'] !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sql = neon(process.env.paisley_coop_DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS aff_programs (
      id          TEXT PRIMARY KEY,               -- 'paisley-root' or nanoid
      owner_email TEXT NOT NULL,
      parent_id   TEXT REFERENCES aff_programs(id),
      name        TEXT NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true,
      budget_cap  NUMERIC NOT NULL DEFAULT 0,     -- PAI units; 0 until token live
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS aff_members (
      id          SERIAL PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      name        TEXT,
      referrer    TEXT,                           -- email of referrer; NULL = direct
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Join table: member belongs to one or more programs
  await sql`
    CREATE TABLE IF NOT EXISTS aff_member_programs (
      member_email  TEXT NOT NULL,
      program_id    TEXT NOT NULL REFERENCES aff_programs(id),
      PRIMARY KEY (member_email, program_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS aff_referrals (
      id            SERIAL PRIMARY KEY,
      referrer      TEXT NOT NULL,               -- email
      referred      TEXT NOT NULL,               -- email
      program_id    TEXT NOT NULL REFERENCES aff_programs(id),
      reward        NUMERIC NOT NULL DEFAULT 0,  -- PAI owed; 0 until token live
      status        TEXT NOT NULL DEFAULT 'pending', -- pending | paid
      tx_hash       TEXT,                        -- filled on Phase 2 settlement
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS aff_referrals_referrer ON aff_referrals(referrer)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS aff_referrals_status ON aff_referrals(status)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS aff_invite_codes (
      code          TEXT PRIMARY KEY,            -- nanoid short code
      referrer      TEXT NOT NULL,               -- email
      program_id    TEXT NOT NULL REFERENCES aff_programs(id),
      max_uses      INTEGER NOT NULL DEFAULT 0,  -- 0 = unlimited
      redeemed      INTEGER NOT NULL DEFAULT 0,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS aff_invite_codes_referrer ON aff_invite_codes(referrer)
  `;

  // Seed the root program if it doesn't exist
  await sql`
    INSERT INTO aff_programs (id, owner_email, name)
    VALUES ('paisley-root', 'rich@paisley.coop', 'Paisley Co-op')
    ON CONFLICT (id) DO NOTHING
  `;

  return res.status(200).json({ ok: true, message: 'Affiliate schema ready' });
}
