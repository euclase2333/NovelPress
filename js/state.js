// file: js/state.js
// 全局状态 store：简单发布订阅
// 默认值即项目默认格式（A5 实体书排版），请勿随意更改
import { DEFAULT_FAMILY, DEFAULT_WEIGHT } from './fonts.js';

const defaults = () => ({
  page: {
    width: 148, height: 210, bleed: 3,          // mm
    marginTop: 15, marginBottom: 18,
    marginInside: 25, marginOutside: 20,
  },
  typography: {
    fontFamily: DEFAULT_FAMILY,   // 'Source Han Serif' | 'Source Han Sans'
    fontWeight: DEFAULT_WEIGHT,   // 字重名，见 fonts.js（Regular / Bold / SemiBold / Normal …）
    fontSize: 10,       // pt
    lineHeight: 1.7,    // 倍数
    paraSpacing: 0,     // pt
    indent: 2,          // 字符数
  },
  headerFooter: {
    showHeader: true, showFooter: true,           // 关闭后不占位，正文区向该侧扩展
    headerText: '', footerText: '',               // 可含 {bookTitle} 占位符
    showPageNumber: true, pageNumberStart: 1,     // pageNumberStart = 正文第一页（目录之后）的页码
    oddEvenDifferent: true,                       // 左右页不同：右页页眉为章节名
  },
  chapters: [],         // [{ id, title, content }]
  rawText: '',
  bookTitle: '',        // 用户填写的书名；为空则用导入文件名
  sourceFileName: '',   // 导入文件名（不含扩展名）
});

let state = defaults();
const listeners = new Set();

const clone = (v) => JSON.parse(JSON.stringify(v));

/** 读取整个状态（返回副本，避免外部直接修改） */
export function getState() {
  return clone(state);
}

/** 订阅变化；回调参数 (state, changedKey)。返回取消订阅函数 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(key) {
  const snapshot = getState();
  listeners.forEach((fn) => fn(snapshot, key));
}

/** 合并更新某个对象分组：update('page', { width: 150 }) */
export function update(key, patch) {
  if (!(key in state) || typeof state[key] !== 'object' || Array.isArray(state[key])) {
    throw new Error(`state.update: "${key}" 不是可合并的分组`);
  }
  state[key] = { ...state[key], ...patch };
  emit(key);
}

/** 整体替换某个字段：set('chapters', [...]) / set('rawText', '...') / set('bookTitle', '...') */
export function set(key, value) {
  if (!(key in state)) throw new Error(`state.set: 未知字段 "${key}"`);
  state[key] = value;
  emit(key);
}

/** 恢复默认值 */
export function reset() {
  state = defaults();
  emit('*');
}

/** 仅恢复格式（页面/排版/页眉页脚），保留文本、章节与书名 */
export function resetFormat() {
  const d = defaults();
  ['page', 'typography', 'headerFooter'].forEach((k) => { state[k] = d[k]; emit(k); });
}

/** 最终使用的书名：书名框非空用书名框，否则用导入文件名，都没有则为空字符串 */
export function resolveBookTitle(s = state) {
  const t = (s.bookTitle || '').trim();
  if (t) return t;
  return (s.sourceFileName || '').trim();
}
