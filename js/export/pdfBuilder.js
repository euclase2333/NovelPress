// file: js/export/pdfBuilder.js
// 用 pdf-lib 组装普通 PDF（不转曲）：每个用到的字体（族+字重）各嵌入一份，文字用 drawText 直接绘制
// 每行文字的字体由分页结果里的 family / weight 决定，与预览一致；所有文字为纯黑
// 页面 = (宽+2×出血) × (高+2×出血)；出血区四角绘制裁切角线；同时写入 TrimBox / BleedBox
// 页序即分页结果的物理页序（书名页 / 空白页 / 目录 / 章间补白页都照常输出，空白页只有角线）
// 对齐：line.align = 'right' | 'center' 时，以 line.ax 为锚点、按字体实际字宽定位（章标题、目录页码、右页页眉页脚、书名）
// 两端对齐：line.gap > 0 的行逐字 drawText，x 用 charWidth 估算宽度 + gap 累加（与 wrapText 一致，右端严格贴齐）
// 子集化默认关闭：pdf-lib + fontkit 生成的子集元信息不完整，Acrobat 会报
// "无法提取嵌入的字体 xxx" 警告。默认改为完整嵌入，保证兼容性。
// 如需体积优先（PDF 会小很多，但可能触发上述警告），可用 ?subset=1 打开页面。
import { PT_MM, charWidth } from '../layout/textMetrics.js';
import { fontKey, fallbackKey, fontPath, FONT_FAMILIES } from '../fonts.js';

const MM_PT = 72 / 25.4;

/** 一行文字对应的字体键；族名/字重缺失或不存在时落到 fontKey 的兜底（该族 Regular，未知族按宋体） */
export const lineFontKey = (l) => fontKey(l.family, l.weight);

/** 分页结果中实际用到的字体键（含书名/目录/章标题与页眉页脚的宋体 Heavy） */
export function usedFontKeys(pages) {
  const set = new Set();
  for (const p of pages) for (const l of p.lines) set.add(lineFontKey(l));
  if (!set.size) set.add(fallbackKey(FONT_FAMILIES[0].cssFamily));
  return [...set];
}

/** 出血区四角的角线：从页面边缘画到成品角点，长度=出血宽度 */
function drawCropMarks(pg, rgb, W, H, b, tw, th) {
  const opt = { thickness: 0.25, color: rgb(0, 0, 0) };
  for (const x of [b, b + tw]) {
    pg.drawLine({ start: { x, y: 0 }, end: { x, y: b }, ...opt });
    pg.drawLine({ start: { x, y: H }, end: { x, y: H - b }, ...opt });
  }
  for (const y of [b, b + th]) {
    pg.drawLine({ start: { x: 0, y }, end: { x: b, y }, ...opt });
    pg.drawLine({ start: { x: W, y }, end: { x: W - b, y }, ...opt });
  }
}

/** 一行文字的 x（pt，含出血偏移）：左对齐用 l.x；右/居中对齐按实际字宽相对锚点 l.ax 回移 */
function lineX(l, font, b) {
  if ((l.align === 'right' || l.align === 'center') && l.ax != null) {
    const w = font.widthOfTextAtSize(l.text, l.size);
    return b + l.ax * MM_PT - (l.align === 'right' ? w : w / 2);
  }
  return b + l.x * MM_PT;
}

