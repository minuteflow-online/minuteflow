/**
 * Minimal fake of the subset of the supabase-js query builder that
 * taskManager.js actually uses (select/eq/is/neq, insert/select/single,
 * update/eq, upsert), backed by an in-memory table store. Just enough to
 * unit-test taskManager.js's concurrency behavior without a real DB.
 *
 * The real supabase-js query builder is thenable (awaiting it runs the
 * request) — this mock mirrors that with its own `then()`.
 */

function makeState() {
  let idCounter = 1;
  return {
    time_logs: [],
    sessions: [],
    _nextId: () => idCounter++,
    // Hook tests can override to artificially widen a race window around inserts.
    _insertDelay: () => Promise.resolve(),
  };
}

class QueryBuilder {
  constructor(table, state) {
    this.table = table;
    this.state = state;
    this._filters = [];
    this._mode = "select";
  }

  select() {
    return this;
  }

  eq(col, val) {
    this._filters.push((row) => row[col] === val);
    return this;
  }

  is(col, val) {
    this._filters.push((row) => (row[col] ?? null) === val);
    return this;
  }

  neq(col, val) {
    this._filters.push((row) => row[col] !== val);
    return this;
  }

  insert(obj) {
    this._mode = "insert";
    this._payload = obj;
    return this;
  }

  update(obj) {
    this._mode = "update";
    this._payload = obj;
    return this;
  }

  upsert(obj, opts) {
    this._mode = "upsert";
    this._payload = obj;
    this._upsertOpts = opts || {};
    return this;
  }

  single() {
    this._single = true;
    return this;
  }

  maybeSingle() {
    this._single = true;
    this._maybe = true;
    return this;
  }

  then(resolve, reject) {
    this._exec().then(resolve, reject);
  }

  async _exec() {
    const rows = this.state[this.table] || (this.state[this.table] = []);

    if (this._mode === "insert") {
      await this.state._insertDelay();
      const row = { id: this.state._nextId(), end_time: null, ...this._payload };
      rows.push(row);
      return this._single ? { data: row, error: null } : { data: [row], error: null };
    }

    if (this._mode === "update") {
      const matches = rows.filter((row) => this._filters.every((f) => f(row)));
      matches.forEach((row) => Object.assign(row, this._payload));
      return { data: matches, error: null };
    }

    if (this._mode === "upsert") {
      // onConflict may be a composite key ("user_id,session_date") — match on
      // every listed column, not just the first, so composite-key upserts
      // (e.g. mood_logs) don't collide with unrelated rows.
      const conflictCols = (this._upsertOpts.onConflict || "id").split(",");
      const existing = rows.find((row) => conflictCols.every((col) => row[col] === this._payload[col]));
      if (existing) Object.assign(existing, this._payload);
      else rows.push({ id: this.state._nextId(), ...this._payload });
      return { data: null, error: null };
    }

    // select
    const matches = rows.filter((row) => this._filters.every((f) => f(row)));
    if (this._single) {
      if (this._maybe) return { data: matches[0] ?? null, error: null };
      return matches[0]
        ? { data: matches[0], error: null }
        : { data: null, error: { message: "no rows found" } };
    }
    return { data: matches, error: null };
  }
}

function makeMockSupabase(state) {
  return {
    from(table) {
      return new QueryBuilder(table, state);
    },
  };
}

module.exports = { makeState, makeMockSupabase };
