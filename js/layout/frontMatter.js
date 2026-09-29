// file: js/layout/frontMatter.js
// 前置页生成：书名页（物理第 1 页）→ 空白页（第 2 页）→ 目录页（第 3 页起，可跨多页）→ [目录页数为奇数时补 1 张空白页]
// 这些页均无页眉页脚、不占页码（pageNo = null、showHF = false 由 paginator 统一写入）。
// 前置页总数恒为偶数，保证正文第一页（页码 1）落在物理奇数页 = 右页。
// 坐标单位 mm（与页面设置一致），字号单位 pt。版心 = 页边距围出的整块区域（无页眉页脚占位）。
// 行格式同 paginator：{ text, x, y, size, h, type, family, weight, align?, ax? }
//
// 目录条目：章节名左对齐，页码右对齐，中间留白（无点线引导符）。
// 目录页左右对称缩进：
//   右页（物理奇数）："目录"标题和章节名都右移 INDENT_RATIO，页码靠右不动。
//   左页（物理偶数）："目录"标题和章节名都靠左不动，页码左移 INDENT_RATIO。
// 目录分页：无论一页还是多页，每一页的内容都垂直居中。
import { PT_MM, textWidth, wrapText } from './textMetrics.js';
import { HEADING_FONT } from '../fonts.js';

export const BOOK_TITLE_SIZE = 24;       // pt，书名
export const TOC_HEADING_SIZE = 16;      // pt，"目录"
export const TOC_ENTRY_SIZE = 10;        // pt，目录条目（正文字体）
const HEADING_LH = 1.4;                  // 标题类文字的行高倍数
const TOC_HEADING_GAP_LINES = 2;         // "目录"下方空几行（按条目行高）
const INDENT_RATIO = 0.30;               // 目录条目左右对称缩进的比例（0~1）

const PAGE_NO_DIGITS = 3;                // 页码补零位数
const fmtPageNo = (n) => String(n).padStart(PAGE_NO_DIGITS, '0');

/** 物理页序号（从 1 起）→ 是否右页：奇数 = 右页 */
const isRightPhysical = (n) => n % 2 === 1;

/** 前置页的版心：页边距围出的整块区域；右页内侧在左，左页外侧在左 */
function frontBox(page, physicalIndex) {
  const right = isRightPhysical(physicalIndex);
  return {
    x: right ? page.marginInside : page.marginOutside,
    y: page.marginTop,
    w: page.width - page.marginInside - page.marginOutside,
    h: page.height - page.marginTop - page.marginBottom,
  };
}

const mkLine = (text, x, y, size, h, type, font, extra = {}) =>
  ({ text, x, y, size, h, type, family: font.family, weight: font.weight, ...extra });

/** 书名页：书名水平、垂直均居中（版心内） */
function titlePage(page, bookTitle) {
  const box = frontBox(page, 1);
  const pg = { type: 'title', lines: [], body: box, chapterId: null, chapterTitle: null };
  const title = (bookTitle || '').trim();
  if (!title) return pg;
  const size = BOOK_TITLE_SIZE;
  const h = size * HEADING_LH * PT_MM;

  const wrapped = wrapText(title, size, box.w);
  const n = wrapped.length;
  const blockH = n * h;

  const cx = box.x + box.w / 2;
  let y = box.y + box.h / 2 - blockH / 2;
  for (const l of wrapped) {
    pg.lines.push(mkLine(l.text, cx - textWidth(l.text, size) / 2, y, size, h, 'bookTitle', HEADING_FONT,
      { align: 'center', ax: cx }));
    y += h;
  }
  return pg;
}

const blankPage = (note) => ({ type: 'blank', note, lines: [], body: null, chapterId: null, chapterTitle: null });

/**
 * 目录单条目预测。
 * rightPage = true 时，章节名会右移 INDENT_RATIO * bodyW，可用宽度相应减少。
 */
function measureEntry(e, size, bodyW, rightPage) {
  const num = fmtPageNo(e.pageNo);
  const numW = textWidth(num, size);
  const em = size * PT_MM;
  const shift = bodyW * INDENT_RATIO;
  const nameMax = Math.max(em, bodyW - numW - 2 * em - shift);
  const name = e.title || '（无标题）';
  const nameLines = wrapText(name, size, nameMax);
  return { num, numW, name, nameLines, em, shift };
}

