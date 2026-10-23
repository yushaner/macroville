// 静态校验：源码里引用的 DOM id 必须在 index.html 里真实存在。
// 沙箱里没有浏览器，这是拦截「运行时空引用」最便宜的一道闸。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

const files = [
  'src/main.ts', 'src/ui/hud.ts', 'src/ui/saveDialog.ts', 'src/ui/setup.ts',
  'src/ui/controls.ts', 'src/ui/dashboard.ts', 'src/ui/knowledge.ts',
  'src/ui/map.ts', 'src/ui/modal.ts',
];

// 第一遍：把源码模板字符串里 id="xxx" 也算进「已声明」集合。
// 仪表盘、存档弹窗、开局设定这些面板都是运行时 innerHTML 生成的，
// 只扫 index.html 会满屏误报。
const srcText = {};
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  srcText[f] = fs.readFileSync(p, 'utf8');
}
for (const s of Object.values(srcText)) {
  for (const m of s.matchAll(/id="([A-Za-z0-9_-]+)"/g)) ids.add(m[1]);
  // 懒创建：el.id = 'xxx'
  for (const m of s.matchAll(/\.id\s*=\s*['"]([A-Za-z0-9_-]+)['"]/g)) ids.add(m[1]);
}

const miss = [];
for (const f of files) {
  if (!srcText[f]) { miss.push(f + ' -> 文件不存在'); continue; }
  const s = srcText[f];
  for (const m of s.matchAll(/getElementById\(\s*['"]([^'"]+)['"]/g)) {
    if (!ids.has(m[1])) miss.push(f + ' -> #' + m[1]);
  }
  for (const m of s.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_-]+)/g)) {
    if (!ids.has(m[1])) miss.push(f + ' -> query #' + m[1]);
  }
}
console.log('已声明 id 数量（index.html + 源码模板 + 懒创建）：' + ids.size);
console.log(miss.length ? 'MISSING:\n' + miss.join('\n') : 'ALL IDS OK');
process.exit(miss.length ? 1 : 0);
