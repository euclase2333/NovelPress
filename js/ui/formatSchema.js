// file: js/ui/formatSchema.js
// 格式面板的控件定义（数据驱动）：group 对应 state 分组，key 对应字段
// select 的 optionsFn(groupState) 用于选项随其他字段变化（字重随字体族刷新）
import { FONT_FAMILIES, weightsOf } from '../fonts.js';

const FONTS = FONT_FAMILIES.map((f) => ({ value: f.cssFamily, label: f.label }));
const weightOptions = (typo) => weightsOf(typo.fontFamily).map((w) => ({ value: w.name, label: w.label }));

export const SCHEMA = [
  { title: '页面', group: 'page', fields: [
    { key: 'width', label: '宽度', type: 'number', min: 100, max: 300, step: 1, unit: 'mm' },
    { key: 'height', label: '高度', type: 'number', min: 100, max: 400, step: 1, unit: 'mm' },
    { key: 'bleed', label: '出血', type: 'number', min: 0, max: 10, step: 0.5, unit: 'mm' },
    { key: 'marginTop', label: '上边距', type: 'number', min: 5, max: 60, step: 0.5, unit: 'mm' },
    { key: 'marginBottom', label: '下边距', type: 'number', min: 5, max: 60, step: 0.5, unit: 'mm' },
    { key: 'marginInside', label: '内侧边距（装订侧）', type: 'number', min: 5, max: 60, step: 0.5, unit: 'mm' },
    { key: 'marginOutside', label: '外侧边距', type: 'number', min: 5, max: 60, step: 0.5, unit: 'mm' },
  ] },
  { title: '排版', group: 'typography', fields: [
    { key: 'fontFamily', label: '字体', type: 'select', options: FONTS },
    { key: 'fontWeight', label: '字重', type: 'select', optionsFn: weightOptions },
    { key: 'fontSize', label: '字号', type: 'number', min: 6, max: 24, step: 0.5, unit: 'pt' },
    { key: 'lineHeight', label: '行距', type: 'number', min: 1, max: 3, step: 0.05, unit: '倍' },
    { key: 'paraSpacing', label: '段间距', type: 'number', min: 0, max: 30, step: 0.5, unit: 'pt' },
    { key: 'indent', label: '首行缩进', type: 'number', min: 0, max: 4, step: 0.5, unit: '字' },
  ] },
  { title: '页眉页脚', group: 'headerFooter', fields: [
    { key: 'showHeader', label: '显示页眉', type: 'check' },
    { key: 'showFooter', label: '显示页脚', type: 'check' },
    { key: 'headerText', label: '页眉文字（可用 {bookTitle} 代表书名）', type: 'text', placeholder: '如 {bookTitle}' },
    { key: 'footerText', label: '页脚文字', type: 'text' },
    { key: 'showPageNumber', label: '显示页码', type: 'check' },
    { key: 'pageNumberStart', label: '页码起始（正文第一页）', type: 'number', min: -99, max: 9999, step: 1, slider: false },
    { key: 'oddEvenDifferent', label: '左右页不同（右页页眉为章节名）', type: 'check' },
  ] },
];
