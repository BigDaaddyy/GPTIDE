function escapeFindQuery(query) { return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function findMessageMatches(messages, query, cache = new Map()) {
  if (!query) { cache.clear(); return []; }
  const pattern = new RegExp(escapeFindQuery(query), 'iu'), result = [];
  for (let i = 0; i < messages.length; i++) {
    const text = typeof messages[i].text === 'string' ? messages[i].text : '', old = cache.get(i);
    const match = old?.query === query && old.text === text ? old.match : pattern.test(text);
    cache.set(i, { query, text, match }); if (match) result.push(i);
  }
  for (const key of cache.keys()) if (key >= messages.length) cache.delete(key);
  return result;
}
if (typeof module !== 'undefined') module.exports = { escapeFindQuery, findMessageMatches };
