// file: js/export/fontLoader.js
// 按字体键加载字体文件（assets/fonts/{SourceHanSerifCN|SourceHanSansCN}-{Weight}.ttf），带缓存。
// 字体键即文件名去掉 .ttf，如 "SourceHanSansCN-Bold"，由 fonts.js 的 fontKey(family, weight) 生成。
// 非 Regular 字重加载失败时，回退到同一字体族的 Regular（返回同一个 Uint8Array 引用，pdfBuilder 会据此复用，不重复嵌入）
import { FONT_FAMILIES, allFontKeys, fontPath, fallbackKey } from '../fonts.js';

const cache = new Map();
const VALID_KEYS = new Set(allFontKeys());

/** 校验文件头：TTF(00 01 00 00 / true)、OTF(OTTO)、TTC(ttcf)。防止服务器对缺失文件返回 HTML 页面 */
function looksLikeFont(b) {
  if (b.length < 4) return false;
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) return true;
  return ['true', 'OTTO', 'ttcf'].includes(String.fromCharCode(b[0], b[1], b[2], b[3]));
}

/** 字体键 → 所属字体族的 CSS 族名（用于找到该族的 Regular 作回退） */
function familyOfKey(key) {
  const fam = FONT_FAMILIES.find((f) => key.startsWith(`${f.filePrefix}-`));
  return fam ? fam.cssFamily : FONT_FAMILIES[0].cssFamily;
}

async function fetchFont(key) {
  const url = fontPath(key);
  let res;
  try { res = await fetch(url); }
  catch { throw new Error(`无法读取字体 ${url}。请用本地服务器打开页面（如 python -m http.server），不要直接双击 index.html`); }
  if (!res.ok) throw new Error(`字体文件不存在：${url}（HTTP ${res.status}）`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!looksLikeFont(bytes)) throw new Error(`不是有效的字体文件：${url}`);
  console.log(`[NovelPress] 字体 ${key} ← ${url}（${(bytes.length / 1048576).toFixed(1)} MB）`);
  return bytes;
}

/** 加载一个字体键对应的字体文件。键不在 14 个合法字体之内时，按其族回落到 Regular */
export async function loadFont(key) {
  const reg = fallbackKey(familyOfKey(key || ''));
  const k = VALID_KEYS.has(key) ? key : reg;
  if (cache.has(k)) return cache.get(k);
  try {
    const bytes = await fetchFont(k);
    cache.set(k, bytes);
    return bytes;
  } catch (e) {
    if (k === reg) throw e;                                   // 该族 Regular 都没有就无法继续
    console.warn(`[NovelPress] 字体 ${k} 加载失败（${e.message}），回退到 ${reg}`);
    const bytes = await loadFont(reg);
    cache.set(k, bytes);
    return bytes;
  }
}
