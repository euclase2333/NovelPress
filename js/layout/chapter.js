// 章节数据操作：纯函数，均返回新数组，不修改入参
let seq = 0;
export const newId = () => `ch_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** 给解析结果 [{title, content}] 补上 id */
export const withIds = (list) => list.map((c) => ({ id: newId(), title: c.title, content: c.content }));

export function moveChapter(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const a = list.slice();
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export function insertAfter(list, index, title = '新章节', content = '') {
  const a = list.slice();
  a.splice(index + 1, 0, { id: newId(), title, content });
  return a;
}

export const removeAt = (list, index) => list.filter((_, i) => i !== index);

export const renameAt = (list, index, title) =>
  list.map((c, i) => (i === index ? { ...c, title } : c));
