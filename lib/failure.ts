/**
 * Reading what actually went wrong, from whatever shape it arrived in.
 *
 * This exists because `e instanceof Error` is false for the errors this app sees most.
 * PostgREST builds its rejection with `error = JSON.parse(body)` — a **plain object**
 * with `message`, `details`, `hint` and `code`, no prototype in sight — so every
 * `e instanceof Error ? e.message : ''` in the codebase read `''`, matched nothing, and
 * fell through to the generic "have another go in a moment."
 *
 * That is the worst possible failure for this particular app, because the specific
 * messages are the ones carrying a *reason a retry cannot fix*: a Board that has sealed,
 * a Proposal somebody has already voted for, a Member's third Goal proposal. Telling
 * somebody to try again when trying again is guaranteed to fail is the opposite of §0.3.
 *
 * `code` matters as much as `message`. The database raises `PT403` / `PT409` / `42501` in
 * `errcode`, which PostgREST returns as `code` — it is never inside the message text, so
 * matching `/PT409/` against the message was always a no-op.
 */

export interface Failure {
  /** The human sentence the database or gateway sent, or `''` if there wasn't one. */
  message: string;
  /** The SQLSTATE — `PT403`, `PT409`, `42501`, `23505` — or `''`. */
  code: string;
}

/**
 * Normalise any thrown value into something worth matching on.
 *
 * Deliberately total: it never throws and never returns null, because it is called from
 * `onError` handlers whose whole job is to say something useful, and a helper that can
 * fail there just moves the problem.
 */
export const failure = (thrown: unknown): Failure => {
  if (typeof thrown === 'object' && thrown !== null) {
    // Reaches own properties on a plain PostgREST object and inherited ones on a real
    // Error, which is exactly the point — both shapes arrive here.
    const shape = thrown as { message?: unknown; code?: unknown };
    return {
      message: typeof shape.message === 'string' ? shape.message : '',
      code: typeof shape.code === 'string' ? shape.code : '',
    };
  }
  return { message: typeof thrown === 'string' ? thrown : '', code: '' };
};

/** True when either the SQLSTATE or the message says so. Order matters: code is exact. */
export const failedWith = (thrown: unknown, code: string, pattern?: RegExp): boolean => {
  const { message, code: actual } = failure(thrown);
  if (actual === code) return true;
  return pattern !== undefined && pattern.test(message);
};
