// 1.3 · Canonical serialisation. Implemented once; every verifier calls this.
//
//   null     → "null"          true/false → "true"/"false"
//   number   → shortest round-tripping decimal (ECMAScript Number::toString)
//   string   → JSON string, minimal escaping, UTF-8
//   array    → "[" items joined by "," "]"
//   object   → "{" pairs sorted by key (UTF-16 code-unit order), "key":value "}"
//              keys whose value is undefined are omitted
//
// Anything else (NaN, Infinity, undefined inside an array, functions, BigInt)
// is refused rather than guessed at.

export function canonical(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonical: non-finite number ${value}`);
      return Object.is(value, -0) ? '0' : String(value);
    case 'string': return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return '[' + value.map((v, i) => {
          if (v === undefined) throw new TypeError(`canonical: undefined at array index ${i}`);
          return canonical(v);
        }).join(',') + ']';
      }
      const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
      return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
    }
    default:
      throw new TypeError(`canonical: cannot serialise ${typeof value}`);
  }
}

export function omit(obj, ...keys) {
  const out = {};
  for (const k of Object.keys(obj)) if (!keys.includes(k)) out[k] = obj[k];
  return out;
}
