// file: js/ui/chapterList.js
// 章节列表：点击跳转、高亮当前章、拖拽排序、双击改名、删除、在其后插入空白章节
// 与预览区通过 document 自定义事件通信（不往 state 里塞 UI 状态，避免触发重排）：
//   发出 'goto-chapter'    detail: { id }
//   接收 'current-chapter' detail: { id }  → 高亮
import { getState, set, subscribe } from '../state.js';
import { moveChapter, insertAfter, removeAt, renameAt } from '../layout/chapter.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;   // 标题来自文件，一律用 textContent，避免注入
  return n;
};
const iconBtn = (text, act, title) => {
  const b = el('button', 'icon-btn', text);
  b.dataset.act = act;
  b.title = title;
  return b;
};

export function mountChapterList(ul) {
  let dragFrom = null;
  let activeId = null;                        // 当前所在章节 id（由预览区通知）
  const commit = (list) => set('chapters', list);

  function item(c, i) {
    const li = el('li', 'chapter-item');
    li.draggable = true;
    li.dataset.index = i;
    li.dataset.id = c.id;
    if (c.id === activeId) li.classList.add('active');
    const title = el('span', 'ch-title', c.title || '（无标题）');
    title.title = '点击跳转 · 双击改名';
    li.append(el('span', 'drag-handle', '⋮⋮'), title, el('span', 'ch-meta', `${c.content.length}字`),
      iconBtn('＋', 'add', '在其后插入空白章节'), iconBtn('×', 'del', '删除章节'));
    return li;
  }

  function render() {
    const { chapters } = getState();
    ul.replaceChildren();
    if (!chapters.length) { ul.append(el('li', 'empty-hint', '暂无章节')); return; }
    chapters.forEach((c, i) => ul.append(item(c, i)));
  }

  function setActive(id, scroll) {
    activeId = id;
    let target = null;
    ul.querySelectorAll('.chapter-item').forEach((li) => {
      const on = li.dataset.id === String(id);
      li.classList.toggle('active', on);
      if (on) target = li;
    });
    if (scroll && target) target.scrollIntoView({ block: 'nearest' });
  }

  function startRename(li, i) {
    const { chapters } = getState();
    const span = li.querySelector('.ch-title');
    const input = el('input', 'input ch-input');
    input.value = chapters[i].title;
    li.draggable = false;
    span.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    input.addEventListener('blur', () => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v && v !== chapters[i].title) commit(renameAt(getState().chapters, i, v));
      else render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = chapters[i].title; input.blur(); }
    });
  }

  ul.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    const li = e.target.closest('.chapter-item');
    if (btn) {
      const i = Number(btn.closest('li').dataset.index);
      const { chapters } = getState();
      if (btn.dataset.act === 'add') commit(insertAfter(chapters, i));
      if (btn.dataset.act === 'del' && confirm(`删除章节「${chapters[i].title}」？`)) commit(removeAt(chapters, i));
      return;
    }
    // 点击章节项本身：跳转（排除拖拽柄、改名输入框）
    if (!li || e.target.closest('.drag-handle') || e.target.closest('input')) return;
    const c = getState().chapters[Number(li.dataset.index)];
    if (!c) return;
    setActive(c.id, false);
    document.dispatchEvent(new CustomEvent('goto-chapter', { detail: { id: c.id } }));
  });
  ul.addEventListener('dblclick', (e) => {
    const t = e.target.closest('.ch-title');
    if (t) startRename(t.closest('li'), Number(t.closest('li').dataset.index));
  });

  const clearOver = () => ul.querySelectorAll('.drag-over').forEach((n) => n.classList.remove('drag-over'));
  ul.addEventListener('dragstart', (e) => {
    const li = e.target.closest('.chapter-item');
    if (!li) return;
    dragFrom = Number(li.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
    li.classList.add('dragging');
  });
  ul.addEventListener('dragover', (e) => {
    const li = e.target.closest('.chapter-item');
    if (dragFrom == null || !li) return;
    e.preventDefault();
    clearOver();
    li.classList.add('drag-over');
  });
  ul.addEventListener('drop', (e) => {
    const li = e.target.closest('.chapter-item');
    if (dragFrom == null || !li) return;
    e.preventDefault();
    const to = Number(li.dataset.index);
    const from = dragFrom;
    dragFrom = null;
    commit(moveChapter(getState().chapters, from, to));
  });
  ul.addEventListener('dragend', () => { dragFrom = null; clearOver(); ul.querySelector('.dragging')?.classList.remove('dragging'); });

  // 预览区滚动到新章节 → 高亮，并把列表项滚进可见范围
  document.addEventListener('current-chapter', (e) => setActive(e.detail && e.detail.id, true));

  subscribe((_s, key) => { if (key === 'chapters' || key === '*') render(); });
  render();
}
