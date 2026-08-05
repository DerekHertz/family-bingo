import { describe, expect, it } from 'vitest';
import {
  DIGEST_DETAIL,
  MANAGED_MEMBERS_HEAR_NOTHING,
  NOTIFICATION_SWITCHES,
  NO_REMINDERS,
  QUIET_END,
  QUIET_START,
  hourMinute,
  pushRoute,
  quietHoursDetail,
} from './notifications';

describe('hourMinute (§4.8)', () => {
  it('drops the seconds PostgREST sends and nobody says', () => {
    expect(hourMinute('21:00:00')).toBe('21:00');
    expect(hourMinute('07:00:00')).toBe('07:00');
  });

  it('leaves a value that is already a clock face alone', () => {
    expect(hourMinute('21:00')).toBe('21:00');
  });

  it('shows an unparseable value as it arrived rather than inventing one', () => {
    // A settings screen that renders a plausible default over the top of something it did
    // not understand is a screen that cannot be trusted about the rest of the list.
    expect(hourMinute('')).toBe('');
    expect(hourMinute('later')).toBe('later');
  });
});

describe('quietHoursDetail (§4.8)', () => {
  it('says the window and the batching, because "one line at 07:00" is the whole feature', () => {
    expect(quietHoursDetail(QUIET_START, QUIET_END)).toBe(
      'Nothing between 21:00 and 07:00. Whatever happened arrives as one line at 07:00.',
    );
  });

  it('reads the window it is given rather than the constants', () => {
    expect(quietHoursDetail('22:30:00', '06:00:00')).toContain('22:30');
    expect(quietHoursDetail('22:30:00', '06:00:00')).toContain('06:00');
  });
});

describe('the switches offered (§4.8)', () => {
  it('offers exactly the three that have a notification kind behind them', () => {
    // §4.8 lists five. The Centre moving and a Swap write no notification and there is no
    // `kind` for either, so they are absent rather than inert.
    expect(NOTIFICATION_SWITCHES.map((s) => s.id)).toEqual([
      'tile_completed',
      'bingo_blackout',
      'almanac',
    ]);
  });

  it('never says "someone in your family"', () => {
    // §4.8's copy rule. A Member has a name and a role; "someone" is what a system says
    // when it has not bothered to find out which.
    for (const item of [...NOTIFICATION_SWITCHES, { title: '', detail: DIGEST_DETAIL }]) {
      expect(`${item.title} ${item.detail}`.toLowerCase()).not.toContain('someone in your');
    }
  });

  it('never ends a line on a question', () => {
    for (const item of NOTIFICATION_SWITCHES) {
      expect(item.title.endsWith('?')).toBe(false);
      expect(item.detail.endsWith('?')).toBe(false);
    }
    expect(DIGEST_DETAIL.endsWith('?')).toBe(false);
    expect(NO_REMINDERS.endsWith('?')).toBe(false);
  });

  it('states that there is no reminder, in the words §4.8 asks for', () => {
    // §7.11: not a reminder, a nudge, or a re-engagement push, in any form, under any
    // name. The screen has to SAY so — an absence nobody mentions reads as an oversight.
    expect(NO_REMINDERS.toLowerCase()).toContain('no daily reminder');
  });

  it('says a Managed Member is sent nothing (§4.7)', () => {
    expect(MANAGED_MEMBERS_HEAR_NOTHING.toLowerCase()).toContain('never');
  });
});

describe('pushRoute (§4.8)', () => {
  it('opens the Tile the notification is about', () => {
    expect(pushRoute({ boardId: 'b1', tileId: 't1' })).toEqual({ boardId: 'b1', tileId: 't1' });
  });

  it('opens the Board whole when there is no Tile — a Bingo has none (§13.1)', () => {
    expect(pushRoute({ boardId: 'b1' })).toEqual({ boardId: 'b1' });
  });

  it('answers null for a payload with nothing to route on', () => {
    // Every kind with no Milestone behind it: setup_closing, join_approved, the Digest.
    // The app opens as it always has, which is not a failure.
    expect(pushRoute(undefined)).toBeNull();
    expect(pushRoute(null)).toBeNull();
    expect(pushRoute({})).toBeNull();
  });

  it('refuses anything that is not two plain strings', () => {
    // This is the one place a REMOTE payload becomes navigation, and the payload may have
    // been minted by an older Edge Function than the build reading it.
    expect(pushRoute({ boardId: 42 })).toBeNull();
    expect(pushRoute({ boardId: '' })).toBeNull();
    expect(pushRoute('board/1')).toBeNull();
    expect(pushRoute([{ boardId: 'b1' }])).toBeNull();
  });

  it('drops a tile that is not a usable id rather than routing to nothing', () => {
    expect(pushRoute({ boardId: 'b1', tileId: '' })).toEqual({ boardId: 'b1' });
    expect(pushRoute({ boardId: 'b1', tileId: 7 })).toEqual({ boardId: 'b1' });
  });
});
