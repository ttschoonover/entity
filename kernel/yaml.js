// A deliberately small YAML subset: block maps and sequences, flow maps and
// sequences (which may span lines), folded (>) and literal (|) scalars, plain
// and quoted scalars, comments. Anchors, tags and multi-documents are refused
// by omission: what is not understood becomes a parse error, never a guess.

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

export function scalar(s) {
  s = s.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (s[0] === '"') return JSON.parse(s);
  if (s[0] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function parseFlow(src) {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  function value() {
    ws();
    if (src[i] === '{') {
      i++; const obj = {};
      ws(); if (src[i] === '}') { i++; return obj; }
      for (;;) {
        ws();
        let key = '';
        if (src[i] === '"' || src[i] === "'") key = String(quoted());
        else { while (i < src.length && src[i] !== ':') key += src[i++]; key = key.trim(); }
        ws(); if (src[i] !== ':') throw new Error(`flow map: expected ":" near "${src.slice(i, i + 20)}"`);
        i++;
        obj[key] = value();
        ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === '}') { i++; return obj; }
        throw new Error(`flow map: expected "," or "}" near "${src.slice(i, i + 20)}"`);
      }
    }
    if (src[i] === '[') {
      i++; const arr = [];
      ws(); if (src[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(value()); ws();
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ']') { i++; return arr; }
        throw new Error(`flow sequence: expected "," or "]" near "${src.slice(i, i + 20)}"`);
      }
    }
    if (src[i] === '"' || src[i] === "'") return quoted();
    let s = '';
    while (i < src.length && !',}]'.includes(src[i])) s += src[i++];
    return scalar(s);
  }
  function quoted() {
    const q = src[i]; let j = i + 1;
    while (j < src.length) { if (q === '"' && src[j] === '\\') { j += 2; continue; } if (src[j] === q) { if (q === "'" && src[j + 1] === "'") { j += 2; continue; } break; } j++; }
    const raw = src.slice(i, j + 1); i = j + 1; return scalar(raw);
  }
  const v = value(); ws();
  if (i < src.length) throw new Error(`unexpected trailing text "${src.slice(i)}"`);
  return v;
}

const balanced = (s) => {
  let d = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c; else if (c === '[' || c === '{') d++; else if (c === ']' || c === '}') d--;
  }
  return d <= 0;
};

export function parse(text) {
  const raw = String(text).replace(/\r/g, '').split('\n');
  const lines = raw.map((l, n) => ({ n: n + 1, raw: l, text: stripComment(l).replace(/\s+$/, ''), indent: l.match(/^ */)[0].length }));
  let i = 0;
  const skip = () => { while (i < lines.length && !lines[i].text.trim()) i++; };
  const err = (m) => { throw new Error(`yaml line ${lines[Math.min(i, lines.length - 1)]?.n}: ${m}`); };

  function blockScalar(style, parentIndent) {
    const body = [];
    let ind = null;
    while (i < lines.length) {
      const l = lines[i];
      if (l.raw.trim() === '') { body.push(''); i++; continue; }
      if (l.indent <= parentIndent) break;
      if (ind === null) ind = l.indent;
      body.push(l.raw.slice(ind)); i++;
    }
    while (body.length && body[body.length - 1] === '') body.pop();
    if (style === '|') return body.join('\n');
    return body.join('\n').split(/\n{2,}/).map(p => p.split('\n').map(s => s.trim()).join(' ')).join('\n');
  }

  function inlineValue(rest, indent) {
    rest = rest.trim();
    if (rest === '') {
      skip();
      if (i < lines.length && lines[i].indent > indent) return block(lines[i].indent);
      if (i < lines.length && lines[i].indent === indent && lines[i].text.trim().startsWith('- ')) return block(indent);
      return null;
    }
    if (/^[>|][-+]?$/.test(rest)) return blockScalar(rest[0], indent);
    if (rest[0] === '[' || rest[0] === '{') {
      let src = rest;
      while (!balanced(src) && i < lines.length) { src += ' ' + lines[i].text.trim(); i++; }
      return parseFlow(src);
    }
    if (rest[0] !== '"' && rest[0] !== "'") {
      // plain scalar continued on more-indented lines
      while (i < lines.length && lines[i].text.trim() && lines[i].indent > indent) { rest += ' ' + lines[i].text.trim(); i++; }
    }
    return scalar(rest);
  }

  function splitKey(t) {
    let key, rest;
    if (t[0] === '"' || t[0] === "'") {
      const end = t.indexOf(t[0], 1); key = t.slice(1, end); rest = t.slice(end + 1);
      if (!rest.startsWith(':')) return null; rest = rest.slice(1);
    } else {
      const m = t.match(/^([^\s:][^:]*?):(\s|$)(.*)$/);
      if (!m) return null; key = m[1]; rest = m[3];
    }
    return [key.trim(), rest];
  }

  function block(indent) {
    skip();
    const first = lines[i].text.trim();
    if (first === '-' || first.startsWith('- ')) {
      const arr = [];
      while (i < lines.length) {
        skip(); if (i >= lines.length) break;
        const l = lines[i]; const t = l.text.trim();
        if (l.indent !== indent || !(t === '-' || t.startsWith('- '))) break;
        i++;
        const rest = t.slice(1).trim();
        const kv = rest && !'[{"\''.includes(rest[0]) ? splitKey(rest) : null;
        if (kv) {
          const obj = {}; const inner = indent + 2;
          obj[kv[0]] = inlineValue(kv[1], inner);
          skip();
          if (i < lines.length && lines[i].indent === inner && !lines[i].text.trim().startsWith('- ')) Object.assign(obj, block(inner));
          arr.push(obj);
        } else arr.push(inlineValue(rest, indent));
      }
      return arr;
    }
    const obj = {};
    while (i < lines.length) {
      skip(); if (i >= lines.length) break;
      const l = lines[i];
      if (l.indent < indent) break;
      if (l.indent > indent) err('unexpected indentation');
      const kv = splitKey(l.text.trim());
      if (!kv) err(`expected "key: value", found "${l.text.trim()}"`);
      i++;
      obj[kv[0]] = inlineValue(kv[1], indent);
    }
    return obj;
  }

  skip();
  if (i >= lines.length) return {};
  return block(lines[i].indent);
}

const PLAIN = /^[A-Za-z_][A-Za-z0-9_ .\-\/]*$/;
export function emitScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map(emitScalar).join(', ') + ']';
  if (typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => `${k}: ${emitScalar(x)}`).join(', ') + ' }';
  const s = String(v);
  if (PLAIN.test(s) && !['null', 'true', 'false', '~'].includes(s) && !/\s$/.test(s)) return s;
  return JSON.stringify(s);
}
