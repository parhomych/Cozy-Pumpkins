import fs from 'node:fs';

const html = fs.readFileSync('scratch/live_admin_dom.html', 'utf8');
const idx = html.indexOf('witch-assistant');
console.log('Snippet around witch-assistant:');
console.log(html.slice(Math.max(0, idx - 100), idx + 300));
