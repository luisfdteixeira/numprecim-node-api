import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../auth/firebase.js';

declare module 'fastify' {
  interface FastifyRequest {
    firebaseUid?: string;
    firebaseEmail?: string | null;
  }
}

export async function firebaseAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing authorization header' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await auth.verifyIdToken(idToken);
    request.firebaseUid = decodedToken.uid;
    request.firebaseEmail = decodedToken.email ?? null;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}
