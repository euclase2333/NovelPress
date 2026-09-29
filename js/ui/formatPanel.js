// file: js/ui/formatPanel.js
// 格式选项面板：由 SCHEMA 生成控件；控件改动 → 更新 state（预览端 200ms 防抖重排）
import { getState, update, subscribe, resetFormat } from '../state.js';
import { computeGeometry } from '../layout/paginator.js';
import { PT_MM } from '../layout/textMetrics.js';
import { mapWeightOnFamilySwitch } from '../fonts.js';
import { numberControl, textControl, checkControl, selectControl, section } from './controls.js';
import { SCHEMA } from './formatSchema.js';

const BUILDERS = {
  number: numberControl,
  text: textControl,
  check: checkControl,
  select: selectControl,
};

export function mountFormatPanel(root) {
  const state = getState();
  const bound = [];   // { group, key, ctl, field }

  /** 控件改动 → state。切换字体族时，字重同步映射（SemiBold ↔ Normal，其余同名保留，没有则 Regular），一次更新 */
  function commit(group, key, v) {
    if (group === 'typography' && key === 'fontFamily') {
      const cur = getState().typography;
      update('typography', { fontFamily: v, fontWeight: mapWeightOnFamilySwitch(cur.fontFamily, cur.fontWeight, v) });
      return;
    }
    update(group, { [key]: v });
  }

  const sections = SCHEMA.map((sec) => {
    const nodes = sec.fields.map((f) => {
      const cfg = { ...f, value: state[sec.group][f.key], onChange: (v) => commit(sec.group, f.key, v) };
      if (f.optionsFn) cfg.options = f.optionsFn(state[sec.group]);
      const ctl = BUILDERS[f.type](cfg);
      bound.push({ group: sec.group, key: f.key, ctl, field: f });
      return ctl.el;
    });
    return section(sec.title, nodes);
  });

  const info = document.createElement('div');
  info.className = 'fmt-info';
  const reset = document.createElement('button');
  reset.className = 'btn btn-ghost';
  reset.textContent = '恢复默认格式（A5）';
  reset.addEventListener('click', () => { if (confirm('将页面、排版、页眉页脚恢复为默认值？（章节内容和书名不受影响）')) resetFormat(); });
  root.replaceChildren(...sections, info, reset);

  function refresh(s) {
    bound.forEach(({ group, key, ctl, field }) => {
      if (field.optionsFn) ctl.setOptions(field.optionsFn(s[group]), s[group][key]);   // 字重选项随字体族刷新
      else ctl.set(s[group][key]);
    });
    const g = computeGeometry(s.page, s.typography, s.headerFooter);
    const cpl = Math.floor(g.contentW / (g.size * PT_MM));
    if (g.contentW <= 0 || g.bodyH < g.lh) { info.textContent = '参数无效：正文区放不下一行文字'; return; }
    const rows = Math.floor(g.bodyH / g.lh);
    const warn = cpl < 25 || cpl > 35 ? '（建议 25–35 字）' : '';
    info.textContent = `每行约 ${cpl} 字${warn} · 每页约 ${rows} 行 · 正文区 ${g.contentW.toFixed(1)}×${g.bodyH.toFixed(1)} mm`;
  }
  subscribe((s, key) => { if (key === 'page' || key === 'typography' || key === 'headerFooter' || key === '*') refresh(s); });
  refresh(state);
}
