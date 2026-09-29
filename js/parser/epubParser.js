// epub 解析：JSZip 解压 → container.xml → opf → 按 spine 顺序读 xhtml → [{title, content}]
import { isHeadingTag, readBlocks, readToc, resolve, dirname, readText, xml } from './epubUtils.js';

export async function parseEpub(buffer) {
  if (!window.JSZip) throw new Error('JSZip 未加载，请检查网络或 CDN');
  const zip = await window.JSZip.loadAsync(buffer);

  const container = xml(await readText(zip, 'META-INF/container.xml'));
  const opfPath = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error('epub 格式错误：找不到 opf 路径');
  const base = dirname(opfPath);
  const opf = xml(await readText(zip, opfPath));

  const manifest = new Map();
  for (const it of opf.getElementsByTagName('item')) {
    manifest.set(it.getAttribute('id'), {
      href: it.getAttribute('href') || '',
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    });
  }
  const spine = opf.getElementsByTagName('spine')[0];
  if (!spine) throw new Error('epub 格式错误：缺少 spine');
  const tocMap = await readToc(zip, manifest, spine, base);
  const hasToc = tocMap.size > 0;

  const chapters = [];
  let cur = null;
  const start = (title) => { cur = { title, blocks: [] }; chapters.push(cur); };

  for (const ref of spine.getElementsByTagName('itemref')) {
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !/x?html/.test(item.type) || item.props.includes('nav')) continue;
    const path = resolve(base, item.href);
    const blocks = await readBlocks(zip, path);
    if (!blocks.length) continue;

    const tocTitle = tocMap.get(path);
    if (tocTitle) {
      start(tocTitle);
      const f = blocks[0];   // 正文开头重复的标题去掉，避免章节名出现两次
      if (isHeadingTag(f.tag) && (f.text.includes(tocTitle) || tocTitle.includes(f.text))) blocks.shift();
      cur.blocks.push(...blocks);
    } else if (!hasToc) {    // 无目录：按 h1-h3 切章
      for (const b of blocks) {
        if (isHeadingTag(b.tag)) start(b.text);
        else { if (!cur) start('前言'); cur.blocks.push(b); }
      }
    } else {                 // 有目录但此文件不在目录中：视为上一章的续篇
      if (!cur) start(blocks.find((b) => isHeadingTag(b.tag))?.text || item.href);
      cur.blocks.push(...blocks);
    }
  }
  return chapters
    .filter((c) => c.blocks.length)
    .map((c) => ({ title: c.title, content: c.blocks.map((b) => b.text).join('\n') }));
}
