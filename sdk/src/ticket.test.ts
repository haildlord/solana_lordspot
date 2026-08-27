import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertTicketsValid, normalizeTickets, quickPick, validateTicket, type Ticket } from './ticket';
import { LordsPotError } from './errors';

const RULES = { normalMax: 30, bonusMax: 10 };
const VALID: Ticket = { normals: [3, 7, 11, 19, 26], bonus: 4 };

describe('validateTicket', () => {
  test('accepts a valid ticket', () => {
    assert.equal(validateTicket(VALID, RULES), null);
  });

  test('rejects wrong normal count', () => {
    assert.match(validateTicket({ normals: [1, 2, 3], bonus: 1 }, RULES) ?? '', /exactly 5/);
  });

  test('rejects duplicate normals', () => {
    assert.match(validateTicket({ normals: [5, 5, 6, 7, 8], bonus: 1 }, RULES) ?? '', /unique/);
  });

  test('rejects a normal above this epoch range', () => {
    assert.match(validateTicket({ normals: [1, 2, 3, 4, 31], bonus: 1 }, RULES) ?? '', /out of range/);
  });

  test('rejects a bonus above this epoch range', () => {
    assert.match(validateTicket({ normals: [1, 2, 3, 4, 5], bonus: 11 }, RULES) ?? '', /out of range/);
  });

  test('rejects zero and negative numbers (program requires >= 1)', () => {
    assert.ok(validateTicket({ normals: [0, 2, 3, 4, 5], bonus: 1 }, RULES));
    assert.ok(validateTicket({ normals: [1, 2, 3, 4, 5], bonus: 0 }, RULES));
    assert.ok(validateTicket({ normals: [-1, 2, 3, 4, 5], bonus: 1 }, RULES));
  });

  test('rejects non-integers', () => {
    assert.ok(validateTicket({ normals: [1.5, 2, 3, 4, 5], bonus: 1 }, RULES));
  });

  test('range check follows the epoch, not a hardcoded constant', () => {
    // 26 is valid at normalMax 30 but not at 25 — the exact failure that hits
    // an integrator reusing yesterday's ranges after a rollover.
    assert.equal(validateTicket(VALID, { normalMax: 30, bonusMax: 10 }), null);
    assert.ok(validateTicket(VALID, { normalMax: 25, bonusMax: 10 }));
  });
});

describe('assertTicketsValid', () => {
  test('throws NO_TICKETS on an empty basket', () => {
    assert.throws(
      () => assertTicketsValid([], RULES),
      (e: LordsPotError) => e.code === 'NO_TICKETS'
    );
  });

  test('reports EVERY invalid ticket at once, not just the first', () => {
    try {
      assertTicketsValid(
        [VALID, { normals: [1, 1, 2, 3, 4], bonus: 1 }, { normals: [1, 2, 3, 4, 99], bonus: 1 }],
        RULES
      );
      assert.fail('should have thrown');
    } catch (err) {
      const e = err as LordsPotError;
      assert.equal(e.code, 'INVALID_TICKET');
      assert.match(e.message, /ticket\[1\]/);
      assert.match(e.message, /ticket\[2\]/);
      assert.match(e.message, /2 of 3/);
    }
  });
});

describe('normalizeTickets', () => {
  test('sorts normals ascending (the program requires it)', () => {
    const [t] = normalizeTickets([{ normals: [26, 3, 19, 7, 11], bonus: 4 }]);
    assert.deepEqual(t!.normals, [3, 7, 11, 19, 26]);
  });

  test('does not mutate the caller’s input', () => {
    const original: Ticket = { normals: [26, 3, 19, 7, 11], bonus: 4 };
    const snapshot = [...original.normals];
    normalizeTickets([original]);
    assert.deepEqual(original.normals, snapshot);
  });
});

describe('quickPick', () => {
  test('always produces a ticket valid for the given rules', () => {
    // Randomised, so run it enough times to catch an off-by-one at the bounds.
    for (let i = 0; i < 300; i++) {
      assert.equal(validateTicket(quickPick(RULES), RULES), null);
    }
  });

  test('respects a tight range without duplicating numbers', () => {
    const tight = { normalMax: 5, bonusMax: 1 };
    for (let i = 0; i < 100; i++) {
      const t = quickPick(tight);
      assert.equal(new Set(t.normals).size, 5);
      assert.equal(validateTicket(t, tight), null);
    }
  });

  test('throws when the range is too small to pick 5 unique numbers', () => {
    assert.throws(
      () => quickPick({ normalMax: 4, bonusMax: 10 }),
      (e: LordsPotError) => e.code === 'INVALID_CONFIG'
    );
  });
});
