// node dev/build-preview.js  -> dev/out/index.html
// Opens the app with a fake back-end (no Google needed), for trying the screens.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(__dirname, 'out');
fs.mkdirSync(out, { recursive: true });
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const fx = f => read('tests', 'fixtures', f);
const NM = process.env.NODE_MODULES || path.join(root, 'node_modules');

let html = read('docs', 'index.html');
const fixtures = { krungsri: fx('krungsri.tesseract.txt'), bangkok: fx('bangkok.drive.txt'), paotang: fx('paotang.drive.txt') };
const configFile = fs.existsSync(path.join(root, 'src', 'config.gs')) ? 'src/config.gs' : 'setup/config.example.gs';
const mock = [read(...configFile.split('/')), read('src', 'parsers.gs')].map(c => `<script>${c}</script>`).join('\n') +
  `<script>window.__fixtures=${JSON.stringify(fixtures)}</script><script>${read('dev', 'mock.js')}</script>`;

html = html
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${read('docs', 'styles.css')}</style>`)
  .replace('<script src="config.js"></script>', () => mock)
  .replace('<script src="app.js"></script>', () => `<script>${read('docs', 'app.js')}</script>`)
  .replace(/(src|href)="(icon[^"]*)"/g, (m, a, f) => `${a}="../../docs/${f}"`);
if (process.argv.includes('--local-libs')) {
  html = html
    .replace(/<script src="https:\/\/cdnjs[^"]+chart\.umd\.min\.js"><\/script>/, () => `<script>${fs.readFileSync(path.join(NM, 'chart.js/dist/chart.umd.js'), 'utf8')}</script>`)
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jsqr[^"]+"><\/script>/, () => `<script>${fs.readFileSync(path.join(NM, 'jsqr/dist/jsQR.js'), 'utf8')}</script>`);
}
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('wrote', path.join(out, 'index.html'), Math.round(html.length / 1024) + 'KB');
