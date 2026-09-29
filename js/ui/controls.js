// file: js/ui/controls.js
// 通用控件生成器：每个控件返回 { el, set(v) }，set 用于 state 变化后回填（用户正在输入的框不覆盖）
// selectControl 额外返回 setOptions(options, cur)：选项随其他字段变化时刷新
const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const attrs = (n, o) => Object.entries(o).forEach(([k, v]) => n.setAttribute(k, v));

/** 数字控件：slider=true 时为 滑块 + 数字框 联动 */
export function numberControl({ label, min, max, step = 1, unit = '', value, slider = true, onChange }) {
  const el = h('div', 'ctl');
  const head = h('div', 'ctl-head');
  const num = h('input', 'input ctl-num');
  attrs(num, { type: 'number', min, max, step });
  head.append(h('span', 'ctl-label', label), num, h('span', 'ctl-unit', unit));
  el.append(head);
  let range = null;
  if (slider) {
    range = h('input', 'ctl-range');
    attrs(range, { type: 'range', min, max, step });
    el.append(range);
  }
  let current = value;
  const emit = (v) => { if (v !== current) { current = v; onChange(v); } };
  const set = (v) => {
    current = v;
    if (document.activeElement !== num) num.value = v;
    if (range) range.value = v;
  };
  num.addEventListener('input', () => {              // 输入过程中只接受范围内的有效值
    const v = parseFloat(num.value);
    if (Number.isFinite(v) && v >= min && v <= max) { if (range) range.value = v; emit(v); }
  });
  num.addEventListener('change', () => {             // 失焦/回车：夹到范围内
    let v = parseFloat(num.value);
    if (!Number.isFinite(v)) v = current;
    v = Math.min(max, Math.max(min, v));
    num.value = v;
    if (range) range.value = v;
    emit(v);
  });
  if (range) range.addEventListener('input', () => { const v = parseFloat(range.value); num.value = v; emit(v); });
  set(value);
  return { el, set };
}

export function textControl({ label, value, placeholder = '', onChange }) {
  const el = h('div', 'ctl');
  const input = h('input', 'input');
  input.type = 'text';
  input.placeholder = placeholder;
  el.append(h('div', 'ctl-label', label), input);
  input.addEventListener('input', () => onChange(input.value));
  const set = (v) => { if (document.activeElement !== input) input.value = v; };
  set(value);
  return { el, set };
}

export function checkControl({ label, value, onChange }) {
  const el = h('label', 'ctl ctl-check');
  const box = h('input');
  box.type = 'checkbox';
  el.append(box, h('span', '', label));
  box.addEventListener('change', () => onChange(box.checked));
  const set = (v) => { box.checked = !!v; };
  set(value);
  return { el, set };
}

export function selectControl({ label, options, value, onChange }) {
  const el = h('div', 'ctl');
  const sel = h('select', 'input');
  el.append(h('div', 'ctl-label', label), sel);
  let opts = options;
  const sig = (list) => list.map((o) => o.value).join('|');
  const fill = (cur) => {
    sel.replaceChildren();
    const list = opts.some((o) => o.value === cur) ? opts : [...opts, { value: cur, label: cur }];
    for (const o of list) { const op = h('option', '', o.label); op.value = o.value; sel.append(op); }
    sel.value = cur;
  };
  sel.addEventListener('change', () => onChange(sel.value));
  fill(value);
  return {
    el,
    set: (v) => { if (sel.value !== v) fill(v); },
    /** 换选项列表（如字体族变化后的字重列表）；列表没变且当前值一致则不重建，避免打断下拉 */
    setOptions: (next, cur) => {
      if (sig(next) === sig(opts)) { if (sel.value !== cur) fill(cur); return; }
      opts = next;
      fill(cur);
    },
  };
}

export function section(title, children) {
  const s = h('section', 'fmt-section');
  s.append(h('div', 'section-title', title), ...children);
  return s;
}
