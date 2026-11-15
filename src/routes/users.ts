import type { FastifyInstance } from 'fastify';
import { pool } from '../db/connection.js';
import { firebaseAuth } from '../middleware/auth.js';

const USER_COLUMNS = 'id, email, name, created_at, updated_at';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: Date;
  updated_at: Date;
}

function toProfile(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', firebaseAuth);

  // Chamado uma única vez pelo frontend, após o primeiro login no Firebase.
  app.post('/users', async (request, reply) => {
    const uid = request.firebaseUid!;
    const email = request.firebaseEmail;
    if (!email) {
      return reply.status(422).send({ error: 'Token sem e-mail associado' });
    }
    const body = request.body as { name?: unknown } | undefined;
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;

    const inserted = await pool.query<UserRow>(
      `INSERT INTO users (id, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [uid, email, name],
    );

    const row =
      inserted.rows[0] ??
      (await pool.query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
        [uid],
      )).rows[0];

    return reply.status(201).send(toProfile(row));
  });

  app.get('/users/me', async (request, reply) => {
    const { rows } = await pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
      [request.firebaseUid!],
    );
    if (!rows[0]) {
      return reply.status(404).send({ error: 'Usuário não registrado. Chame POST /api/users primeiro.' });
    }
    return toProfile(rows[0]);
  });

  app.patch('/users/me', async (request, reply) => {
    const uid = request.firebaseUid!;
    const name = (request.body as { name?: unknown } | undefined)?.name;
    if (typeof name !== 'string' || !name.trim()) {
      return reply.status(400).send({ error: 'Campo "name" é obrigatório' });
    }

    const { rows } = await pool.query<UserRow>(
      `UPDATE users SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [uid, name.trim()],
    );
    if (!rows[0]) {
      return reply.status(404).send({ error: 'Usuário não registrado. Chame POST /api/users primeiro.' });
    }
    return toProfile(rows[0]);
  });
}
