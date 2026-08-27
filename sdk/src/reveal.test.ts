import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getTicketMatch, isRevealed, timeUntilDraw } from './reveal';
import type { TicketRecord } from './api';

function ticket(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    id: 't1',
    normalBalls: [3, 7, 11, 19, 26],
    bonusBall: 4,
    winStatus: 'DRAW_PENDING',
    winAmountUsdc: 0n,
    isFreeTicketTier: false,
    purchaseEpoch: 156,
    fulfillEpoch: 156,
    orderStatus: 'SUCCESS',
    purchasedAt: '2026-08-27T10:00:00.000Z',
    orderHash: '0xabc',
    txSignature: 'sig',
    baseTxHash: '0xdef',
    epochWinningNormals: null,
    epochWinningBonusBall: null,
    epochEndedAt: null,
    epochSettledAt: null,
    ...overrides,
  };
}

describe('getTicketMatch', () => {
  test('returns null while the draw has not revealed', () => {
    assert.equal(getTicketMatch(ticket()), null);
  });

  test('matches numbers ORDER-INDEPENDENTLY (they are a set, not a sequence)', () => {
    // Same numbers, deliberately scrambled relative to the ticket. A naive
    // index-by-index comparison would report 0 matches here.
    const m = getTicketMatch(
      ticket({
        epochWinningNormals: [26, 3, 19, 11, 7],
        epochWinningBonusBall: 4,
        epochSettledAt: '2026-08-27T20:00:00.000Z',
      })
    );
    assert.ok(m);
    assert.equal(m.normalMatches, 5);
    assert.equal(m.bonusMatch, true);
    assert.deepEqual(m.missedNormals, []);
  });

  test('counts a partial match and reports which numbers hit', () => {
    const m = getTicketMatch(
      ticket({
        epochWinningNormals: [3, 7, 30, 29, 28],
        epochWinningBonusBall: 9,
        epochSettledAt: '2026-08-27T20:00:00.000Z',
      })
    );
    assert.ok(m);
    assert.equal(m.normalMatches, 2);
    assert.equal(m.bonusMatch, false);
    assert.deepEqual(m.matchedNormals, [3, 7]);
    assert.deepEqual(m.missedNormals, [11, 19, 26]);
  });

  test('bonus can match while no normals do', () => {
    const m = getTicketMatch(
      ticket({
        epochWinningNormals: [1, 2, 5, 6, 8],
        epochWinningBonusBall: 4,
        epochSettledAt: '2026-08-27T20:00:00.000Z',
      })
    );
    assert.ok(m);
    assert.equal(m.normalMatches, 0);
    assert.equal(m.bonusMatch, true);
  });

  test('treats bonus 0 as a real value, not as missing', () => {
    // Guards against a truthiness bug: `if (!bonusBall)` would wrongly treat 0
    // as "not revealed".
    const m = getTicketMatch(
      ticket({
        bonusBall: 0,
        epochWinningNormals: [1, 2, 3, 4, 5],
        epochWinningBonusBall: 0,
        epochSettledAt: '2026-08-27T20:00:00.000Z',
      })
    );
    assert.ok(m);
    assert.equal(m.bonusMatch, true);
  });
});

describe('isRevealed', () => {
  test('false before the draw', () => {
    assert.equal(isRevealed(ticket()), false);
  });

  test('true once numbers and settle time are both present', () => {
    assert.equal(
      isRevealed(
        ticket({
          epochWinningNormals: [1, 2, 3, 4, 5],
          epochWinningBonusBall: 1,
          epochSettledAt: '2026-08-27T20:00:00.000Z',
        })
      ),
      true
    );
  });
});

describe('timeUntilDraw', () => {
  test('null when the draw time is unknown', () => {
    assert.equal(timeUntilDraw(ticket()), null);
  });

  test('counts down to a future draw', () => {
    const now = new Date('2026-08-27T10:00:00.000Z');
    const ms = timeUntilDraw(ticket({ epochEndedAt: '2026-08-27T10:00:30.000Z' }), now);
    assert.equal(ms, 30_000);
  });

  test('clamps to 0 once the draw time has passed (never negative)', () => {
    const now = new Date('2026-08-27T23:00:00.000Z');
    assert.equal(timeUntilDraw(ticket({ epochEndedAt: '2026-08-27T20:00:00.000Z' }), now), 0);
  });

  test('null on an unparseable timestamp rather than NaN', () => {
    assert.equal(timeUntilDraw(ticket({ epochEndedAt: 'not-a-date' })), null);
  });
});
