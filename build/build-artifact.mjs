/*
 * Gera a versão "artifact" (arquivo único, hospedada no Claude) a partir da MESMA
 * fonte do site: public/index.html (marcação) + styles.css + api-claude.js + app.js,
 * com as imagens embutidas em base64.
 *
 *   npm run build:artifact   →  dist/parcerias-artifact.html
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = p => path.join(root, 'public', p);
const read = p => fs.readFileSync(pub(p), 'utf8');
const dataURI = p => 'data:image/png;base64,' + fs.readFileSync(pub(p)).toString('base64');

const html = read('index.html');
const markup = html.match(/<!-- BEGIN APP MARKUP[\s\S]*?-->([\s\S]*?)<!-- END APP MARKUP -->/)[1]
  .replace(/src="img\/logo\.png"/g, `src="${dataURI('img/logo.png')}"`);
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const css = read('styles.css');
const js = (read('api-claude.js') + '\n' + read('app.js')).replace(/src="img\/mono\.png"/g, `src="${dataURI('img/mono.png')}"`);

const out = `<title>Parcerias Costa de Araújo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
${fonts}
<style>
${css}</style>
${markup.trim()}
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'parcerias-artifact.html'), out);
console.log('Gerado dist/parcerias-artifact.html (' + Math.round(out.length / 1024) + ' KB)');
