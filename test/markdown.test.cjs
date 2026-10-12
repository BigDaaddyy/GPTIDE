const test = require('node:test'), assert = require('node:assert/strict');
const { parseMarkdown } = require('../builtin/markdown.cjs');
test('markdown handles tables, code streaming and literal HTML', () => {
  const blocks = parseMarkdown('# Title\n\n- one\n- two\n\n```js\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| x | y |');
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'list', 'code', 'table']);
  assert.equal(blocks[2].text, 'const x = 1;');
  assert.equal(parseMarkdown('```js\nconst x =')[0].text, 'const x =');
  assert.equal(parseMarkdown('<img src=x onerror=alert(1)>')[0].text, '<img src=x onerror=alert(1)>');
});
