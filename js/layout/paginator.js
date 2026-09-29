// file: js/layout/paginator.js
// 分页引擎：章节 + 页面设置 + 排版参数 → pages（全书物理页顺序）
//
// 页眉页脚合并规则：
//   开 / 开 → 页眉只放书名（左页）/ 章节名（右页）；页脚只放页码
//   开 / 关 → 页码并入页眉：
//              左页 "001 · 书名"（页码在外左）
//              右页 "章节名 · 002"（页码在外右）
//   关 / 开 → 页码并入页脚，格式同上
//   关 / 关 → 都不画
//   footerText 一律忽略（页脚关闭即失效）
//
// 关键：页眉页脚里的"文字段 / 分隔符段 / 页码段"拆成独立 line 分别绘制。
//       原因：pdf-lib + fontkit 在"英文 + 数字"混排时会把数字画成全角字形；
//       数字单独一段就可以避免这个替换，保持半角宽度。
//       每段用估算 x 定位（不再依赖 align/ax），各自独立 drawText。
//
// 右对齐侧额外内缩 RIGHT_EDGE_INSET_MM，避免估算误差导致右端越出正文右边界。
//
// 页码：补零到 PAGE_NO_DIGITS 位，保持半角数字。
//
// 两端对齐：正文行由 wrapText 算出 gap（mm/字间隙），带在 line.gap 上；
//   typo.justify（默认 true）开关，typo.justifyMaxGap（默认 0.5，单位 em）为拉伸上限。
//   章标题、前置页、页眉页脚不参与。?justify_debug=1 时在控制台输出统计。
import { PT_MM, textWidth, wrapText, createJustifyStats } from './textMetrics.js';
import { getFamily, hasWeight, HEADER_FOOTER_FONT, HEADING_FONT } from '../fonts.js';
import { buildFrontMatter } from './frontMatter.js';

export const CHAPTER_TITLE_SIZE = 16;    // pt，章标题
const CHAPTER_TITLE_LH = 1.4;            // 章标题行高倍数
const CHAPTER_TITLE_TOP = 0.4;           // 章标题上方留白 = 正文区高度 × 40%
const CHAPTER_TITLE_GAP_LINES = 2;       // 章标题下方空 2 行（正文行高）再接正文

export const HF_SIZE_RATIO = 0.6;        // 页眉页脚字号 = 正文字号 × 0.6
const HF_LH_RATIO = 1.5;                 // 页眉页脚行高倍数

export const PAGE_NO_DIGITS = 3;         // 页码补零到几位（1 → 001）
const SEP = '·';                         // 分隔符（中点）
const SEP_GAP_EM = 0.5;                  // 分隔符左右各留 0.5 字宽的空白

// 右对齐侧（右页页眉/页脚）相对正文右边界的额外内缩量（mm）。
// 因为 putTriple 用估算字宽排版，实际渲染有细微差异，容易右端越界。
// 留一点安全余量，视觉上更稳；调大→整块更靠左，调小→更靠右。
const RIGHT_EDGE_INSET_MM = 0.5;

/** 物理页序号 → 左右页。奇数 = 右页（与书名页同侧） */
export const sideOf = (physicalIndex) => (physicalIndex % 2 === 1 ? 'right' : 'left');
/** 是否右页：参数为物理页序号（不是页码） */
export const isRightPage = (physicalIndex) => sideOf(physicalIndex) === 'right';

/** 页码格式化：补零到 PAGE_NO_DIGITS 位，保持半角 */
export const formatPageNo = (n) => String(n).padStart(PAGE_NO_DIGITS, '0');

/** 字重兜底 */
const normWeight = (family, w) => (hasWeight(family, w) ? w : 'Regular');

