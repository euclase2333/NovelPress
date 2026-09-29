// 入口：初始化各模块、绑定事件
import { mountInputPanel } from './ui/inputPanel.js';
import { mountFormatPanel } from './ui/formatPanel.js';
import { mountPreview } from './preview/preview.js';

const $ = (id) => document.getElementById(id);

function init() {
  mountInputPanel($('input-body'));
  mountPreview($('preview-title'), $('preview-body'));
  mountFormatPanel($('format-body'));
  console.log('[NovelPress] 阶段 4 初始化完成');
}

init();