function tocPages(page, entries, bodyFont, lineHeight) {
  const size = TOC_ENTRY_SIZE;
  const lh = size * lineHeight * PT_MM;
  const hSize = TOC_HEADING_SIZE;
  const hH = hSize * HEADING_LH * PT_MM;
  const headingBlock = hH + TOC_HEADING_GAP_LINES * lh;

  // 每一页的内容在版心内垂直居中：
  //   先按页码能装下多少条分页，算出每页的实际内容高度，再把该页内容中心对齐到版心中心。
  // 分页预演：以"版心满高"为容量，逐条累积；超了就开新页。
  const pageStartIndices = [0];                             // 每页起始条目下标
  const pageContentHeights = [];                            // 每页内容高度（mm）

  {
    // 第 1 页：容量 = 版心高 - headingBlock（"目录"标题占位）
    const b1 = frontBox(page, 3);
    let capacity = b1.h - headingBlock;
    let used = 0;
    let i = 0;
    while (i < entries.length) {
      const rightPage = isRightPhysical(3 + pageStartIndices.length - 1);
      const { nameLines } = measureEntry(entries[i], size, b1.w, rightPage);
      const need = nameLines.length * lh;
      if (used + need > capacity + 1e-6 && used > 1e-6) {
        // 换页
        pageContentHeights.push(used + (pageStartIndices.length === 1 ? headingBlock : 0));
        pageStartIndices.push(i);
        // 新页：容量 = 版心高
        used = 0;
        capacity = b1.h;
        continue;
      }
      used += need;
      i++;
    }
    // 最后一页
    pageContentHeights.push(used + (pageStartIndices.length === 1 ? headingBlock : 0));
  }

  const out = [];
  for (let pi = 0; pi < pageStartIndices.length; pi++) {
    const physical = 3 + pi;
    const box = frontBox(page, physical);
    const rightPage = isRightPhysical(physical);
    const cur = { type: 'toc', tocIndex: pi, lines: [], body: box, chapterId: null, chapterTitle: null, rightPage };
    out.push(cur);

    // 垂直居中：内容块中心 = 版心中心
    const contentH = pageContentHeights[pi];
    let y = box.y + box.h / 2 - contentH / 2;
    if (y < box.y) y = box.y;

    // "目录"标题：只在第 1 页；右页右移，左页不动
    if (pi === 0) {
      const headingShift = rightPage ? box.w * INDENT_RATIO : 0;
      cur.lines.push(mkLine('目录', box.x + headingShift, y, hSize, hH, 'tocHeading', HEADING_FONT));
      y += headingBlock;
    }

    const from = pageStartIndices[pi];
    const to = (pi + 1 < pageStartIndices.length) ? pageStartIndices[pi + 1] : entries.length;
    for (let i = from; i < to; i++) {
      const e = entries[i];
      const { num, numW, nameLines, shift } = measureEntry(e, size, box.w, rightPage);
      const { x, w } = box;
      const right = x + w;

      const nameX = rightPage ? x + shift : x;
      const numAnchorX = rightPage ? right : right - shift;
      const numX = numAnchorX - numW;

      nameLines.forEach((l, li) => {
        cur.lines.push(mkLine(l.text, nameX, y, size, lh, 'toc', bodyFont));
        if (li === nameLines.length - 1) {
          cur.lines.push(mkLine(num, numX, y, size, lh, 'tocNum', bodyFont,
            { align: 'right', ax: numAnchorX }));
        }
        y += lh;
      });
    }
  }

  return out;
}

export function buildFrontMatter({ entries, bookTitle, page, bodyFont, lineHeight }) {
  const pages = [titlePage(page, bookTitle), blankPage('书名页背面')];
  const toc = tocPages(page, entries, bodyFont, lineHeight);
  pages.push(...toc);
  if (toc.length % 2 === 1) pages.push(blankPage('目录补页'));
  pages.forEach((p, i) => { if (!p.body) p.body = frontBox(page, i + 1); });
  return pages;
}