/** fontBytes: { [字体键]: Uint8Array }（回退到 Regular 的字体与 Regular 是同一个数组引用） */
export async function buildPdf({ pages, page, fontBytes, title = 'NovelPress', onProgress }) {
  const lib = globalThis.PDFLib, fk = globalThis.fontkit;
  if (!lib || !fk) throw new Error('pdf-lib / fontkit 未加载，请检查网络或 CDN');
  const { PDFDocument, rgb } = lib;

  // 默认不子集化（兼容性优先）；?subset=1 时才开启子集化（体积优先）
  const subset = new URLSearchParams(globalThis.location?.search || '').get('subset') === '1';

  const doc = await PDFDocument.create();
  doc.registerFontkit(fk);                                    // 必须在 embedFont 之前
  doc.setTitle(title || 'NovelPress');
  doc.setProducer('NovelPress');
  doc.setCreator('NovelPress');

  console.group('[NovelPress] 导出字体信息');
  console.log('用到的字体：', Object.keys(fontBytes).join('、'), `｜ 子集化：${subset ? '开（?subset=1）' : '关（默认）'}`);
  const fonts = {};                                           // 字体键 → { font, A, D }
  const embeddedByBytes = new Map();                          // 同一份字节只嵌入一次（回退字体复用 Regular）
  try {
    for (const [key, bytes] of Object.entries(fontBytes)) {
      if (embeddedByBytes.has(bytes)) {
        fonts[key] = embeddedByBytes.get(bytes);
        console.log(`${key}: 使用回退字体（复用已嵌入的字体，不重复嵌入）`);
        continue;
      }
      const t0 = performance.now();
      const f = await doc.embedFont(bytes, { subset });
      const kf = f.embedder?.font;
      const n = kf?.numGlyphs;
      const hasCJK = kf?.hasGlyphForCodePoint?.(0x4e2d);      // “中”
      console.log(`${key} ← ${fontPath(key)} ｜ numGlyphs=${n} ｜ 含“中”字形=${hasCJK} ｜ ${(performance.now() - t0).toFixed(0)}ms`);
      if (!n) console.warn(`${key}: 未读到 numGlyphs，字体可能没有被正确解析`);
      else if (hasCJK === false) console.warn(`${key}: 字体里没有中文字形，请确认下载的是 CN 简体版`);
      // 基线位置与预览一致：基线 = 行顶 + 行高/2 + (A−D)/2 × 字号（A/D 为该字体上升/下降占 em 比例）。宋体、黑体各用自己的度量
      const entry = {
        font: f,
        A: kf ? kf.ascent / kf.unitsPerEm : 0.88,
        D: kf ? Math.abs(kf.descent) / kf.unitsPerEm : 0.12,
      };
      embeddedByBytes.set(bytes, entry);
      fonts[key] = entry;
    }
  } finally {
    console.groupEnd();
  }
  const ref = Object.values(fonts)[0];
  if (!ref) throw new Error('没有可用字体');

  const b = page.bleed * MM_PT, tw = page.width * MM_PT, th = page.height * MM_PT;
  const W = tw + 2 * b, H = th + 2 * b;
  const black = rgb(0, 0, 0);

  for (let i = 0; i < pages.length; i++) {
    const pdfPage = doc.addPage([W, H]);
    if (b > 0) {
      pdfPage.setBleedBox(0, 0, W, H);
      pdfPage.setTrimBox(b, b, tw, th);
      drawCropMarks(pdfPage, rgb, W, H, b, tw, th);
    }
    for (const l of pages[i].lines) {
      if (!l.text) continue;
      const { font, A, D } = fonts[lineFontKey(l)] || ref;
      const baseMm = l.y + l.h / 2 + ((A - D) / 2) * l.size * PT_MM;
      const common = { y: H - b - baseMm * MM_PT, size: l.size, font, color: black };

      if (l.gap > 0 && !l.align) {
        // 两端对齐行：逐字绝对定位（纯全角行，不会触发"英文+数字"全角数字 bug）
        let xmm = l.x;
        for (const ch of l.text) {
          pdfPage.drawText(ch, { ...common, x: b + xmm * MM_PT });
          xmm += charWidth(ch, l.size) + l.gap;
        }
      } else {
        pdfPage.drawText(l.text, { ...common, x: lineX(l, font, b) });
      }
    }
    if (i % 10 === 9) { onProgress?.(i + 1, pages.length); await new Promise((r) => setTimeout(r)); }
  }
  return doc.save();
}