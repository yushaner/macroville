// 把 src/data/glossary.ts 的 TERMS 抽成紧凑 JSON，注入 preview.html 的占位块。
// preview.html 是 file:// 直接打开的静态页，不能 fetch 本地 JSON，只能内联。
// 改了 glossary.ts 之后必须重跑：npm run gen:preview
const path = require('path');
const esbuild = require('esbuild');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW = path.join(ROOT, 'preview.html');

(async () => {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/data/glossary.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
  });
  const code = res.outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  const terms = mod.exports.TERMS;
  const termTier = mod.exports.termTier;
  if (!Array.isArray(terms) || !terms.length) throw new Error('TERMS 抽取失败');

  // 字段顺序必须与 preview.html 里的解构一致：
  // key, name, chapter, req(解锁条件，纯数据), tier(第几轮开放), def, effect, related, unlocks
  const slim = terms.map((t) => [
    t.key, t.name, t.chapter, t.req, termTier ? termTier(t.key) : 1,
    t.def, t.effect,
    t.related, t.unlocks ? [t.unlocks.levers || [], t.unlocks.metrics || []] : null,
  ]);
  const json = JSON.stringify(slim);

  // 题库同样内联：preview.html 无法 fetch 本地 JSON
  const qres = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/data/quiz.ts')],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const qmod = { exports: {} };
  new Function('module', 'exports', qres.outputFiles[0].text)(qmod, qmod.exports);
  const quizzes = qmod.exports.QUIZZES;
  if (!Array.isArray(quizzes) || !quizzes.length) throw new Error('QUIZZES 抽取失败');
  // 字段顺序必须与 preview.html 里的解构一致：key, type, stem, options, answer, explain, source
  const qslim = quizzes.map((q) => [q.key, q.type, q.stem, q.options, q.answer, q.explain, q.source]);
  const qjson = JSON.stringify(qslim);

  let html = fs.readFileSync(PREVIEW, 'utf8');

  const inject = (id, json2) => {
    const open = `<script id="${id}" type="application/json">`;
    const start = html.indexOf(open);
    if (start < 0) throw new Error(`preview.html 里找不到 ${id} 占位块`);
    const end = html.indexOf('</script>', start);
    html = html.slice(0, start + open.length) + json2 + html.slice(end);
  };
  inject('terms-data', json);
  inject('quiz-data', qjson);
  fs.writeFileSync(PREVIEW, html, 'utf8');

  const byCh = {};
  for (const t of terms) byCh[t.chapter] = (byCh[t.chapter] || 0) + 1;
  console.log(`OK terms=${terms.length} jsonBytes=${json.length} chapters=${JSON.stringify(byCh)}`);
  console.log(`OK quizzes=${quizzes.length} jsonBytes=${qjson.length}`);
})().catch((e) => { console.error('FAIL: ' + e.message); process.exit(1); });
