// Remote-control seeking. Presses are previewed locally and committed once the user pauses,
// because AVPlay seeks are slow. The step grows the longer a key is held or tapped quickly.
// Escalation adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0.

export const COMMIT_MS = 900; // quiet time before a pending seek is applied
export const GAP_MS = 700;    // presses closer than this count as one streak

/** Step in ms for the n-th press (0-based) of a streak: 10 s x3, then 30 s, 60 s, 180 s from press 16. */
export function stepFor(n) {
  if (n < 3) return 10000;
  if (n < 8) return 30000;
  if (n < 16) return 60000;
  return 180000;
}

export class Seeker {
  constructor(o) {
    o = o || {};
    this.commitMs = o.commitMs || COMMIT_MS;
    this.gapMs = o.gapMs || GAP_MS;
    this.count = 0;
    this.lastAt = -Infinity;
    this.target = null; // pending target in ms, or null
  }

  /** A press toward dir (-1/+1). Returns the new pending target. */
  press(dir, now, position, duration) {
    this.count = now - this.lastAt < this.gapMs ? this.count + 1 : 0;
    this.lastAt = now;
    const from = this.target == null ? position : this.target;
    const max = duration > 3000 ? duration - 3000 : Math.max(0, duration);
    this.target = Math.max(0, Math.min(max, from + dir * stepFor(this.count)));
    return this.target;
  }

  pending() {
    return this.target != null;
  }

  /** Takes the pending target (clears it). */
  commit() {
    const t = this.target;
    this.target = null;
    this.count = 0;
    return t;
  }

  cancel() {
    this.target = null;
    this.count = 0;
  }
}
