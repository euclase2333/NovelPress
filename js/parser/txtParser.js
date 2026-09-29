// txt 解析 + 章节识别 → [{title, content}]
// TODO: 硬换行（每行固定宽度折行）的 txt 需要先做段落合并，目前按“一行一段”处理

const HEADING_RES = [
  /^第\s*[零〇一二三四五六七八九十百千万两\d]+\s*[章节回卷集部篇].{0,30}$/,          // 第X章
  /^chapter\s+(?:\d+|[ivxlcdm]+|[a-z-]+)(?:[\s:.\-—].{0,50})?$/i,                     // Chapter X
  /^\d{1,4}\s*[.、．]\s*\S.{0,30}$/,                                                   // 1.标题 / 1、标题
  /^\d{1,4}$/,                                                                         // 纯数字编号
  /^(?:序章|序言|序|楔子|引子|前言|后记|尾声|终章|番外.{0,20})$/,
];

export function isHeading(line) {
  const t = line.trim();
  if (!t || t.length > 50 || /[。！？”"]$/.test(t)) return false;
  return HEADING_RES.some((re) => re.test(t));
}

const clean = (lines) => lines.map((l) => l.trim()).filter(Boolean).join('\n');

export function parseTxt(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const pre = [];
  let cur = null;
  for (const line of lines) {
    if (isHeading(line)) {
      cur = { title: line.trim(), lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
    else pre.push(line);
  }

  if (out.length) {
    const result = out.map((c) => ({ title: c.title, content: clean(c.lines) }));
    const preface = clean(pre);
    if (preface) result.unshift({ title: '前言', content: preface });
    return result;
  }

  // 没有识别到标题：按连续空行（2 个及以上）分段
  const sections = text.replace(/\r\n?/g, '\n').split(/\n\s*\n\s*\n+/).map((s) => clean(s.split('\n'))).filter(Boolean);
  if (sections.length > 1) return sections.map((c, i) => ({ title: `第 ${i + 1} 节`, content: c }));
  return [{ title: '正文', content: clean(lines) }];
}
