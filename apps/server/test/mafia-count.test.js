import { describe, it, expect } from 'vitest';
import { assignRoles, maxMafiaCount } from '../game/roles.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const mafiaOf = (map) => Object.values(map).filter((r) => r === 'mafia').length;

describe('liczba mafii', () => {
  it('limit to 34% graczy (min. 1)', () => {
    expect(maxMafiaCount(9)).toBe(3);
    expect(maxMafiaCount(8)).toBe(2);
    expect(maxMafiaCount(4)).toBe(1);
  });
  it('tryb automatyczny zostaje bez zmian', () => {
    expect(mafiaOf(assignRoles(ids(9), {}, {}))).toBe(2);
  });
  it('tryb ręczny używa liczby od mastera i przycina do limitu', () => {
    expect(mafiaOf(assignRoles(ids(9), {}, { mafia_count_manual: true, mafia_count: 3 }))).toBe(3);
    expect(mafiaOf(assignRoles(ids(9), {}, { mafia_count_manual: true, mafia_count: 6 }))).toBe(3);
    expect(mafiaOf(assignRoles(ids(8), {}, { mafia_count_manual: true, mafia_count: 3 }))).toBe(2);
    expect(mafiaOf(assignRoles(ids(9), {}, { mafia_count_manual: false, mafia_count: 3 }))).toBe(2);
  });
});
