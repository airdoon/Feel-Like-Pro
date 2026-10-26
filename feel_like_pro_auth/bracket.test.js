const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBracket } = require('./bracket');
for (const size of [2, 4, 8, 16, 32]) {
  for (const format of ['single', 'double']) {
    test(`${format} bracket for ${size}`, () => {
      const plan = buildBracket(Array.from({ length: size }, (_, i) => String(i)), format);
      assert.equal(plan.length, format === 'single' ? size - 1 : 2 * size - 2);
      plan.forEach((node, index) => {
        for (const side of [node.a, node.b]) if (side.source !== undefined) assert.ok(side.source < index);
      });
      assert.equal(plan.at(-1).bracket, format === 'single' ? 'upper' : 'final');
    });
  }
}
