// file: js/preview/preview.js
// 预览区：DOM 模拟纸张（出血浅蓝 + 黑色裁切线 + 可开关辅助线），可视区外的页面不渲染文字
// 单页：每行一页；双页：每行 [左页 | 右页]，按物理页序号配对（奇数 = 右页，书名页 = 物理第 1 页单独占右侧，末页为左页则单独占左侧）
// 标题栏显示"物理页 / 总页数"，正文页另附页码；书名页、空白页、目录页无页码
// 与章节列表通过 document 自定义事件通信：
//   接收 'goto-chapter'    detail: { id }  → 滚动到该章起始页所在行
//   发出 'current-chapter' detail: { id }  → 当前视口所在章节变化
import { getState, set, subscribe, resolveBookTitle } from '../state.js';
import { paginate } from '../layout/paginator.js';
import { renameAt } from '../layout/chapter.js';
import { fontLoadSpec, HEADER_FOOTER_FONT, HEADING_FONT } from '../fonts.js';
import { createShell, createEmptyShell, fillPage, clearPage, pageDesc, attachTitleEditing } from './pageView.js';

const PX_PER_MM = 96 / 25.4;   // ≈3.7795
const DEBOUNCE_MS = 200;       // 控件改动 → 重排的防抖
const WATCH = new Set(['chapters', 'page', 'typography', 'headerFooter', 'bookTitle', 'sourceFileName', '*']);
const DOUBLE_PAD = 48;         // 双页自适应时预留的左右留白（px）
const DOUBLE_GAP = 8;          // 左右页间距（px），需与 css .spread-row 的 gap 一致

const TOOLBAR = `
  <div class="seg" id="tb-mode" role="group" aria-label="页面视图">
    <button type="button" class="seg-btn active" data-mode="single">单页</button>
    <button type="button" class="seg-btn" data-mode="double">双页</button>
  </div>
  <label class="tb-item"><input type="checkbox" id="tb-guides" checked> 辅助线</label>
  <label class="tb-item">缩放
    <select id="tb-zoom" class="input tb-select">
      <option value="0.75">75%</option><option value="1" selected>100%</option>
      <option value="1.25">125%</option><option value="1.5">150%</option>
    </select>
  </label>
  <span class="tb-info" id="tb-info"></span>`;

