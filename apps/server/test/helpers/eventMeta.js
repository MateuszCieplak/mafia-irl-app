import { expect } from 'vitest';

/** Ogólne asercje ze specyfikacji: roomId + timestamp na payloadach. */
export function expectEventMeta(payload, roomId, roomCode) {
  expect(payload).toHaveProperty('roomId', roomId);
  expect(payload).toHaveProperty('roomCode', roomCode);
  expect(typeof payload.timestamp).toBe('number');
}
