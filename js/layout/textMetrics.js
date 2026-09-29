// file: js/layout/textMetrics.js
// 文本度量与换行：按字符宽度估算
//   全角 = 1em；半角 = 0.5em
// 判断顺序：先看是否属于"必定全角"的字符（CJK 标点、中文引号、全角 ASCII、中点 等），
//          再看是否属于"必定半角"的字符（ASCII 可打印区、Latin 补充、半角片假名），
//          都没命中时，按全角兜底（中文字体环境下未识别字符大概率是全角）。
// 两端对齐：wrapText(opts.justify) 只对"纯全角、不含破折号/省略号"的非末行计算 gap（mm/字间隙），
//          预览用 letter-spacing，PDF 逐字绘制，两端共用同一个 gap。
// TODO: 标点挤压（连续标点/行末标点压缩半个字宽）、悬挂标点、英文单词不拆分
export const PT_MM = 25.4 / 72;   // 1pt = 0.3528mm

// 避头：不能出现在行首的标点；避尾：不能出现在行尾的标点
const NO_START = new Set('，。、；：？！）］｝〕〉》」』】〗％‰·…—”’,.;:?!)]}%'.split(''));
const NO_END = new Set('（［｛〔〈《「『【〖“‘([{'.split(''));

/**
 * 必定全角的字符（中文字体里占 1em 方块）
 * 覆盖范围：
 *   U+00B7         中点 ·（中文语境下按全角）
 *   U+2010–U+2027  常用标点：– — ‘ ’ “ ” † ‡ … ‰ 等
 *   U+2030–U+205E  更多标点：′ ″ ‹ › ※ ‼ ⁇ ⁈ 等
 *   U+3000–U+303F  CJK 标点：　、。〈〉《》「」『』【】〖〗 等
 *   U+3400–U+4DBF  CJK 扩展 A
 *   U+4E00–U+9FFF  CJK 基本区
 *   U+FF00–U+FF60  全角 ASCII（！＂＃＄％…）
 *   U+FFE0–U+FFE6  全角符号（￠￡￢￣￤￥￦）
 */
const isWideCode = (c) =>
  (c === 0x00B7) ||                        // 中点 ·（关键修复）
  (c >= 0x2010 && c <= 0x2027) ||
  (c >= 0x2030 && c <= 0x205E) ||
  (c >= 0x3000 && c <= 0x303F) ||
  (c >= 0x3400 && c <= 0x4DBF) ||
  (c >= 0x4E00 && c <= 0x9FFF) ||
  (c >= 0xFF00 && c <= 0xFF60) ||
  (c >= 0xFFE0 && c <= 0xFFE6);

/**
 * 必定半角的字符
 *   U+0020–U+007E  ASCII 可打印区
 *   U+00A0–U+024F  Latin 补充与扩展（含常见重音符）
 *   U+FF61–U+FF9F  半角片假名与半角标点
 */
const isHalfCode = (c) =>
  (c >= 0x20 && c <= 0x7E) ||
  (c >= 0xA0 && c <= 0x24F) ||
  (c >= 0xFF61 && c <= 0xFF9F);

/** 单字宽度（mm）：先判全角，再判半角，都没命中按全角兜底 */
export const charWidth = (ch, sizePt) => {
  const code = ch.codePointAt(0);
  if (isWideCode(code)) return sizePt * PT_MM;
  if (isHalfCode(code)) return 0.5 * sizePt * PT_MM;
  return sizePt * PT_MM;                                      // 兜底：未识别按全角
};

export const textWidth = (s, sizePt) => [...s].reduce((w, c) => w + charWidth(c, sizePt), 0);

/** 与 charWidth 判定顺序一致：先全角后半角，兜底按全角（中点 · 属于全角） */
const isHalfWidthCode = (c) => !isWideCode(c) && isHalfCode(c);

/** 整行是否"纯全角"（没有任何半角字符：ASCII 字母数字、空格、拉丁重音、半角标点） */
export const isPureWide = (s) => {
  for (const ch of s) if (isHalfWidthCode(ch.codePointAt(0))) return false;
  return true;
};