export function mountPreview(titleEl, bodyEl) {
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';
  toolbar.innerHTML = TOOLBAR;
  bodyEl.parentNode.insertBefore(toolbar, bodyEl);
  const canvas = document.createElement('div');
  canvas.className = 'preview-canvas show-guides';
  bodyEl.replaceChildren(canvas);
  attachTitleEditing(canvas);   // 章标题双击编辑：事件委托，canvas 跨 rebuild() 长期有效

  const info = toolbar.querySelector('#tb-info');
  const zoomSel = toolbar.querySelector('#tb-zoom');
  let mode = 'single';            // 'single' | 'double'
  let pages = [];
  let rows = [];                  // [{ el, l, r }]，l/r 为 pages 下标，-1 表示无
  let rowOfPage = [];             // pages 下标 → rows 下标
  let dims = { width: 148, bleed: 3 };
  const byShell = new Map();
  let token = 0;                  // 异步重排的版本号，防止旧结果覆盖新结果
  let lastChapterId = null;
  let lockUntil = 0;              // 跳转后短暂屏蔽滚动触发的章节判断

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const pg = byShell.get(e.target);
      if (!pg) continue;
      if (e.isIntersecting) fillPage(e.target, pg); else clearPage(e.target);
    }
  }, { root: bodyEl, rootMargin: '1200px 0px' });

  function hint(text) {
    const p = document.createElement('p');
    p.className = 'empty-hint';
    p.textContent = text;
    canvas.replaceChildren(p);
  }

  /* ---------- 缩放 ---------- */
  const setMm = (z) => canvas.style.setProperty('--mm', `${PX_PER_MM * z}px`);
  function applyZoom() {
    if (mode === 'double') {
      const spreadPx = 2 * (dims.width + 2 * dims.bleed) * PX_PER_MM;
      const avail = bodyEl.clientWidth - DOUBLE_PAD - DOUBLE_GAP;
      const z = Math.max(0.2, Math.min(1, avail / spreadPx));   // 自适应，不超过 100%
      setMm(z);
    } else {
      setMm(Number(zoomSel.value));
    }
  }

  /* ---------- 视口定位 ---------- */
  const rowTop = (row) => row.el.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top;

  /** 视口上 1/3 处所在的行（行在纵向单调排列，二分查找） */
  function currentRowIndex() {
    const limit = bodyEl.clientHeight / 3;
    let lo = 0;
    let hi = rows.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rowTop(rows[mid]) <= limit) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function emitChapter(id) {
    if (id === lastChapterId) return;
    lastChapterId = id;
    document.dispatchEvent(new CustomEvent('current-chapter', { detail: { id } }));
  }

  /** 标题栏文字：预览 · 说明 · 第 物理页 / 总页数 页 · 页码 N（无页码的页不显示） */
  function titleText(row) {
    const idx = row.r >= 0 ? row.r : row.l;                   // 一行两页时取右页
    const pg = pages[idx];
    const both = row.l >= 0 && row.r >= 0;
    const span = both ? `${pages[row.l].physicalIndex}–${pages[row.r].physicalIndex}` : `${pg.physicalIndex}`;
    const nos = [row.l, row.r].filter((i) => i >= 0 && pages[i].pageNo != null).map((i) => pages[i].pageNo);
    const no = nos.length ? ` · 页码 ${nos.join('–')}` : '';
    return { pg, text: `预览 · ${pageDesc(pg)} · 第 ${span} / ${pages.length} 页${no}` };
  }

  function updateTitle() {
    if (!pages.length || !rows.length) { titleEl.textContent = '预览'; return; }
    const { pg, text } = titleText(rows[currentRowIndex()]);
    titleEl.textContent = text;
    if (performance.now() >= lockUntil) emitChapter(pg.chapterId ?? null);   // 前置页 → 取消章节高亮
  }

  /* ---------- 分行 ---------- */
  function buildRows(list) {
    const out = [];
    let i = 0;
    while (i < list.length) {
      if (mode === 'single') { out.push({ l: -1, r: i, single: true }); i += 1; continue; }
      if (list[i].side === 'right') {                         // 右页前面没有左页：独占右侧
        out.push({ l: -1, r: i }); i += 1;
      } else if (i + 1 < list.length && list[i + 1].side === 'right') {
        out.push({ l: i, r: i + 1 }); i += 2;                 // 左页 + 紧随其后的右页
      } else {
        out.push({ l: i, r: -1 }); i += 1;                    // 末页为左页：独占左侧
      }
    }
    return out;
  }

  /* ---------- 字体预载：切换字体/字重后先加载再渲染 ---------- */
  async function preloadFonts(typo) {
    if (!document.fonts || !document.fonts.load) return;
    const specs = new Set([
      fontLoadSpec(typo.fontFamily, typo.fontWeight),
      fontLoadSpec(HEADING_FONT.family, HEADING_FONT.weight),  // 书名 / 目录标题 / 章标题
      fontLoadSpec(HEADER_FOOTER_FONT.family, HEADER_FOOTER_FONT.weight),
    ]);
    try { await Promise.all([...specs].map((sp) => document.fonts.load(sp, '中文Ab1'))); } catch { /* 加载失败则回落系统字体 */ }
  }

  /* ---------- 重排与渲染 ---------- */
  async function rebuild(opts = {}) {
    const my = ++token;
    const s = getState();
    const list = s.chapters.length
      ? paginate(s.chapters, s.page, s.typography, s.headerFooter, { bookTitle: resolveBookTitle(s) })
      : [];

    if (!list.length) {
      io.disconnect(); byShell.clear();
      pages = []; rows = []; rowOfPage = [];
      info.textContent = '';
      hint(s.chapters.length ? '页面参数无效：正文区放不下一行文字，请检查页边距、字号。' : '尚无章节。请在左侧导入文件或粘贴文本后识别章节。');
      updateTitle();
      return;
    }

    await preloadFonts(s.typography);
    if (my !== token) return;                                 // 期间又有新的重排请求

    const top = bodyEl.scrollTop;
    io.disconnect();
    byShell.clear();
    pages = list;
    dims = { width: s.page.width, bleed: s.page.bleed };
    info.textContent = `共 ${pages.length} 页`;
    canvas.style.setProperty('--pw', s.page.width);
    canvas.style.setProperty('--ph', s.page.height);
    canvas.style.setProperty('--bleed', s.page.bleed);
    canvas.style.setProperty('--book-font', `"${s.typography.fontFamily}"`);
    canvas.classList.toggle('mode-double', mode === 'double');
    applyZoom();

    rows = buildRows(pages);
    rowOfPage = new Array(pages.length).fill(0);
    const shells = [];
    const frag = document.createDocumentFragment();
    const mk = (i) => {
      const pg = pages[i];
      const shell = createShell(pg, s.page);
      byShell.set(shell, pg);
      shells.push(shell);
      return shell;
    };
    rows.forEach((row, ri) => {
      const el = document.createElement('div');
      el.className = `spread-row ${row.single ? 'is-single' : 'is-double'}`;
      if (row.single) {
        el.append(mk(row.r));
      } else {
        el.append(row.l >= 0 ? mk(row.l) : createEmptyShell(), row.r >= 0 ? mk(row.r) : createEmptyShell());
      }
      row.el = el;
      if (row.l >= 0) rowOfPage[row.l] = ri;
      if (row.r >= 0) rowOfPage[row.r] = ri;
      frag.append(el);
    });
    canvas.replaceChildren(frag);
    shells.forEach((sh) => io.observe(sh));

    if (opts.anchorPhysical != null) {                        // 切换单/双页：保持在原来的物理页附近
      const idx = pages.findIndex((p) => p.physicalIndex === opts.anchorPhysical);
      if (idx >= 0) bodyEl.scrollTop += rowTop(rows[rowOfPage[idx]]);
      else bodyEl.scrollTop = top;
    } else {
      bodyEl.scrollTop = top;
    }
    lastChapterId = null;                                     // 重建后重新通知章节列表
    updateTitle();
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, DEBOUNCE_MS); };

  /* ---------- 工具栏 ---------- */
  toolbar.querySelector('#tb-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.dataset.mode === mode) return;
    let anchor = null;                                        // 记下当前所在物理页，切换后回到它
    if (rows.length) {
      const row = rows[currentRowIndex()];
      anchor = pages[row.r >= 0 ? row.r : row.l].physicalIndex;
    }
    mode = btn.dataset.mode;
    toolbar.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    zoomSel.disabled = mode === 'double';                     // 双页自动适配，缩放下拉禁用
    rebuild({ anchorPhysical: anchor });
  });
  zoomSel.addEventListener('change', () => { applyZoom(); updateTitle(); });
  toolbar.querySelector('#tb-guides').addEventListener('change', (e) => canvas.classList.toggle('show-guides', e.target.checked));

  let raf = 0;
  bodyEl.addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(updateTitle); });

  // 窗口/面板尺寸变化：双页重新计算适配缩放
  if (typeof ResizeObserver !== 'undefined') {
    let rraf = 0;
    new ResizeObserver(() => {
      if (mode !== 'double') return;
      cancelAnimationFrame(rraf);
      rraf = requestAnimationFrame(() => { applyZoom(); updateTitle(); });
    }).observe(bodyEl);
  }

  /* ---------- 章节跳转 ---------- */
  // 章标题双击编辑确认：更新 state.chapters，触发本区重排与左侧章节列表刷新（两边都已订阅 'chapters'）
  document.addEventListener('chapter-title-edit', (e) => {
    const { chapterId, title } = e.detail || {};
    if (!chapterId) return;
    const { chapters } = getState();
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx < 0) return;
    set('chapters', renameAt(chapters, idx, title));
  });

  document.addEventListener('goto-chapter', (e) => {
    const id = e.detail && e.detail.id;
    const idx = pages.findIndex((p) => p.type === 'chapterStart' && p.chapterId === id);   // 每章必有章首页
    if (idx < 0) return;
    const row = rows[rowOfPage[idx]];
    bodyEl.scrollTop += rowTop(row) - 8;
    lockUntil = performance.now() + 400;                      // 跳转产生的滚动事件不改写高亮
    emitChapter(pages[idx].chapterId);
    titleEl.textContent = titleText(mode === 'single' ? { l: -1, r: idx } : row).text;
  });

  subscribe((_s, key) => { if (WATCH.has(key)) schedule(); });
  applyZoom();
  rebuild();
}
