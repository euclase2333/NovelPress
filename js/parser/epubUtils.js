// epub 解析辅助：路径处理、XML/XHTML 读取、目录（nav / ncx）、正文块提取
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article', 'pre', 'tr']);
const SKIP = new Set(['script', 'style', 'svg', 'head']);

export const isHeadingTag = (t) => /^h[1-3]$/.test(t);
export const dirname = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');

/** 相对路径解析，并去掉 #fragment、解码 %XX */
export function resolve(base, href) {
  const parts = (base + decodeURIComponent(href.split('#')[0])).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

export const xml = (s, type = 'application/xml') => new DOMParser().parseFromString(s, type);

export async function readText(zip, path) {
  const f = zip.file(path);
  if (!f) throw new Error(`epub 缺少文件：${path}`);
  return f.async('string');
}

function collect(node, out) {
  for (const el of node.children) {
    const tag = el.localName.toLowerCase();
    if (SKIP.has(tag)) continue;
    const hasBlockChild = [...el.children].some((c) => BLOCK.has(c.localName.toLowerCase()));
    if (BLOCK.has(tag) && !hasBlockChild) {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      if (text) out.push({ tag, text });
    } else collect(el, out);
  }
}

/** 读取一个 xhtml，返回 [{tag, text}]（块级文本） */
export async function readBlocks(zip, path) {
  const src = await readText(zip, path);
  let doc = xml(src, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) doc = xml(src, 'text/html');
  const root = doc.body || doc.documentElement;
  const out = [];
  collect(root, out);
  if (!out.length) {
    for (const line of (root.textContent || '').split('\n')) {
      const t = line.trim();
      if (t) out.push({ tag: 'p', text: t });
    }
  }
  return out;
}

/** 读取目录，返回 Map<文件路径, 标题>（同一文件只取第一个条目） */
export async function readToc(zip, manifest, spine, base) {
  const map = new Map();
  const add = (tocDir, href, title) => {
    if (!href || !title) return;
    const path = resolve(tocDir, href);
    if (!map.has(path)) map.set(path, title.replace(/\s+/g, ' ').trim());
  };
  try {
    const navItem = [...manifest.values()].find((m) => m.props.split(/\s+/).includes('nav'));
    if (navItem) {                                            // EPUB3 nav
      const navPath = resolve(base, navItem.href);
      const doc = xml(await readText(zip, navPath), 'text/html');
      const navs = [...doc.querySelectorAll('nav')];
      const nav = navs.find((n) => [...n.attributes].some((a) => a.name.endsWith('type') && a.value.includes('toc'))) || navs[0];
      nav?.querySelectorAll('a').forEach((a) => add(dirname(navPath), a.getAttribute('href'), a.textContent));
    }
    if (!map.size) {                                          // EPUB2 ncx
      const ncx = manifest.get(spine.getAttribute('toc')) || [...manifest.values()].find((m) => m.type.includes('dtbncx'));
      if (ncx) {
        const ncxPath = resolve(base, ncx.href);
        const doc = xml(await readText(zip, ncxPath));
        for (const np of doc.getElementsByTagName('navPoint')) {
          add(dirname(ncxPath), np.getElementsByTagName('content')[0]?.getAttribute('src'), np.getElementsByTagName('text')[0]?.textContent);
        }
      }
    }
  } catch (e) {
    console.warn('[epub] 目录解析失败，改用标题切章', e);
  }
  return map;
}
