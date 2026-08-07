import { describe, expect, it } from 'vitest';
import { boardVisit, boardVisitCopy, stripFaces } from './roster';

const active = { id: 'm1', status: 'active' };
const pending = { id: 'm2', status: 'pending' };

const board = (over: Partial<{ sealedAt: string | null; readyAt: string | null }> = {}) => ({
  memberId: 'm1',
  boardId: 'b1',
  sealedAt: null,
  readyAt: null,
  ...over,
});

describe('boardVisit (§23.1)', () => {
  it('opens a sealed Board', () => {
    const visit = boardVisit(active, board({ sealedAt: '2027-01-01T05:00:00Z' }));
    expect(visit).toEqual({ kind: 'open', boardId: 'b1' });
  });

  /**
   * §23.2. The draft is not readable by the Family — not because RLS would refuse it, but
   * because §4.1 says the board is not drawn until it seals and §7.5 says nobody may judge
   * a Goal into shape. Both readiness states have to stay closed or the line is not a line.
   */
  it('does not open a Board that is still being written', () => {
    expect(boardVisit(active, board()).kind).toBe('writing');
  });

  it('does not open a Board its owner has called done either', () => {
    expect(boardVisit(active, board({ readyAt: '2026-12-20T10:00:00Z' })).kind).toBe('done');
  });

  it('carries no boardId on any closed state, so nothing can navigate by accident', () => {
    for (const visit of [
      boardVisit(active, board()),
      boardVisit(active, board({ readyAt: '2026-12-20T10:00:00Z' })),
      boardVisit(active, undefined),
      boardVisit(pending, undefined),
    ]) {
      expect(visit).not.toHaveProperty('boardId');
    }
  });

  it('says so when a Member has no Board in this Year at all', () => {
    // A Member approved after the Year opened. Real: one Account in this Family is in
    // exactly this state for 2026.
    expect(boardVisit(active, undefined).kind).toBe('unopened');
  });

  it('treats a pending Member as pending even if a Board somehow exists', () => {
    // Belt and braces: a pending Member reads nothing (§3.2), and their row is about
    // waiting to be let in rather than about a Year.
    expect(boardVisit(pending, board({ sealedAt: '2027-01-01T05:00:00Z' })).kind).toBe('pending');
  });
});

describe('boardVisitCopy (§4.5 — factual, never conditional)', () => {
  it('says nothing on the normal case', () => {
    // The row is a tap target and says so by being one. A "board sealed" label underneath
    // is a word on every row that stops being read.
    expect(boardVisitCopy({ kind: 'open', boardId: 'b1' }, 2027)).toBeNull();
  });

  it('reuses §22 readiness rather than revealing more', () => {
    expect(boardVisitCopy({ kind: 'writing' }, 2027)).toBe('still writing');
    expect(boardVisitCopy({ kind: 'done' }, 2027)).toBe('board done');
  });

  /**
   * Naming the Year is the whole difference between a fact about the calendar and a
   * verdict on the person — the argument §21.4's "joined July" marker already makes.
   */
  it('names the Year rather than implying the Member failed at something', () => {
    expect(boardVisitCopy({ kind: 'unopened' }, 2026)).toBe('no board for 2026');
  });

  it('never scolds (§0.3)', () => {
    const visits = [
      { kind: 'writing' as const },
      { kind: 'done' as const },
      { kind: 'unopened' as const },
      { kind: 'pending' as const },
    ];
    for (const visit of visits) {
      const copy = boardVisitCopy(visit, 2027) ?? '';
      expect(copy).not.toMatch(/behind|late|still hasn|yet to|missing|failed|only|!/i);
    }
  });

  it('reports no progress in any state', () => {
    // §23.4 and §7's do-not #2. If a number ever appears here, this file is where it is
    // caught — the copy is the surface a ranking would arrive through.
    for (const visit of [
      { kind: 'open' as const, boardId: 'b1' },
      { kind: 'writing' as const },
      { kind: 'done' as const },
      { kind: 'unopened' as const },
      { kind: 'pending' as const },
    ]) {
      const copy = boardVisitCopy(visit, 2027) ?? '';
      expect(copy).not.toMatch(/\d+\s*(of|\/)\s*\d+|\d+%/);
    }
  });
});

describe('stripFaces (FRONTEND_DESIGN §4.5)', () => {
  const member = (id: string, displayName: string, over: Partial<{ status: string; isManaged: boolean }> = {}) => ({
    id,
    displayName,
    status: 'active',
    isManaged: false,
    ...over,
  });
  const boardFor = (memberId: string, boardId: string, sealedAt: string | null) => ({
    memberId,
    boardId,
    sealedAt,
    readyAt: null,
  });

  const sealed = '2027-01-01T05:00:00Z';
  // Alice and Bob have sealed Boards; Nia's has not sealed; Wren has no Board at all.
  const members = [
    member('m1', 'Alice'),
    member('m2', 'Bob'),
    member('m3', 'Nia'),
    member('m4', 'Wren'),
    member('m5', 'Zed', { status: 'pending' }),
  ];
  const boards = [
    boardFor('m1', 'b1', sealed),
    boardFor('m2', 'b2', sealed),
    boardFor('m3', 'b3', null),
  ];

  it('keeps the order it is given — join order, never progress (§7 do-not #2)', () => {
    expect(stripFaces(members, boards, 'b1').map((f) => f.displayName)).toEqual([
      'Alice',
      'Bob',
      'Nia',
      'Wren',
    ]);
  });

  it('marks the Board being looked at without moving it', () => {
    expect(stripFaces(members, boards, 'b2').map((f) => f.isCurrent)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  /**
   * The one that matters, and the one the first version of this got wrong. A strip built
   * from the Boards cannot render a Member who has none — they are not absent from the
   * data, they are absent from the *query* — so the Family quietly comes up one person
   * short. Found in the simulator: Wren was simply not there.
   */
  it('includes a Member with no Board in this Year at all', () => {
    const faces = stripFaces(members, boards, 'b1');
    expect(faces.map((f) => f.displayName)).toContain('Wren');
    expect(faces.find((f) => f.displayName === 'Wren')?.boardId).toBeNull();
  });

  it('includes a Member whose Board has not sealed, rather than eliding them', () => {
    expect(stripFaces(members, boards, 'b1').find((f) => f.displayName === 'Nia')).toMatchObject({
      boardId: null,
    });
  });

  it('gives exactly the two sealed Boards a destination', () => {
    const openable = stripFaces(members, boards, 'b1').filter((f) => f.boardId !== null);
    expect(openable.map((f) => f.boardId)).toEqual(['b1', 'b2']);
  });

  it('leaves a pending Member off the header — their row is the roster’s job (§23.6)', () => {
    expect(stripFaces(members, boards, 'b1').map((f) => f.displayName)).not.toContain('Zed');
  });

  it('marks nothing when the caller is not on a Board', () => {
    expect(stripFaces(members, boards, undefined).some((f) => f.isCurrent)).toBe(false);
  });

  it('carries no progress of any kind', () => {
    // §23.4. The shape of a face is the surface a ranking would arrive through, so it is
    // asserted rather than assumed.
    for (const face of stripFaces(members, boards, 'b1')) {
      expect(Object.keys(face).sort()).toEqual([
        'boardId',
        'displayName',
        'isCurrent',
        'isManaged',
        'memberId',
      ]);
    }
  });
});
