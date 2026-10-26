// A plan is ordered so every source match exists before the match consuming it.
function buildBracket(entries, format) {
  const size = entries.length;
  if (size < 2 || size > 32 || (size & (size - 1)) !== 0) throw new Error('Нужно 2, 4, 8, 16 или 32 одобренных участника.');
  if (!['single', 'double'].includes(format)) throw new Error('Неизвестный формат сетки.');
  const rounds = Math.log2(size);
  const plan = [];
  const upper = [];
  for (let round = 1; round <= rounds; round++) {
    upper[round] = [];
    for (let pos = 0; pos < size / (2 ** round); pos++) {
      const node = { bracket: 'upper', round, position: pos + 1 };
      if (round === 1) {
        node.a = { entry: entries[pos * 2] };
        node.b = { entry: entries[pos * 2 + 1] };
      } else {
        node.a = { source: upper[round - 1][pos * 2], result: 'winner' };
        node.b = { source: upper[round - 1][pos * 2 + 1], result: 'winner' };
      }
      upper[round].push(plan.push(node) - 1);
    }
  }
  if (format === 'single') return plan;
  const lower = [];
  for (let round = 1; round <= 2 * rounds - 2; round++) {
    const lowerPair = Math.ceil(round / 2);
    const count = size / (2 ** (lowerPair + 1));
    lower[round] = [];
    for (let pos = 0; pos < count; pos++) {
      const node = { bracket: 'lower', round, position: pos + 1 };
      if (round === 1) {
        node.a = { source: upper[1][pos * 2], result: 'loser' };
        node.b = { source: upper[1][pos * 2 + 1], result: 'loser' };
      } else if (round % 2 === 0) {
        node.a = { source: lower[round - 1][pos], result: 'winner' };
        node.b = { source: upper[lowerPair + 1][pos], result: 'loser' };
      } else {
        node.a = { source: lower[round - 1][pos * 2], result: 'winner' };
        node.b = { source: lower[round - 1][pos * 2 + 1], result: 'winner' };
      }
      lower[round].push(plan.push(node) - 1);
    }
  }
  plan.push({ bracket: 'final', round: 1, position: 1,
    a: { source: upper[rounds][0], result: 'winner' },
    b: rounds === 1 ? { source: upper[1][0], result: 'loser' } : { source: lower[2 * rounds - 2][0], result: 'winner' } });
  return plan;
}
module.exports = { buildBracket };
