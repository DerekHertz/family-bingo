import { describe, expect, it } from 'vitest';
import { RING_SIZE, RING_THICKNESS, ringBox, sweepOf } from './ring';

describe('sweepOf', () => {
  it('draws nothing at zero', () => {
    expect(sweepOf(0)).toEqual({ rightRotation: 0, leftRotation: 0, pastHalf: false });
  });

  it('closes the ring at full', () => {
    expect(sweepOf(1)).toEqual({ rightRotation: 180, leftRotation: 180, pastHalf: true });
  });

  it('puts a quarter turn on the right wedge alone', () => {
    expect(sweepOf(0.25)).toEqual({ rightRotation: 90, leftRotation: 0, pastHalf: false });
  });

  it('fills the right wedge exactly at halfway, with the left still hidden', () => {
    // Exactly 0.5 must not show the left wedge: unrotated it covers its whole half, and
    // a ring at half would read as fully closed.
    expect(sweepOf(0.5)).toEqual({ rightRotation: 180, leftRotation: 0, pastHalf: false });
  });

  it('hands over to the left wedge past halfway', () => {
    expect(sweepOf(0.75)).toEqual({ rightRotation: 180, leftRotation: 90, pastHalf: true });
  });

  it('clamps overshoot to a closed ring rather than wrapping past the top', () => {
    // A sweep that wrapped would read as *less* done than it is.
    expect(sweepOf(1.5)).toEqual(sweepOf(1));
    expect(sweepOf(160 / 150)).toEqual(sweepOf(1));
  });

  it('clamps a negative progress to nothing', () => {
    expect(sweepOf(-1)).toEqual(sweepOf(0));
  });

  it('never leaves either wedge outside 0..180', () => {
    for (let i = -20; i <= 140; i += 1) {
      const { rightRotation, leftRotation } = sweepOf(i / 100);
      expect(rightRotation).toBeGreaterThanOrEqual(0);
      expect(rightRotation).toBeLessThanOrEqual(180);
      expect(leftRotation).toBeGreaterThanOrEqual(0);
      expect(leftRotation).toBeLessThanOrEqual(180);
    }
  });

  it('is monotonic — more progress never sweeps less', () => {
    let previous = -1;
    for (let i = 0; i <= 100; i += 1) {
      const { rightRotation, leftRotation } = sweepOf(i / 100);
      const total = rightRotation + leftRotation;
      expect(total).toBeGreaterThanOrEqual(previous);
      previous = total;
    }
  });

  it('sweeps a full turn in total across the whole range', () => {
    const { rightRotation, leftRotation } = sweepOf(1);
    expect(rightRotation + leftRotation).toBe(360);
  });
});

describe('ringBox', () => {
  it('defaults to §3’s 92pt ring', () => {
    const box = ringBox();
    expect(box.size).toBe(RING_SIZE);
    expect(box.size).toBe(92);
    expect(box.radius).toBe(46);
  });

  it('punches a hole two thicknesses smaller than the ring', () => {
    const box = ringBox(92, 8);
    expect(box.holeSize).toBe(92 - 16);
    expect(box.holeRadius).toBe(38);
    expect(RING_THICKNESS).toBe(8);
  });

  it('makes each wedge exactly half the ring wide', () => {
    expect(ringBox(92).wedgeWidth).toBe(46);
    expect(ringBox(60).wedgeWidth).toBe(30);
  });

  it('scales to any size, so the sheet is not the only place it can be used', () => {
    const box = ringBox(40, 4);
    expect(box).toEqual({
      size: 40,
      radius: 20,
      wedgeWidth: 20,
      holeSize: 32,
      holeRadius: 16,
    });
  });
});
