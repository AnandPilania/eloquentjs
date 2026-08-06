/**
 * @eloquentjs/core — Pipeline
 *
 * Pass a payload through a sequence of transforms.
 *
 *   const result = await Pipeline.send(data)
 *     .through(ValidateStep, SanitizeStep, async d => ({ ...d, processed: true }))
 *     .thenReturn()
 *
 * A pipe is a function `d => next`, or a class/object with `handle(d)`.
 *
 * Note on naming: `then()` here is the promise protocol, so the pipeline can be
 * awaited directly. Laravel's `->then(destination)` — run the pipes, then hand
 * the result to a final callback — is `thenTo()` below, because the two cannot
 * share a name on a thenable.
 */
export class Pipeline {
  static send(payload) { return new Pipeline(payload) }

  constructor(payload) {
    this._payload = payload
    this._pipes   = []
  }

  through(...pipes) {
    this._pipes = pipes.flat()
    return this
  }

  pipe(...pipes) {
    this._pipes.push(...pipes.flat())
    return this
  }

  async thenReturn() {
    let value = this._payload
    for (const pipe of this._pipes) {
      if (typeof pipe === 'function') {
        // Distinguish plain function vs class constructor by checking .prototype.handle
        if (pipe.prototype && typeof pipe.prototype.handle === 'function') {
          // It's a class pipe — instantiate and call .handle()
          value = await new pipe().handle(value)
        } else {
          // It's a plain arrow/async function — call directly
          value = await pipe(value)
        }
      } else if (pipe && typeof pipe.handle === 'function') {
        // It's an already-instantiated class pipe
        value = await pipe.handle(value)
      }
    }
    return value
  }

  /**
   * Run the pipes, then pass the result to a final destination.
   * Laravel spells this `->then(fn)`; see the note at the top of the file.
   * @param {(value: any) => any} destination
   */
  async thenTo(destination) {
    return destination(await this.thenReturn())
  }

  // The promise protocol, so `await Pipeline.send(x).through(...)` works.
  then(resolve, reject) {
    return this.thenReturn().then(resolve, reject)
  }
}
