// file: js/layout/frontMatter.js
// 前置页生成：书名页（物理第 1 页）→ 空白页（第 2 页）→ 目录页（第 3 页起，可跨多页）→ [目录页数为奇数时补 1 张空白页]
// 这些页均无页眉页脚、不占页码（pageNo = null、showHF = false 由 paginator 统一写入）。
// 前置页总数恒为偶数，保证正文第一页（页码 1）落在物理奇数页 = 右页。
// 坐标单位 mm（与页面设置一致），字号单位 pt。版心 = 页边距围出的整块区域（无页眉页脚占位）。
// 行格式同 paginator：{ text, x, y, size, h, type, family, weight, align?, ax? }
//   align = 'right' | 'center' 时，ax 为锚点（右边缘 / 中线），预览与 PDF 按实际字宽对齐；x 为估算值，仅作兜底
//
// 目录页码：补零到 PAGE_NO_DIGITS 位，不加空格（目录条目里数字不与英文混排，
// 不会触发 fontkit 的全角替换，直接半角即可）。
import { PT_MM, textWidth, wrapText } from './textMetrics.js';
import { HEADING_FONT } from '../fonts.js';

export const BOOK_TITLE_SIZE = 24;       // pt，书名
export const TOC_HEADING_SIZE = 16;      // pt，"目录"
export const TOC_ENTRY_SIZE = 10;        // pt，目录条目（正文字体）
const HEADING_LH = 1.4;                  // 标题类文字的行高倍数
const TOC_HEADING_GAP_LINES = 2;         // "目录"下方空几行（按条目行高）
const LEADER = '…';                      // 点线引导符：CN 字体中为全角，与估算宽度（1em）一致

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

/** 目录单条目预测 */
function measureEntry(e, size, bodyW) {
  const num = fmtPageNo(e.pageNo);
  const numW = textWidth(num, size);
  const em = size * PT_MM;
  const name = e.title || '（无标题）';
  const nameMax = Math.max(em, bodyW - numW - 2 * em);
  const nameLines = wrapText(name, size, nameMax);
  return { num, numW, name, nameLines, em };
}

/**
 * 目录页（从物理第 3 页开始）
 *   - 若所有条目能装进一页 → 唯一一页内容垂直居中
 *   - 若装不下 → 逐页顶部起排
 */
function tocPages(page, entries, bodyFont, lineHeight) {
  const size = TOC_ENTRY_SIZE;
  const em = size * PT_MM;
  const lh = size * lineHeight * PT_MM;
  const hSize = TOC_HEADING_SIZE;
  const hH = hSize * HEADING_LH * PT_MM;
  const headingBlock = hH + TOC_HEADING_GAP_LINES * lh;

  const singlePage = (() => {
    const b = frontBox(page, 3);
    let y = b.y + headingBlock;
    const bottom = b.y + b.h;
    for (const e of entries) {
      const { nameLines } = measureEntry(e, size, b.w);
      const need = nameLines.length * lh;
      if (y + need > bottom + 1e-6 && y > b.y + 1e-6) return false;
      y += need;
    }
    return true;
  })();

  const out = [];
  let cur = null;
  let y = 0;
  const newPage = () => {
    const box = frontBox(page, 3 + out.length);
    cur = { type: 'toc', tocIndex: out.length, lines: [], body: box, chapterId: null, chapterTitle: null };
    out.push(cur);
    y = box.y;
  };

  newPage();
  let startY = cur.body.y;
  if (singlePage) {
    let total = headingBlock;
    for (const e of entries) {
      const { nameLines } = measureEntry(e, size, cur.body.w);
      total += nameLines.length * lh;
    }
    startY = cur.body.y + cur.body.h / 2 - total / 2;
    if (startY < cur.body.y) startY = cur.body.y;
  }
  y = startY;

  cur.lines.push(mkLine('目录', cur.body.x, y, hSize, hH, 'tocHeading', HEADING_FONT));
  y += headingBlock;

  for (const e of entries) {
    const { num, numW, nameLines, em: emLocal } = measureEntry(e, size, cur.body.w);
    const need = nameLines.length * lh;
    const bottom = cur.body.y + cur.body.h;
    if (y + need > bottom + 1e-6 && y > cur.body.y + 1e-6) newPage();

    const { x, w } = cur.body;
    const right = x + w;
    nameLines.forEach((l, i) => {
      cur.lines.push(mkLine(l.text, x, y, size, lh, 'toc', bodyFont));
      if (i === nameLines.length - 1) {
        const nameEnd = x + textWidth(l.text, size) + emLocal / 2;
        const leaderEnd = right - numW - emLocal / 2;
        const count = Math.floor((leaderEnd - nameEnd) / emLocal + 1e-6);
        if (count > 0) {
          const lt = LEADER.repeat(count);
          cur.lines.push(mkLine(lt, leaderEnd - count * emLocal, y, size, lh, 'tocLeader', bodyFont));
        }
        cur.lines.push(mkLine(num, right - numW, y, size, lh, 'tocNum', bodyFont, { align: 'right', ax: right }));
      }
      y += lh;
    });
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