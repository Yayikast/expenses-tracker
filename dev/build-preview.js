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
  .replace('<link rel="stylesheet" href="styles.css?v=5">', () => `<style>${read('docs', 'styles.css')}</style>`)
  .replace('<script src="config.js?v=5"></script>', () => mock)
  .replace('<script src="app.js?v=5"></script>', () => `<script>${read('docs', 'app.js')}</script>`)
  .replace(/(src|href)="(icon[^"]*)"/g, (m, a, f) => `${a}="../../docs/${f}"`);
if (process.argv.includes('--local-libs')) {
  // offline preview: put the two libraries in the page so app.js finds them already loaded
  const libs = ['chart.js/dist/chart.umd.js', 'jsqr/dist/jsQR.js'].map(f => `<script>${fs.readFileSync(path.join(NM, f), 'utf8')}</script>`).join('\n');
  html = html.replace(/<!-- Chart\.js and jsQR are loaded by app\.js only when needed[^>]*-->/, () => libs);
  html = html.replace(/<link rel="preload" as="script"[^>]*>/, '');
}
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('wrote', path.join(out, 'index.html'), Math.round(html.length / 1024) + 'KB');
