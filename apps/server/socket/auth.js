import PocketBase from 'pocketbase';
import { displayNameFromUserRecord } from '../lib/userDisplayName.js';

export async function authenticateSocket(socket, next, adminPb) {
  if (process.env.MAFIA_TEST_AUTH === '1' && socket.handshake.auth?.testUser) {
    const u = socket.handshake.auth.testUser;
    socket.userId = u.id;
    socket.username = u.username || u.id;
    socket.userEmail = (u.email || '').trim().toLowerCase();
    return next();
  }

  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('authentication_required'));
  }

  try {
    const tempPb = new PocketBase(process.env.POCKETBASE_URL || 'http://127.0.0.1:8090');
    tempPb.authStore.save(token);
    const user = await tempPb.collection('users').authRefresh();
    socket.userId = user.record.id;
    socket.username = displayNameFromUserRecord(user.record);
    socket.userEmail = (user.record.email || '').trim().toLowerCase();
    next();
  } catch {
    next(new Error('invalid_token'));
  }
}
