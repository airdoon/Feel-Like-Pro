const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('index.html works as a local file preview with styles and navigation', async () => {
  const errors = [];
  const dom = await JSDOM.fromFile(path.join(__dirname, 'public', 'index.html'), {
    resources: 'usable', runScripts: 'dangerously',
    beforeParse(window) { window.scrollTo = () => {}; }
  });
  dom.window.addEventListener('error', event => errors.push(event.message));
  try {
    await new Promise((resolve, reject) => {
      if (dom.window.document.readyState === 'complete') return resolve();
      const timeout = setTimeout(() => reject(new Error('Page did not load')), 4000);
      dom.window.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
    });
    await new Promise(resolve => setTimeout(resolve, 30));
    const document = dom.window.document;
    assert.equal(dom.window.location.protocol, 'file:');
    assert.ok(document.styleSheets.length > 0, 'Local stylesheet loaded');
    assert.match(document.querySelector('#app').textContent, /Локальный предпросмотр/);
    assert.match(document.querySelector('#app').textContent, /FEEL LIKE/);
    dom.window.location.hash = '#tournaments';
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.match(document.querySelector('#app').textContent, /Пример турнира/);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
