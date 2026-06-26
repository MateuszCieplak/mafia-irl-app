/**
 * In-memory PocketBase-like client for integration tests.
 * Collection names match production (rooms, room_players, …); data is isolated per test instance.
 */

function parseEq(filter, field) {
  const re = new RegExp(`${field}\\s*=\\s*"([^"]*)"`);
  const m = filter.match(re);
  return m ? m[1] : null;
}

function matchesFilter(record, filter) {
  if (!filter || filter.trim() === '') return true;
  const parts = filter.split('&&').map((p) => p.trim());

  for (const part of parts) {
    if (part.includes('eliminated_at != ""')) {
      if (!record.eliminated_at) return false;
      continue;
    }
    if (part.includes('role = "mafia"')) {
      if (record.role !== 'mafia') return false;
      continue;
    }
    const roomId = parseEq(part, 'room_id');
    if (roomId !== null && record.room_id !== roomId) return false;

    const userId = parseEq(part, 'user_id');
    if (userId !== null && record.user_id !== userId) return false;

    const code = parseEq(part, 'code');
    if (code !== null && record.code !== code) return false;

    const roundId = parseEq(part, 'round_id');
    if (roundId !== null && record.round_id !== roundId) return false;
  }
  return true;
}

export function createMockPocketBase() {
  const store = {
    rooms: [],
    room_players: [],
    rounds: [],
    night_actions: [],
    votes: [],
    messages: [],
  };
  let seq = 1;
  const nextId = (prefix) => `${prefix}_${seq++}`;

  function coll(name) {
    if (!store[name]) store[name] = [];
    const items = store[name];

    return {
      async create(body) {
        const id = body.id || nextId(name);
        const rec = {
          id,
          ...body,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        };
        items.push(rec);
        return { ...rec };
      },

      async update(id, patch) {
        const rec = items.find((r) => r.id === id);
        if (!rec) throw new Error(`mock pb: record not found ${id}`);
        Object.assign(rec, patch, { updated: new Date().toISOString() });
        return { ...rec };
      },

      async getList(_page, perPage = 50, opts = {}) {
        const filtered = items.filter((r) => matchesFilter(r, opts.filter));
        return { items: filtered.slice(0, perPage) };
      },

      async getFullList(opts = {}) {
        return items.filter((r) => matchesFilter(r, opts.filter));
      },

      async delete(id) {
        const i = items.findIndex((r) => r.id === id);
        if (i >= 0) items.splice(i, 1);
      },
    };
  }

  return {
    collection: (name) => coll(name),
    /** Test helper: raw access */
    _store: store,
  };
}
