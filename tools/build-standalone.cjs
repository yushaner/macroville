// 把 vite 的构建产物内联成「一个 HTML 文件」。
// 目的：让不装 Node、不懂命令行的玩家，下载后双击就能在浏览器里玩（file:// 直接打开）。
//
// 关键点：
// 1. dist/index.html 用的是相对路径 + type="module"，直接双击会因为 file:// 的
//    模块跨域限制加载不到 assets/*.js，所以必须内联。
// 2. 内联的 JS 里若出现 "</script" 会提前闭合标签，需要转义。
// 3. 产物不依赖任何外部请求（chart.js 已打进 bundle），断网也能玩。

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('dist/index.html 不存在，请先运行 npm run build');
  process.exit(1);
}

const assetsDir = path.join(dist, 'assets');
const jsName = fs.readdirSync(assetsDir).find((f) => f.endsWith('.js'));
const cssName = fs.readdirSync(assetsDir).find((f) => f.endsWith('.css'));
if (!jsName) {
  console.error('dist/assets 里没有 js 产物');
  process.exit(1);
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
let js = fs.readFileSync(path.join(assetsDir, jsName), 'utf8');
const css = cssName ? fs.readFileSync(path.join(assetsDir, cssName), 'utf8') : '';

// 内联脚本里出现 </script 会提前闭合 <script> 标签
js = js.replace(/<\/script/gi, '<\\/script');

const inlined = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`)
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);

if (inlined.includes('src="./assets/') || inlined.includes('href="./assets/')) {
  console.error('内联失败：产物里仍引用外部 assets');
  process.exit(1);
}

const releaseDir = path.join(root, 'release');
fs.mkdirSync(releaseDir, { recursive: true });
const outName = `MacroVille-v${pkg.version}-offline.html`;
const outPath = path.join(releaseDir, outName);
fs.writeFileSync(outPath, inlined, 'utf8');

const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
console.log(`已生成单文件试玩包：release/${outName}（${kb} KB）`);
console.log('用法：双击用浏览器打开即可游玩，无需联网、无需安装任何东西。');
