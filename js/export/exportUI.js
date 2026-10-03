// file: js/export/exportUI.js
// 导出按钮：校验 → 提示用到的字体 → 加载字体 → 生成并下载 PDF
import { getState, resolveBookTitle } from '../state.js';
import { paginate } from '../layout/paginator.js';
import { FONT_FAMILIES } from '../fonts.js';
import { buildPdf, usedFontKeys } from './pdfBuilder.js';
import { loadFont } from './fontLoader.js';

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 字体键 → 可读名称，如 "SourceHanSansCN-Bold" → "思源黑体 Bold" */
function keyLabel(key) {
  const fam = FONT_FAMILIES.find((f) => key.startsWith(`${f.filePrefix}-`));
  return fam ? `${fam.label} ${key.slice(fam.filePrefix.length + 1)}` : key;
}

/** 文件名：书名（或导入文件名）去掉系统不允许的字符；都没有时用 novelpress */
function pdfFileName(title) {
  const clean = (title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${clean || 'novelpress'}.pdf`;
}

export function mountExport(btn) {
  btn.addEventListener('click', async () => {
    const s = getState();
    if (!s.chapters.length || s.chapters.every((c) => !c.content.trim())) {
      alert('没有可导出的内容：请先导入文本并识别章节。');
      return;
    }
    const bookTitle = resolveBookTitle(s);
    const pages = paginate(s.chapters, s.page, s.typography, s.headerFooter, { bookTitle });
    if (!pages.length) { alert('页面参数无效：正文区放不下一行文字，请检查页边距、字号。'); return; }

    const keys = usedFontKeys(pages);
    const msg = `即将导出 ${pages.length} 页 PDF（含 ${s.page.bleed}mm 出血）。\n本次使用并将嵌入的字体：${keys.map(keyLabel).join('、')}\n继续导出？`;
    if (!confirm(msg)) return;

    const label = btn.textContent;
    btn.disabled = true;
    try {
      const fontBytes = {};
      for (const k of keys) { btn.textContent = `加载字体 ${keyLabel(k)}…`; fontBytes[k] = await loadFont(k); }
      btn.textContent = '生成中…';
      const bytes = await buildPdf({
        pages, page: s.page, fontBytes, title: bookTitle || 'NovelPress',
        onProgress: (i, n) => { btn.textContent = `生成中 ${i}/${n}`; },
      });
      download(bytes, pdfFileName(bookTitle));
    } catch (e) {
      console.error(e);
      alert(`导出失败：${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
