// Task-specific structured oracle for the local mock benchmark.
// A pass needs exact answer fields AND source evidence that was actually fetched.
export function judge(task, raw, fetched) {
  const malformed = { pass: false, reasons: ['malformed_response'] };
  let sub;
  try { sub = JSON.parse(raw); } catch { return malformed; }
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!obj(sub) || sub.task !== task.id || !obj(sub.answer)) return malformed;
  const keys = Object.keys(task.truth).sort();
  if (JSON.stringify(Object.keys(sub.answer).sort()) !== JSON.stringify(keys)) return malformed;
  const reasons = [];
  if (keys.some((k) => sub.answer[k] !== task.truth[k])) reasons.push('wrong_answer');
  const s = sub.source;
  if (!obj(s) || typeof s.url !== 'string' || typeof s.quote !== 'string' || s.quote === '') {
    reasons.push('missing_source');
  } else if (!Object.hasOwn(fetched, s.url)) {
    reasons.push('source_not_fetched');
  } else {
    if (s.url !== task.oracle.sourcePath) reasons.push('wrong_source_page');
    if (s.quote.includes('\n')) reasons.push('quote_too_broad');
    else {
      const lines = fetched[s.url].split('\n');
      if (!lines.includes(s.quote)) reasons.push('quote_not_in_source');
      else {
        const summaries = lines.filter((line) => line.startsWith('Summary: '));
        const fields = new Map();
        let valid = summaries.length === 1 && summaries[0] === s.quote;
        for (const field of s.quote.slice('Summary: '.length).split('; ')) {
          const match = /^([A-Za-z_][A-Za-z0-9_]*)=([^;=\r\n]+)$/.exec(field);
          if (!match || fields.has(match[1])) {
            valid = false;
            break;
          }
          fields.set(match[1], match[2]);
        }
        if (!valid || fields.size !== task.oracle.evidenceFields.length ||
            task.oracle.evidenceFields.some((k) => fields.get(k) !== task.truth[k])) {
          reasons.push('quote_missing_value');
        }
      }
    }
  }
  return { pass: reasons.length === 0, reasons };
}
