/// <reference path="../pb_data/types.d.ts" />

// Tworzy kolekcje gry na świeżej instancji PocketBase (np. `pnpm party` na nowym komputerze).
// Jeśli kolekcja już istnieje (przywrócony backup, ręczna konfiguracja) — jest pomijana.
// Reguły API zostają puste (null) = dostęp tylko dla superusera; serwer gry loguje się jako admin.

migrate((app) => {
  const exists = (name) => {
    try {
      app.findCollectionByNameOrId(name);
      return true;
    } catch (_) {
      return false;
    }
  };

  const users = app.findCollectionByNameOrId('users');
  if (!users.fields.getByName('username')) {
    users.fields.add(new TextField({ name: 'username', max: 40 }));
    users.indexes.push(
      "CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`) WHERE `username` != ''"
    );
    app.save(users);
  }

  const rel = (name, collection, required = true) => ({
    name,
    type: 'relation',
    required,
    collectionId: collection.id,
    maxSelect: 1,
    cascadeDelete: false,
  });
  const select = (name, values, required = false) => ({ name, type: 'select', required, maxSelect: 1, values });

  const create = (name, fields, indexes = []) => {
    if (exists(name)) return app.findCollectionByNameOrId(name);
    const c = new Collection({
      type: 'base',
      name,
      fields: [
        ...fields,
        { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes,
    });
    app.save(c);
    return c;
  };

  const rooms = create(
    'rooms',
    [
      { name: 'code', type: 'text', required: true, min: 5, max: 5 },
      rel('host_id', users),
      select('status', ['lobby', 'in_progress', 'finished'], true),
      { name: 'settings', type: 'json' },
    ],
    ['CREATE UNIQUE INDEX `idx_rooms_code` ON `rooms` (`code`)']
  );

  create(
    'room_players',
    [
      rel('room_id', rooms),
      rel('user_id', users),
      select('role', ['citizen', 'detective', 'doctor', 'mafia']),
      { name: 'is_master', type: 'bool' },
      { name: 'is_bot', type: 'bool' },
      { name: 'eliminated_at', type: 'date' },
      { name: 'seat_order', type: 'number' },
    ],
    ['CREATE UNIQUE INDEX `idx_room_players_unique` ON `room_players` (`room_id`, `user_id`)']
  );

  const rounds = create('rounds', [
    rel('room_id', rooms),
    { name: 'round_number', type: 'number', required: true },
    select(
      'phase',
      [
        'role_reveal',
        'night_detective',
        'night_doctor',
        'night_mafia',
        'night_resolve',
        'day_deliberation',
        'day_vote',
        'day_resolve',
      ],
      true
    ),
  ]);

  create('night_actions', [
    rel('round_id', rounds),
    rel('actor_id', users),
    select('action_type', ['investigate', 'protect', 'kill'], true),
    rel('target_id', users),
    { name: 'result', type: 'json' },
  ]);

  create(
    'votes',
    [rel('round_id', rounds), rel('voter_id', users), rel('target_id', users, false)],
    ['CREATE UNIQUE INDEX `idx_votes_unique` ON `votes` (`round_id`, `voter_id`)']
  );

  create('messages', [
    rel('room_id', rooms),
    rel('user_id', users),
    select('channel', ['lobby', 'day', 'mafia_night'], true),
    { name: 'body', type: 'text', required: true },
  ]);
}, (_app) => {
  // Bez automatycznego rollbacku — nie kasujemy danych gry.
});
