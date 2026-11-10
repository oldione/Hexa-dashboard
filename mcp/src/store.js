// Доступ к Firestore через REST API (работает и в Node, и в Cloudflare Workers).
// Запись с предусловием updateTime — оптимистичная блокировка: если документ
// изменили в браузере между чтением и записью, операция повторяется на свежих данных.

const PROJECT = 'hexa-web-dev';
const API_KEY = 'AIzaSyAy2dKkjq0mukLj_JO8Iqz5ebnca7ZMIQw';
// DASHBOARD_DOC можно переопределить для тестов (например webdev/mcp-test), по умолчанию — боевой документ.
const DOC_PATH = (typeof process !== 'undefined' && process.env?.DASHBOARD_DOC) || 'webdev/dashboard';
const DOC_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${DOC_PATH}`;

function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
const decodeFields = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
const encodeFields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));

async function fetchDoc() {
  const r = await fetch(`${DOC_URL}?key=${API_KEY}`);
  if (r.status === 404) throw new Error('Документ webdev/dashboard не найден — открой дашборд в браузере хотя бы раз.');
  if (!r.ok) throw new Error(`Firestore read ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return { data: decodeFields(j.fields || {}), updateTime: j.updateTime };
}

export async function load() {
  return (await fetchDoc()).data;
}

// fn(data) мутирует data и возвращает результат; документ пишется целиком (как DOC.set в app.js).
export async function mutate(fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, updateTime } = await fetchDoc();
    const result = fn(data);
    const r = await fetch(
      `${DOC_URL}?key=${API_KEY}&currentDocument.updateTime=${encodeURIComponent(updateTime)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(data) }) },
    );
    if (r.ok) return result;
    const text = await r.text();
    if (r.status === 400 && text.includes('FAILED_PRECONDITION') || r.status === 409) continue; // документ изменился — повторить
    throw new Error(`Firestore write ${r.status}: ${text.slice(0, 300)}`);
  }
  throw new Error('Не удалось сохранить: документ постоянно меняется, попробуй ещё раз.');
}
