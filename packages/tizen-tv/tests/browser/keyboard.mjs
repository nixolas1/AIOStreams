#!/usr/bin/env node
// Exercise native text deletion through the real shared field/input handlers.
import assert from 'node:assert/strict';
import { createServer } from '../../tools/devserver.mjs';
import { findPlaywright, findChromium } from './runtime.mjs';

const pw = findPlaywright();
const exe = findChromium();
assert.ok(pw && exe, 'Playwright and Chromium are required for keyboard regression tests');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => !document.getElementById('splash'));
  for (const type of ['text', 'search', 'password']) {
    await page.evaluate(async type => {
      const { createField } = await import('/js/ui/keyboard.js');
      const { setHandler } = await import('/js/input.js');
      window.actions = [];
      window.done = 0;
      window.cancelled = 0;
      window.field = createField({ type, value: 'example239:3000',
        onDone: () => window.done++, onCancel: () => window.cancelled++ });
      document.body.appendChild(window.field.el);
      setHandler(action => {
        window.actions.push(action);
        window.field.handleKey(action);
      });
      window.field.setFocused(true);
      window.field.begin();
      window.field.input.setSelectionRange(10, 10);
    }, type);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('46');
    assert.deepEqual(await page.evaluate(() => ({ value: field.value(), editing: field.isEditing(),
      focused: document.activeElement === field.input, actions, cancelled })),
    { value: 'example46:3000', editing: true, focused: true, actions: [], cancelled: 0 },
    type + ': deletion must edit text without cancelling or navigating');

    // Selection deletion, including deleting all text, must keep editing active.
    await page.evaluate(() => field.input.select());
    await page.keyboard.press('Backspace');
    assert.equal(await page.evaluate(() => field.value()), '');
    await page.keyboard.press('Backspace');
    assert.equal(await page.evaluate(() => field.isEditing()), true);
    await page.keyboard.type('new value');
    // Samsung remote Return must still cancel and restore the original value.
    await page.evaluate(() => field.input.dispatchEvent(new KeyboardEvent('keydown',
      { keyCode: 10009, bubbles: true, cancelable: true })));
    assert.deepEqual(await page.evaluate(() => [field.isEditing(), field.value(), cancelled]),
      [false, 'example239:3000', 1]);
    await page.evaluate(() => { field.begin(); field.setValue('committed'); });
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => [field.isEditing(), field.value(), done]),
      [false, 'committed', 1]);
    await page.evaluate(() => { actions.length = 0; field.el.remove(); });
    await page.keyboard.press('Backspace');
    assert.deepEqual(await page.evaluate(() => actions), ['back'], 'desktop navigation still works');
  }
  console.log('keyboard: text/search/password deletion, empty fields, Return, Enter and navigation passed');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
