// Light mode. The pages are drawn with fixed dark colours, so light mode is a colour map applied to a page's text as it is served
// (the files on disk never change). Dark stays the default. The choice is the cookie lifeos_theme=light|dark, set by the page's theme control.
// Surfaces become warm off-whites (cards white), text becomes near-black inks, glass lines and shadows are softened, pastel accents are deepened.
import fs from 'node:fs';

// dark grey value -> light hex
const A = { 0: 'FFFFFF', 18: 'F3F2EE', 21: 'F5F4F0', 26: 'FFFFFF', 30: 'FBFAF8', 31: 'FAF9F6', 32: 'FAF9F6', 34: 'EFEDE8', 35: 'EEECE7', 36: 'ECEAE5', 38: 'EBE9E4', 41: 'E7E5DF', 42: 'E7E5DF', 44: 'E5E3DD', 46: 'E3E1DB', 51: 'DDDAD3', 52: 'DCD9D2', 58: 'D5D2CB', 60: 'D2CFC8', 69: 'C6C3BC', 72: 'C2BFB8', 74: 'BFBCB5', 79: 'B8B5AE', 85: 'AEABA4', 90: 'A7A49D', 94: 'A19E97', 102: '9A978F', 106: '96938B', 107: '96938B', 112: '8F8C85', 122: '7C7973', 124: '7A7771', 136: '6B6862', 138: '6B6862', 140: '69665F', 143: '67645D', 154: '5E5B55', 156: '5C5953', 160: '58554F', 168: '504D48', 176: '4A4742', 181: '46433E', 184: '44413C', 189: '403D38', 196: '3A3733', 200: '36332F', 208: '2F2D29', 213: '2B2926', 216: '292724', 224: '242220', 228: '21201D', 230: '201F1C', 232: '1F1E1B', 237: '1C1B19', 240: '1A1917', 245: '161513', 255: '111111' };
const KEYS = Object.keys(A).map(Number).sort((a, b) => a - b);
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const hx = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');

function neutral(v) {
  if (A[v] !== undefined) return A[v];
  let lo = KEYS[0], hi = KEYS[KEYS.length - 1];
  for (const k of KEYS) { if (k < v) lo = k; }
  for (const k of [...KEYS].reverse()) { if (k > v) hi = k; }
  const t = (v - lo) / (hi - lo), a = rgb(A[lo]), b = rgb(A[hi]);
  return hx(a[0] + (b[0] - a[0]) * t) + hx(a[1] + (b[1] - a[1]) * t) + hx(a[2] + (b[2] - a[2]) * t);
}
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function unhsl(h, s, l) {
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map((x) => x * 255);
}
function accent(x) {
  const [r, g, b] = rgb(x);
  let [h, s, l] = hsl(r, g, b);
  l = l < 0.3 ? 0.88 : Math.min(l, 0.4); // a dark tinted surface becomes a light tint; a pastel becomes a deeper tone
  const o = unhsl(h, s, l);
  return hx(o[0]) + hx(o[1]) + hx(o[2]);
}

const HEX = /(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
function hexSub(m, x) {
  let alpha = '';
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  if (x.length === 8) { alpha = x.slice(6); x = x.slice(0, 6); }
  const [r, g, b] = rgb(x);
  return '#' + (r === g && g === b ? neutral(r) : accent(x)) + alpha;
}
const RGBA = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(?:([0-9.]+)(?=\s*\))|(?=['"]))/g;
const fmt = (x) => String(Math.round(x * 1000) / 1000);
function rgbaSub(m0, R, G, B, a) {
  const r = +R, g = +G, b = +B;
  const out = (c, mult = 1, cap = 0) => 'rgba(' + c + ',' + (a !== undefined ? fmt(cap ? Math.min(cap, parseFloat(a) * mult) : parseFloat(a) * mult) : '');
  if (r === 255 && g === 255 && b === 255) return out('20,19,17', 0.6);
  if (r === 0 && g === 0 && b === 0) return out('58,48,36', 0.4);
  if (r === 46 && g === 46 && b === 46) return out('229,227,221', 1.25, 1);
  if (r === 18 && g === 18 && b === 18) return out('243,242,238');
  if (r === g && g === b && (r === 20 || r === 26)) return out('255,255,255');
  if (r === g && g === b && r >= 245) return out('22,21,19');
  if (r === g && g === b && r >= 230) return out('28,27,25');
  if (r === g && g === b) return out(rgb(neutral(r)).join(','));
  return m0;
}

export function lightify(text) {
  return String(text)
    .replace(HEX, hexSub)
    .replace(RGBA, rgbaSub)
    .replace(/color-scheme:\s*dark/g, 'color-scheme: light');
}

// files that carry colours: the pages, and the scripts that draw their own bits (edit sheet, note editor, sync panel)
export const THEMED = /\.(html)$|^(support|vsync|noteed)\.js$/;
const cache = new Map(); // path -> {mtime, text}
export function themedFile(abs) {
  const st = fs.statSync(abs);
  const c = cache.get(abs);
  if (c && c.mtime === st.mtimeMs) return c.text;
  const text = lightify(fs.readFileSync(abs, 'utf8'));
  cache.set(abs, { mtime: st.mtimeMs, text });
  return text;
}
export function themeOf(req) {
  const m = /(?:^|;\s*)lifeos_theme=(light|dark)\b/.exec(req.headers.cookie || '');
  return m ? m[1] : 'dark';
}