/** 含破折号 / 省略号的行 v1 不拉伸（拉开会断裂） */
const hasDashOrEllipsis = (s) => /[—―…⋯]/.test(s);

/** 调试统计对象：传给 wrapText 的 opts.stats，可累计多次调用 */
export const createJustifyStats = () => ({
  lines: 0,          // 参与统计的总行数
  justified: 0,      // 已拉伸
  flush: 0,          // 本来就满行，无需拉伸
  last: 0,           // 段落末行
  single: 0,         // 单字行
  halfWidth: 0,      // 含半角字符
  dash: 0,           // 含破折号/省略号
  overMax: 0,        // 超上限
  maxGapEm: 0,       // 已拉伸行中最大 gap（单位 em）
  overMaxWorstEm: 0, // 超限行中最大的"本应 gap"（em），用来定阈值
  maxErr: 0,         // 不变量最大误差（mm），应 < 1e-6
});

/**
 * 把一段文字按最大宽度折行 → [{text, indent, gap}]
 * firstIndent(mm)：首行缩进
 * opts.justify   ：是否两端对齐（默认 false，其他调用方不受影响）
 * opts.maxGapEm  ：每个字间隙最大拉伸量，单位 em（默认 0.5）
 * opts.stats     ：可选，createJustifyStats() 的返回值，用于调试统计
 * gap 单位 mm：每个字间隙额外增加的宽度；0 = 不拉伸（左对齐）
 */
export function wrapText(text, sizePt, maxW, firstIndent = 0, opts = {}) {
  const { justify = false, maxGapEm = 0.5, stats = null } = opts;
  const em = sizePt * PT_MM;
  const chars = [...text];
  const lines = [];
  let i = 0;
  let first = true;
  while (i < chars.length) {
    const ind = first ? firstIndent : 0;
    const avail = maxW - ind;
    let w = 0;
    let j = i;
    while (j < chars.length && w + charWidth(chars[j], sizePt) <= avail + 1e-6) w += charWidth(chars[j++], sizePt);
    if (j === i) j = i + 1;                                   // 保证前进
    if (j < chars.length) {
      // 标点禁则（最简版）：行首不出现禁首标点、行尾不出现禁尾标点，破折号/省略号不拆开
      while (j - 1 > i && (NO_START.has(chars[j]) || NO_END.has(chars[j - 1]) ||
        (chars[j] === chars[j - 1] && (chars[j] === '—' || chars[j] === '…')))) j--;
    }

    const segText = chars.slice(i, j).join('');
    const n = j - i;
    let gap = 0;

    if (justify) {
      const isLast = j >= chars.length;
      const lineW = textWidth(segText, sizePt);               // 回退后重新算，w 已过期
      const extra = avail - lineW;
      let why = null;
      let g = 0;
      if (isLast) why = 'last';
      else if (n < 2) why = 'single';
      else if (!isPureWide(segText)) why = 'halfWidth';
      else if (hasDashOrEllipsis(segText)) why = 'dash';
      else if (extra <= 1e-6) why = 'flush';
      else {
        g = extra / (n - 1);                                  // n 个字 n-1 个间隙，末字后不加
        if (g > maxGapEm * em) why = 'overMax';
        else gap = g;
      }
      if (stats) {
        stats.lines++;
        if (gap > 0) {
          stats.justified++;
          stats.maxGapEm = Math.max(stats.maxGapEm, gap / em);
          // 不变量：indent + lineW + (n-1)*gap ≈ maxW
          stats.maxErr = Math.max(stats.maxErr, Math.abs(ind + lineW + (n - 1) * gap - maxW));
        } else {
          stats[why]++;
          if (why === 'overMax') stats.overMaxWorstEm = Math.max(stats.overMaxWorstEm, g / em);
        }
      }
    }

    lines.push({ text: segText, indent: ind, gap });
    i = j;
    first = false;
  }
  return lines.length ? lines : [{ text: '', indent: firstIndent, gap: 0 }];
}
