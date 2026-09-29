// file: js/fonts.js
// 字体族表：预览（fonts.css）、排版（paginator）、PDF（fontLoader / pdfBuilder）共用这一份。
// 字体文件：assets/fonts/{filePrefix}-{WeightName}.ttf
// 注意：黑体的 Normal 对应宋体的 SemiBold（切换字体族时互相映射）；黑体 Normal 的 CSS 字重按真实值 350。

export const FONT_FAMILIES = [
  {
    key: 'serif',
    cssFamily: 'Source Han Serif',
    label: '思源宋体',
    filePrefix: 'SourceHanSerifCN',
    weights: [
      { name: 'ExtraLight', css: 200, label: '特细 ExtraLight' },
      { name: 'Light',      css: 300, label: '细体 Light' },
      { name: 'Regular',    css: 400, label: '常规 Regular' },
      { name: 'Medium',     css: 500, label: '中等 Medium' },
      { name: 'SemiBold',   css: 600, label: '半粗 SemiBold' },
      { name: 'Bold',       css: 700, label: '粗体 Bold' },
      { name: 'Heavy',      css: 900, label: '特粗 Heavy' },
    ],
  },
  {
    key: 'sans',
    cssFamily: 'Source Han Sans',
    label: '思源黑体',
    filePrefix: 'SourceHanSansCN',
    weights: [
      { name: 'ExtraLight', css: 200, label: '特细 ExtraLight' },
      { name: 'Light',      css: 300, label: '细体 Light' },
      { name: 'Normal',     css: 350, label: '标准 Normal' },
      { name: 'Regular',    css: 400, label: '常规 Regular' },
      { name: 'Medium',     css: 500, label: '中等 Medium' },
      { name: 'Bold',       css: 700, label: '粗体 Bold' },
      { name: 'Heavy',      css: 900, label: '特粗 Heavy' },
    ],
  },
];

export const DEFAULT_FAMILY = 'Source Han Serif';
export const DEFAULT_WEIGHT = 'Regular';
export const FALLBACK_WEIGHT = 'Regular';

// 页眉页脚固定字体：思源黑体 Heavy（与所选正文字体无关）
// 之前是宋体 Heavy，因数字在英文上下文中被字体替换成全角字形，改黑体试
export const HEADER_FOOTER_FONT = { family: 'Source Han Sans', weight: 'Heavy' };

// 书名页 / 章节标题 / 目录标题固定字体：思源宋体 Heavy（与所选正文字体无关）
export const HEADING_FONT = { family: 'Source Han Serif', weight: 'Heavy' };

// 切换字体族时的同名映射之外的特例：宋体 SemiBold ↔ 黑体 Normal
const CROSS_MAP = {
  'Source Han Serif': { SemiBold: 'Normal' },
  'Source Han Sans': { Normal: 'SemiBold' },
};

/** 按 CSS 族名取字体族定义；未知族名回落到宋体 */
export function getFamily(cssFamily) {
  return FONT_FAMILIES.find((f) => f.cssFamily === cssFamily) || FONT_FAMILIES[0];
}

/** 某族可选的字重列表 [{name, css, label}] */
export function weightsOf(cssFamily) {
  return getFamily(cssFamily).weights;
}

/** 某族是否有该字重 */
export function hasWeight(cssFamily, weightName) {
  return weightsOf(cssFamily).some((w) => w.name === weightName);
}

/** 字重名 → CSS 数值（在指定族内查；查不到给 400） */
export function cssWeightOf(cssFamily, weightName) {
  const w = weightsOf(cssFamily).find((x) => x.name === weightName);
  return w ? w.css : 400;
}

/** 字体键（也是文件名去掉 .ttf），如 "SourceHanSansCN-Bold"。字重不存在时回落到该族 Regular */
export function fontKey(cssFamily, weightName) {
  const fam = getFamily(cssFamily);
  const name = hasWeight(cssFamily, weightName) ? weightName : FALLBACK_WEIGHT;
  return `${fam.filePrefix}-${name}`;
}

/** 该族的回落字体键（Regular） */
export function fallbackKey(cssFamily) {
  return fontKey(cssFamily, FALLBACK_WEIGHT);
}

/** 字体键 → 文件路径 */
export function fontPath(key) {
  return `assets/fonts/${key}.ttf`;
}

/** 全部字体键（14 个），用于预载或校验 */
export function allFontKeys() {
  return FONT_FAMILIES.flatMap((f) => f.weights.map((w) => `${f.filePrefix}-${w.name}`));
}

/**
 * 切换字体族时决定新字重：
 * 1) 宋体 SemiBold ↔ 黑体 Normal 互相对应
 * 2) 新族里有同名字重就保留
 * 3) 否则回落 Regular
 */
export function mapWeightOnFamilySwitch(fromFamily, weightName, toFamily) {
  if (fromFamily === toFamily) return weightName;
  const special = CROSS_MAP[fromFamily]?.[weightName];
  if (special && hasWeight(toFamily, special)) return special;
  if (hasWeight(toFamily, weightName)) return weightName;
  return FALLBACK_WEIGHT;
}

/** 预览用：该字体族+字重对应的 document.fonts.load 描述串，如 '700 16px "Source Han Sans"' */
export function fontLoadSpec(cssFamily, weightName, sizePx = 16) {
  return `${cssWeightOf(cssFamily, weightName)} ${sizePx}px "${cssFamily}"`;
}