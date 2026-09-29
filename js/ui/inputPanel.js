// file: js/ui/inputPanel.js
// 输入区：书名、文本粘贴、导入文件、自动识别章节、章节列表
import { getState, set, subscribe } from '../state.js';
import { parseTxt } from '../parser/txtParser.js';
import { parseEpub } from '../parser/epubParser.js';
import { withIds } from '../layout/chapter.js';
import { mountChapterList } from './chapterList.js';

const TEMPLATE = `
  <div class="section-title">书名</div>
  <input type="text" class="input title-input" id="book-title" placeholder="不填则使用导入文件名">
  <textarea class="input-textarea" id="raw-text" placeholder="在此粘贴小说文本，或导入 .txt / .epub"></textarea>
  <div class="btn-row">
    <button class="btn" data-act="import">导入文件</button>
    <button class="btn btn-primary" data-act="detect">自动识别章节</button>
  </div>
  <button class="btn btn-ghost" data-act="marker">在光标处插入分章标记</button>
  <input type="file" id="file-input" accept=".txt,.epub" hidden>
  <div class="status" id="input-status"></div>
  <div class="section-title" id="chapter-count">章节</div>
  <ul class="chapter-list" id="chapter-list"></ul>`;

async function readTxt(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('gb18030').decode(buf); }   // 中文老 txt 常见 GBK
}

const baseName = (name) => name.replace(/\.[^.]+$/, '');       // 去扩展名

export function mountInputPanel(root) {
  root.innerHTML = TEMPLATE;
  const $ = (s) => root.querySelector(s);
  const ta = $('#raw-text');
  const titleInput = $('#book-title');
  const fileInput = $('#file-input');
  const statusEl = $('#input-status');

  const status = (msg, isError = false) => {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  };

  /** 书名框的占位提示：显示当前将使用的默认值（导入文件名） */
  const updatePlaceholder = (s) => {
    titleInput.placeholder = s.sourceFileName ? `默认：${s.sourceFileName}` : '不填则使用导入文件名';
  };

  function detect() {
    if (!ta.value.trim()) return status('文本为空，无法识别章节', true);
    const list = withIds(parseTxt(ta.value));
    set('chapters', list);
    status(`已识别 ${list.length} 章`);
  }

  async function importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      status(`正在读取 ${file.name}…`);
      if (ext === 'txt') {
        const text = await readTxt(file);
        set('sourceFileName', baseName(file.name));
        set('rawText', text);
        detect();
      } else if (ext === 'epub') {
        const list = await parseEpub(await file.arrayBuffer());
        if (!list.length) throw new Error('未能从 epub 中提取到正文');
        set('sourceFileName', baseName(file.name));
        set('rawText', list.map((c) => `${c.title}\n\n${c.content}`).join('\n\n'));
        set('chapters', withIds(list));
        status(`已导入 ${file.name}，共 ${list.length} 章`);
      } else throw new Error('仅支持 .txt / .epub 文件');
    } catch (e) {
      console.error(e);
      status(`导入失败：${e.message}`, true);
    }
  }

  function insertMarker() {
    const n = getState().chapters.length + 1;
    const mark = `\n第${n}章 新章节\n`;
    const pos = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, pos) + mark + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = pos + mark.length;
    set('rawText', ta.value);
    status('已插入标记，点「自动识别章节」重新切分');
  }

  ta.addEventListener('input', () => set('rawText', ta.value));
  titleInput.addEventListener('input', () => set('bookTitle', titleInput.value));
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) importFile(fileInput.files[0]);
    fileInput.value = '';
  });
  root.addEventListener('click', (e) => {
    const act = e.target.closest('button[data-act]')?.dataset.act;
    if (act === 'import') fileInput.click();
    if (act === 'detect') detect();
    if (act === 'marker') insertMarker();
  });

  mountChapterList($('#chapter-list'));
  updatePlaceholder(getState());
  subscribe((s, key) => {
    if ((key === 'rawText' || key === '*') && ta.value !== s.rawText) ta.value = s.rawText;
    if (key === 'chapters' || key === '*') $('#chapter-count').textContent = `章节（${s.chapters.length}）`;
    if ((key === 'bookTitle' || key === '*') && document.activeElement !== titleInput) titleInput.value = s.bookTitle;
    if (key === 'sourceFileName' || key === '*') updatePlaceholder(s);
  });
}
