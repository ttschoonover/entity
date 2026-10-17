// Minimal deterministic ustar writer and reader. Enough to make and inspect a
// distribution archive without depending on anything.
import zlib from 'node:zlib';

function header(name, size, mode = 0o644) {
  const h = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`path too long for ustar: ${prefix}/${name}`);
  }
  const put = (s, off, len) => h.write(s, off, len, 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  put(name, 0, 100);
  put(oct(mode, 8), 100, 8); put(oct(0, 8), 108, 8); put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12); put(oct(0, 12), 136, 12);
  h.fill(' ', 148, 156); put('0', 156, 1);
  put('ustar\0', 257, 6); put('00', 263, 2); put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return h;
}

export function tarGz(files) {
  const parts = [];
  for (const { name, data, mode } of files.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    parts.push(header(name, data.length, mode), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

export function listTarGz(buf) {
  const t = zlib.gunzipSync(buf);
  const names = [];
  for (let o = 0; o + 512 <= t.length;) {
    const h = t.subarray(o, o + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, l) => h.subarray(a, a + l).toString('utf8').replace(/\0.*$/s, '');
    const name = str(0, 100), prefix = str(345, 155);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    names.push(prefix ? `${prefix}/${name}` : name);
    o += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