/** 版面几何 */
export function computeGeometry(page, typo, hf) {
  const size = typo.fontSize;
  const lh = size * typo.lineHeight * PT_MM;
  const contentW = page.width - page.marginInside - page.marginOutside;
  const hfSize = size * HF_SIZE_RATIO;
  const hfH = hfSize * HF_LH_RATIO * PT_MM;
  const band = hfH + 3;
  const headerOn = hf.showHeader !== false && (!!hf.headerText || !!hf.oddEvenDifferent);
  const footerOn = hf.showFooter !== false && !!hf.showPageNumber;
  const hasHeader = headerOn;
  const hasFooter = footerOn;
  const bodyTop = page.marginTop + (hasHeader ? band : 0);
  const bodyH = page.height - page.marginBottom - (hasFooter ? band : 0) - bodyTop;
  return { size, lh, contentW, hfSize, hfH, bodyTop, bodyH, hasHeader, hasFooter, headerOn, footerOn };
}

export function paginate(chapters, page, typo, hf, { bookTitle = '' } = {}) {
  const geom = computeGeometry(page, typo, hf);
  const { size, lh, contentW, hfSize, hfH, bodyTop, bodyH, headerOn, footerOn } = geom;
  if (contentW < size * PT_MM || bodyH < lh) return [];

  const bodyFamily = getFamily(typo.fontFamily).cssFamily;
  const bodyWeight = normWeight(bodyFamily, typo.fontWeight);
  const bodyFont = { family: bodyFamily, weight: bodyWeight };
  const applyTitle = (s) => (s || '').split('{bookTitle}').join(bookTitle);
  const push = (pg, text, x, y, type, sz, h, font, extra) =>
    pg.lines.push({ text, x, y, type, size: sz, h, family: font.family, weight: font.weight, ...extra });

  /* ---------- 1. 正文 ---------- */
  const justifyOpts = {
    justify: typo.justify ?? true,
    maxGapEm: typo.justifyMaxGap ?? 0.5,
    stats: createJustifyStats(),
  };
  const body = [];
  const starts = new Map();
  const bodyBox = (right) => ({ x: right ? page.marginInside : page.marginOutside, y: bodyTop, w: contentW, h: bodyH });
  let cur = null;
  let y = 0;
  const newPage = (ch, type) => {
    const right = body.length % 2 === 0;
    cur = { type, chapterId: ch.id, chapterTitle: ch.title, lines: [], body: bodyBox(right) };
    body.push(cur);
    y = bodyTop;
  };

  const indent = typo.indent * size * PT_MM;
  const tSize = CHAPTER_TITLE_SIZE;
  const tH = tSize * CHAPTER_TITLE_LH * PT_MM;
  let prev = null;
  for (const ch of chapters) {
    if (body.length % 2 === 1) {
      body.push({ type: 'padBlank', chapterId: prev.id, chapterTitle: prev.title, lines: [], body: bodyBox(false) });
    }
    newPage(ch, 'chapterStart');
    starts.set(ch.id, body.length - 1);

    // 章标题：宋体 Heavy 16pt，左对齐；上方留白 40% 正文区高度，下方空 2 行
    y = bodyTop + bodyH * CHAPTER_TITLE_TOP;
    if (ch.title) {
      for (const l of wrapText(ch.title, tSize, contentW)) {
        push(cur, l.text, cur.body.x, y, 'chapterTitle', tSize, tH, HEADING_FONT);
        y += tH;
      }
      y += CHAPTER_TITLE_GAP_LINES * lh;
    }

    for (const para of ch.content.split('\n')) {
      if (!para) continue;
      for (const l of wrapText(para, size, contentW, indent, justifyOpts)) {
        if (y + lh > bodyTop + bodyH + 1e-6) newPage(ch, 'body');
        push(cur, l.text, cur.body.x + l.indent, y, 'body', size, lh, bodyFont,
          l.gap > 0 ? { gap: l.gap } : undefined);
        y += lh;
      }
      y += typo.paraSpacing * PT_MM;
    }
    prev = ch;
  }

  if (globalThis.location?.search?.includes('justify_debug=1')) {
    console.log('[NovelPress] 两端对齐统计', { ...justifyOpts.stats, maxGapEm_limit: justifyOpts.maxGapEm });
  }

  const start = Number.isFinite(hf.pageNumberStart) ? hf.pageNumberStart : 1;
  body.forEach((p, k) => {
    p.pageNo = start + k;
    p.showHF = p.type !== 'padBlank';
  });

  /* ---------- 2. 前置页 ---------- */
  const front = buildFrontMatter({
    entries: chapters.map((ch) => ({ title: ch.title, pageNo: body[starts.get(ch.id)].pageNo })),
    bookTitle, page, bodyFont, lineHeight: typo.lineHeight,
  });
  front.forEach((p) => { p.pageNo = null; p.showHF = false; });
  if (front.length % 2 !== 0) console.warn('[NovelPress] 前置页数应为偶数，当前为', front.length);

  /* ---------- 3. 合并 ---------- */
  const pages = [...front, ...body];
  pages.forEach((p, i) => {
    p.physicalIndex = i + 1;
    p.side = sideOf(p.physicalIndex);
  });

  /* ---------- 4. 页眉页脚 ---------- */
  const sepW = textWidth(SEP, hfSize);
  const gapW = hfSize * PT_MM * SEP_GAP_EM;   // 单侧半字宽

  /**
   * 画复合内容：text · num，用 3 个独立 line 分别绘制。
   * 右对齐侧额外内缩 RIGHT_EDGE_INSET_MM，避免估算误差导致右端越界。
   */
  const putTriple = (pg, text, num, yy, type, outerEdge, edge, xStart) => {
    const t = (text || '').trim();
    const n = (num || '').trim();
    if (!t && !n) return;

    const tW = t ? textWidth(t, hfSize) : 0;
    const nW = n ? textWidth(n, hfSize) : 0;
    const bothPresent = t && n;

    if (outerEdge === 'right') {
      const effectiveEdge = edge - RIGHT_EDGE_INSET_MM;
      const total = bothPresent
        ? tW + gapW + sepW + gapW + nW
        : (tW + nW);
      let x = effectiveEdge - total;

      if (bothPresent) {
        push(pg, t, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT); x += tW + gapW;
        push(pg, SEP, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT); x += sepW + gapW;
        push(pg, n, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      } else if (t) {
        push(pg, t, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      } else {
        push(pg, n, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      }
    } else {
      let x = xStart;
      if (bothPresent) {
        push(pg, n, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT); x += nW + gapW;
        push(pg, SEP, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT); x += sepW + gapW;
        push(pg, t, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      } else if (n) {
        push(pg, n, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      } else {
        push(pg, t, x, yy, type, hfSize, hfH, HEADER_FOOTER_FONT);
      }
    }
  };

  for (const p of pages) {
    if (!p.showHF) continue;
    const right = p.side === 'right';
    const { x, w } = p.body;
    const edge = x + w;

    const textRaw = hf.oddEvenDifferent ? (right ? p.chapterTitle : hf.headerText) : hf.headerText;
    const pageText = applyTitle(textRaw) || '';
    const pageNum = hf.showPageNumber ? formatPageNo(p.pageNo) : '';

    if (headerOn && footerOn) {
      // 原逻辑：页眉只放文字，页脚只放页码
      if (pageText) {
        if (right) push(p, pageText, edge - RIGHT_EDGE_INSET_MM - textWidth(pageText, hfSize), page.marginTop, 'header', hfSize, hfH, HEADER_FOOTER_FONT);
        else push(p, pageText, x, page.marginTop, 'header', hfSize, hfH, HEADER_FOOTER_FONT);
      }
      if (pageNum) {
        const fy = page.height - page.marginBottom - hfH;
        if (right) push(p, pageNum, edge - RIGHT_EDGE_INSET_MM - textWidth(pageNum, hfSize), fy, 'footer', hfSize, hfH, HEADER_FOOTER_FONT);
        else push(p, pageNum, x, fy, 'footer', hfSize, hfH, HEADER_FOOTER_FONT);
      }
    } else if (headerOn && !footerOn) {
      if (right) putTriple(p, pageText, pageNum, page.marginTop, 'header', 'right', edge, x);
      else       putTriple(p, pageText, pageNum, page.marginTop, 'header', 'left', edge, x);
    } else if (!headerOn && footerOn) {
      const fy = page.height - page.marginBottom - hfH;
      if (right) putTriple(p, pageText, pageNum, fy, 'footer', 'right', edge, x);
      else       putTriple(p, pageText, pageNum, fy, 'footer', 'left', edge, x);
    }
  }
  return pages;
}