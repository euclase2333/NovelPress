// file: js/preview/pageView.js
// 单页 DOM：页壳（出血/裁切线/辅助线）与懒加载的文字行。所有几何用 CSS 变量（mm）驱动
// 每行文字自带 font-family / font-weight（来自 paginator 输出的 family、weight），预览与 PDF 用同一份数据
// 两端对齐行带 gap（mm/字间隙）→ --gap → CSS letter-spacing（末字后也会加，不影响视觉）
// 章标题（type='chapterTitle'）支持双击原地编辑：attachTitleEditing() 用事件委托绑在 canvas 上，
//   兼容懒渲染（行 DOM 会随滚动反复创建/销毁）。编辑不直接改 state，改用 'chapter-title-edit' 事件
//   交给 preview.js 处理，保持本模块不依赖 state.js。
// align = right / center 的行：left 取锚点 ax，再用 transform 按实际字宽回移，与 PDF 按字宽对齐的结果一致
import { cssWeightOf } from '../fonts.js';

const div = (cls, text) => {
  const n = document.createElement('div');
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const guide = (cls, x, y, w, h) => {
  const g = div(`guide ${cls}`);
  g.style.cssText = `--x:${x};--y:${y};--w:${w};--h:${h}`;
  return g;
};

/** 页面类型 → 简短说明（页签、标题栏共用） */
export function pageDesc(pg) {
  switch (pg.type) {
    case 'title': return '书名页';
    case 'blank': return pg.note ? `空白页（${pg.note}）` : '空白页';
    case 'toc': return pg.tocIndex ? `目录（续 ${pg.tocIndex + 1}）` : '目录';
    case 'padBlank': return '空白页（章节补白）';
    default: return pg.chapterTitle || '（无标题）';
  }
}

const BADGE = {
  title: ['书名', 'badge-muted'],
  blank: ['空白', 'badge-muted'],
  toc: ['目录', 'badge-muted'],
  padBlank: ['补白', 'badge-muted'],
  chapterStart: ['章首', ''],
};

export function createShell(pg, geom) {
  const wrap = div(`page-wrap page-${pg.type}`);
  wrap.dataset.physical = String(pg.physicalIndex);
  wrap.dataset.type = pg.type;
  const side = pg.side === 'right' ? '右' : '左';
  const no = pg.pageNo != null ? `第 ${pg.pageNo} 页` : '无页码';
  const label = div('page-label', `P${pg.physicalIndex} · ${side}页 · ${no} · ${pageDesc(pg)}`);
  const badge = BADGE[pg.type];
  if (badge) label.prepend(div(`page-badge ${badge[1]}`.trim(), badge[0]));
  const trim = div('trim');
  trim.append(
    guide('guide-margin', pg.body.x, geom.marginTop, pg.body.w, geom.height - geom.marginTop - geom.marginBottom),
    guide('guide-body', pg.body.x, pg.body.y, pg.body.w, pg.body.h),
    div('lines'),
  );
  const sheet = div('sheet');
  sheet.append(trim);
  wrap.append(label, sheet);
  return wrap;
}

/** 双页模式下缺页一侧的空占位：与真实页同尺寸，不可见，保持版心对齐 */
export function createEmptyShell() {
  const wrap = div('page-wrap page-empty');
  wrap.setAttribute('aria-hidden', 'true');
  const label = div('page-label', ' ');
  const sheet = div('sheet');
  sheet.append(div('trim'));
  wrap.append(label, sheet);
  return wrap;
}

export function fillPage(wrap, pg) {
  const box = wrap.querySelector('.lines');
  if (!box || box.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (const l of pg.lines) {
    const aligned = (l.align === 'right' || l.align === 'center') && l.ax != null;
    const d = div(`line line-${l.type}${aligned ? ` align-${l.align}` : ''}`, l.text);
    const fam = l.family || 'Source Han Serif';
    d.style.cssText =
      `--x:${aligned ? l.ax : l.x};--y:${l.y};--size:${l.size};--h:${l.h};` +
      (l.gap > 0 ? `--gap:${l.gap};` : '') +
      `font-family:"${fam}","Source Han Serif",serif;font-weight:${cssWeightOf(fam, l.weight)}`;
    if (l.type === 'chapterTitle') {
      // 供双击编辑使用：完整原始标题（未被 wrapText 拆行）、所属章节 id、可用宽度（mm，供输入框定位）
      d.dataset.chapterId = pg.chapterId;
      d.dataset.title = pg.chapterTitle || '';
      d.dataset.w = pg.body.w;
    }
    frag.append(d);
  }
  box.append(frag);
}

export const clearPage = (wrap) => {
  const box = wrap.querySelector('.lines');
  if (box) box.replaceChildren();
};

/**
 * 章标题双击编辑：事件委托绑在 canvas 上（跨 rebuild() 长期有效，兼容懒渲染的行 DOM）。
 * 双击命中 .line-chapterTitle → 隐藏该章标题的所有行（标题可能被 wrapText 拆成多行）→
 * 在第一行位置叠一个单行 <input>，Enter/失焦确认，Esc 取消。
 * 确认时不直接改 state，派发 'chapter-title-edit' 事件（detail: {chapterId, title}）交给上层处理，
 * 保持本模块不依赖 state.js。输入框在确认后禁用并留在原位，等外部 rebuild() 用新 DOM 整体替换即可，
 * 不需要在这里手动清理。
 */
export function attachTitleEditing(canvas) {
  canvas.addEventListener('dblclick', (e) => {
    const line = e.target.closest('.line-chapterTitle');
    if (!line) return;
    const box = line.parentElement;
    if (box.querySelector('.title-edit-input')) return;   // 已有编辑框在进行中

    const chapterId = line.dataset.chapterId;
    const title = line.dataset.title || '';
    const rows = [...box.querySelectorAll('.line-chapterTitle')].filter((r) => r.dataset.chapterId === chapterId);
    if (!rows.length) return;
    const first = rows[0];
    rows.forEach((r) => { r.style.visibility = 'hidden'; });

    const input = document.createElement('input');
    input.className = 'title-edit-input';
    input.value = title;
    input.style.cssText =
      `--x:${first.style.getPropertyValue('--x')};--y:${first.style.getPropertyValue('--y')};` +
      `--size:${first.style.getPropertyValue('--size')};--h:${first.style.getPropertyValue('--h')};` +
      `--w:${first.dataset.w};font-family:${first.style.fontFamily};font-weight:${first.style.fontWeight}`;
    box.append(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        const val = input.value.trim();
        if (val && val !== title) {
          input.disabled = true;                          // 保留显示，等 rebuild() 用新 DOM 整体替换
          document.dispatchEvent(new CustomEvent('chapter-title-edit', { detail: { chapterId, title: val } }));
          return;
        }
      }
      input.remove();
      rows.forEach((r) => { r.style.visibility = ''; });
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  });
}
