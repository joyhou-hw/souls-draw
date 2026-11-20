export class YamlMiniError extends Error {
  readonly line: number;
  constructor(
    message: string,
    line: number,
  ) {
    super(`第 ${line} 行：${message}`);
    this.line = line;
    this.name = 'YamlMiniError';
  }
}

interface Line {
  indent: number;
  text: string;
  lineNo: number;
  dash: boolean;
}

function preprocess(src: string): Line[] {
  const out: Line[] = [];
  const rawLines = src.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const indent = raw.length - raw.trimStart().length;
    let text = raw.trim();
    const hash = text.indexOf('#');
    if (hash === 0) continue;
    if (hash > 0 && /\s/.test(text[hash - 1] ?? '')) {
      text = text.slice(0, hash).trim();
    }
    if (text === '') continue;
    const dash = text.startsWith('- ') || text === '-';
    if (dash) {
      text = text === '-' ? '' : text.slice(2).trim();
    }
    out.push({ indent, text, lineNo: i + 1, dash });
  }
  return out;
}

function parseScalar(raw: string): number | boolean | string | null {
  const t = raw.trim();
  if (t === 'null' || t === '~' || t === '') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

function unquote(t: string): string {
  const v = parseScalar(t);
  return typeof v === 'string' ? v : t;
}

function parseFlowText(text: string, lineNo: number): unknown {
  const s = text;
  let pos = 0;
  const skip = () => {
    while (pos < s.length && /\s/.test(s[pos]!)) pos++;
  };
  const readRaw = (stops: string): string => {
    const start = pos;
    while (pos < s.length && !stops.includes(s[pos]!)) pos++;
    return s.slice(start, pos).trim();
  };
  const readValue = (): unknown => {
    skip();
    const c = s[pos];
    if (c === '{') {
      pos++;
      const obj: Record<string, unknown> = {};
      skip();
      if (s[pos] === '}') {
        pos++;
        return obj;
      }
      for (;;) {
        skip();
        const key = unquote(readRaw(':,}'));
        skip();
        if (s[pos] !== ':') throw new YamlMiniError(`flow map 中期望 ':'`, lineNo);
        pos++;
        obj[key] = readValue();
        skip();
        if (s[pos] === ',') {
          pos++;
          continue;
        }
        if (s[pos] === '}') {
          pos++;
          return obj;
        }
        throw new YamlMiniError(`flow map 中期望 ',' 或 '}'`, lineNo);
      }
    }
    if (c === '[') {
      pos++;
      const arr: unknown[] = [];
      skip();
      if (s[pos] === ']') {
        pos++;
        return arr;
      }
      for (;;) {
        skip();
        arr.push(readValue());
        skip();
        if (s[pos] === ',') {
          pos++;
          continue;
        }
        if (s[pos] === ']') {
          pos++;
          return arr;
        }
        throw new YamlMiniError(`flow list 中期望 ',' 或 ']'`, lineNo);
      }
    }
    return parseScalar(readRaw(',}]'));
  };
  const v = readValue();
  skip();
  if (pos < s.length) throw new YamlMiniError(`flow 值后有多余内容："${s.slice(pos)}"`, lineNo);
  return v;
}

function parseValueText(text: string, lineNo: number): unknown {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return parseFlowText(t, lineNo);
  return parseScalar(t);
}

const KEY_RE = /^([^:]+?)\s*:(?:\s+(.*))?$/;

function matchKey(text: string): { key: string; rest: string } | null {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return null;
  const m = KEY_RE.exec(text);
  if (!m) return null;
  return { key: unquote(m[1]!.trim()), rest: (m[2] ?? '').trim() };
}

interface BlockResult {
  value: unknown;
  next: number;
}

function parseMapLines(
  lines: Line[],
  i: number,
  vindent: number,
  firstText?: string,
  firstNo?: number,
): { entries: Record<string, unknown>; next: number } {
  const entries: Record<string, unknown> = {};
  let pendingFirst = firstText !== undefined ? { text: firstText, no: firstNo ?? 0 } : null;
  for (;;) {
    let text: string;
    let no: number;
    if (pendingFirst) {
      text = pendingFirst.text;
      no = pendingFirst.no;
      pendingFirst = null;
    } else {
      if (i >= lines.length) break;
      const l = lines[i]!;
      if (l.indent !== vindent || l.dash) break;
      text = l.text;
      no = l.lineNo;
      i++;
    }
    const kv = matchKey(text);
    if (!kv) throw new YamlMiniError(`无法解析的行（期望 "key: value"）：${text}`, no);
    if (kv.rest === '') {
      if (i < lines.length && lines[i]!.indent > vindent) {
        const r = parseBlock(lines, i, lines[i]!.indent);
        entries[kv.key] = r.value;
        i = r.next;
      } else {
        entries[kv.key] = null;
      }
    } else {
      entries[kv.key] = parseValueText(kv.rest, no);
    }
  }
  return { entries, next: i };
}

function parseListLines(lines: Line[], i: number, lindent: number): BlockResult {
  const items: unknown[] = [];
  while (i < lines.length && lines[i]!.dash && lines[i]!.indent === lindent) {
    const l = lines[i]!;
    const no = l.lineNo;
    const text = l.text;
    i++;
    if (text === '') {
      if (i < lines.length && lines[i]!.indent > lindent) {
        const r = parseBlock(lines, i, lines[i]!.indent);
        items.push(r.value);
        i = r.next;
      } else {
        items.push(null);
      }
    } else if (matchKey(text)) {
      const r = parseMapLines(lines, i, lindent + 2, text, no);
      items.push(r.entries);
      i = r.next;
    } else {
      items.push(parseValueText(text, no));
    }
  }
  return { value: items, next: i };
}

function parseBlock(lines: Line[], i: number, indent: number): BlockResult {
  const l = lines[i]!;
  if (l.dash) return parseListLines(lines, i, indent);
  const r = parseMapLines(lines, i, indent);
  return { value: r.entries, next: r.next };
}

export function parseMiniYaml(src: string): unknown {
  const lines = preprocess(src);
  if (lines.length === 0) return null;
  if (lines[0]!.dash) return parseListLines(lines, 0, lines[0]!.indent).value;
  const r = parseMapLines(lines, 0, lines[0]!.indent);
  if (r.next < lines.length) {
    const l = lines[r.next]!;
    throw new YamlMiniError(`多余的顶层内容：${l.text}`, l.lineNo);
  }
  return r.entries;
}
