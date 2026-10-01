/* Versioned career saves shared by the browser and Node tests.
 * The graph format preserves shared pedigree objects without duplicating
 * every ancestor, and can round-trip a cycle without recursive JSON errors.
 * A localStorage setItem is atomic: backup is written before the main key.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaimaCareerSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const KEY = 'saima-career-save';
  const BACKUP_KEY = 'saima-career-save-backup';
  const KIND = 'saima-career';
  const MAX_NODES = 200000;
  const BET_NEED = { '単勝': 1, '複勝': 1, '馬連': 2, '馬単': 2, '三連複': 3, '三連単': 3 };
  const ATTRS = ['速度', '爆发力', '出闸能力', '耐力', '力量', '毅力', '智力', '体格'];
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.prototype.toString.call(v) === '[object Object]';
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  const failure = (status, message) => ({ ok: false, status, error: message });
  const storageError = (e) => failure('storage-error', '无法读写浏览器存档：' + (e && e.message ? e.message : String(e)));
  function requireStorage(storage) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new Error('localStorage 不可用，进度未保存');
    }
  }
  function demand(condition, message) { if (!condition) throw new Error(message); }
  function validateSnapshot(snapshot) {
    try {
      demand(record(snapshot), '存档快照必须是对象');
      demand(finite(snapshot.bankroll) && snapshot.bankroll >= 0, '资金必须为非负有限数值');
      demand(record(snapshot.careerStaff), '缺少生涯员工');
      for (const role of ['牧场长', '调教师']) demand(record(snapshot.careerStaff[role]), '缺少员工：' + role);
      demand(['S', 'A', 'B', 'C', 'D', 'E'].includes(snapshot.careerStaff['牧场长']['相马眼']) && ['S', 'A', 'B', 'C', 'D', 'E'].includes(snapshot.careerStaff['调教师']['洞察力']), '员工等级无效');
      const c = snapshot.career;
      demand(record(c), '缺少生涯');
      demand(record(c.date) && integer(c.date.year, 1, 99999) && integer(c.date.week, 1, 52), '生涯日期无效');
      demand(integer(c.weekNum, 1, Number.MAX_SAFE_INTEGER), '生涯周数无效');
      for (const key of ['roster', 'breedingStock', 'aiRaces', 'intel']) demand(Array.isArray(c[key]), '缺少列表：' + key);
      for (const key of ['weekBets', 'startedIds', 'watchedIds', 'settledIds', 'betTypes', 'stats']) demand(record(c[key]), '缺少对象：' + key);
      demand(typeof c.debug === 'boolean', '调试状态无效');
      demand(c.recap === null || record(c.recap), '周回顾无效');
      demand(c.watchInfo === null || record(c.watchInfo), '观赛状态无效');
      demand(integer(c.stats.bets, 0, Number.MAX_SAFE_INTEGER) && integer(c.stats.hits, 0, c.stats.bets) && finite(c.stats.profit), '下注统计无效');
      const validateHorse = (h) => {
        demand(record(h) && typeof h.id === 'string' && h.id.length > 0 && typeof h.name === 'string', '马匹身份无效');
        demand(record(h.stats) && ATTRS.every((key) => own(h.stats, key) && finite(h.stats[key])) && Object.values(h.stats).every(finite), '马匹属性无效：' + h.id);
      };
      c.roster.forEach(validateHorse);
      c.breedingStock.forEach(validateHorse);
      const races = new Map();
      for (const r of c.aiRaces) {
        demand(record(r) && typeof r.id === 'string' && r.id.length > 0 && Array.isArray(r.field) && record(r.odds), '本周赛程无效');
        demand(!races.has(r.id), '本周赛事编号重复');
        races.set(r.id, r);
        demand(finite(r.dist) && r.dist > 0 && integer(r.rngSeed, 0, 4294967295), '赛事距离或种子无效');
        r.field.forEach(validateHorse);
        demand(new Set(r.field.map((h) => h.id)).size === r.field.length, '赛事参赛马重复');
        for (const h of r.field) {
          demand(record(r.odds[h.id]) && finite(r.odds[h.id]['赔率']) && r.odds[h.id]['赔率'] > 0, '赛事赔率无效');
        }
      }
      for (const id of Object.keys(c.weekBets)) {
        const b = c.weekBets[id];
        const race = races.get(id);
        demand(race && record(b) && typeof b.type === 'string' && own(BET_NEED, b.type) && Array.isArray(b.ids), '注单赛事或券种无效');
        demand(!own(c.settledIds, id), '已结算赛事仍有待结算注单');
        demand(b.ids.length === BET_NEED[b.type] && new Set(b.ids).size === b.ids.length && b.ids.every((hid) => typeof hid === 'string' && race.field.some((h) => h.id === hid)), '注单马匹数量、身份或重复选择无效');
        demand(finite(b.amount) && b.amount > 0 && finite(b.odds) && b.odds > 0, '注单金额或赔率无效');
      }
      demand(Object.values(c.startedIds).every((v) => typeof v === 'boolean'), '已开赛标记无效');
      for (const id of Object.keys(c.startedIds)) demand(races.has(id), '已开赛标记不属于本周赛事');
      demand(Object.values(c.watchedIds).every((v) => typeof v === 'boolean'), '已观看标记无效');
      for (const id of Object.keys(c.watchedIds)) {
        if (c.watchedIds[id]) demand(races.has(id) && c.startedIds[id] === true && own(c.settledIds, id), '已观看赛事缺少开赛标记或结算摘要');
      }
      for (const id of Object.keys(c.settledIds)) {
        const summary = c.settledIds[id], race = races.get(id);
        demand(race && c.watchedIds[id] === true, '结算摘要赛事或已观看标记不一致');
        demand(record(summary) && Array.isArray(summary.orderIds) && new Set(summary.orderIds).size === summary.orderIds.length && summary.orderIds.every((hid) => typeof hid === 'string' && race.field.some((h) => h.id === hid)) && typeof summary.result === 'string', '已结算赛事名次无效');
        demand(summary.betText === null || typeof summary.betText === 'string', '已结算注单文字无效');
        for (const key of ['intelLines', 'retireLines']) demand(Array.isArray(summary[key]) && summary[key].every((line) => typeof line === 'string'), '结算摘要文字列表无效：' + key);
        demand(Array.isArray(summary.betIds) && summary.betIds.length <= 3 && new Set(summary.betIds).size === summary.betIds.length && summary.betIds.every((hid) => typeof hid === 'string' && race.field.some((h) => h.id === hid)), '已结算注单马匹无效');
      }
      const b = snapshot.breedState;
      demand(record(b), '缺少繁殖状态');
      for (const key of ['sireId', 'damId']) demand(b[key] === null || typeof b[key] === 'string', '繁殖亲代无效');
      for (const key of ['foalSireId', 'foalDamId']) if (own(b, key)) demand(b[key] === null || typeof b[key] === 'string', '幼驹亲代编号无效');
      demand(b.foal === null || record(b.foal), '幼驹状态无效');
      if (b.foal !== null) {
        demand(record(b.foal.stats) && ATTRS.every((key) => own(b.foal.stats, key) && finite(b.foal.stats[key])) && Object.values(b.foal.stats).every(finite), '幼驹属性无效');
        demand(typeof b.foal.earlyDeath === 'boolean' && finite(b.foal.state) && finite(b.foal.drain), '幼驹成长状态无效');
        demand(typeof b.foalSireId === 'string' && c.breedingStock.some((h) => h.id === b.foalSireId && h.sex === '牡'), '幼驹父马不在血统库中');
        demand(typeof b.foalDamId === 'string' && c.breedingStock.some((h) => h.id === b.foalDamId && h.sex === '牝'), '幼驹母马不在血统库中');
      }
      return { ok: true, status: 'valid' };
    } catch (e) { return failure('invalid', e.message); }
  }
  function encodeGraph(snapshot) {
    const nodes = [], seen = new Map(), pending = [];
    function token(value) {
      if (value === undefined) return { u: true };
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number') { demand(finite(value), '快照包含非有限数值'); return value; }
      demand(Array.isArray(value) || record(value), '快照包含不支持的类型：' + typeof value);
      if (seen.has(value)) return { r: seen.get(value) };
      demand(nodes.length < MAX_NODES, '存档对象过多');
      const idx = nodes.length;
      seen.set(value, idx);
      nodes.push(null); pending.push(value);
      return { r: idx };
    }
    const rootToken = token(snapshot);
    for (let i = 0; i < pending.length; i++) {
      const value = pending[i];
      nodes[i] = Array.isArray(value)
        ? { type: 'array', items: Array.from(value, token) }
        : { type: 'object', entries: Object.keys(value).map((key) => [key, token(value[key])]) };
    }
    return { root: rootToken, nodes };
  }
  function decodeGraph(graph) {
    demand(record(graph) && Array.isArray(graph.nodes) && graph.nodes.length > 0 && graph.nodes.length <= MAX_NODES, '存档对象图无效');
    const objects = graph.nodes.map((node) => {
      demand(record(node) && (node.type === 'array' || node.type === 'object'), '存档节点无效');
      return node.type === 'array' ? [] : {};
    });
    function resolve(token) {
      if (token === null || typeof token === 'string' || typeof token === 'boolean') return token;
      if (typeof token === 'number') { demand(finite(token), '存档数值无效'); return token; }
      demand(record(token) && Object.keys(token).length === 1, '存档引用无效');
      if (own(token, 'u')) { demand(token.u === true, '存档空值无效'); return undefined; }
      demand(own(token, 'r') && integer(token.r, 0, objects.length - 1), '存档引用越界');
      return objects[token.r];
    }
    graph.nodes.forEach((node, idx) => {
      if (node.type === 'array') {
        demand(Array.isArray(node.items), '存档数组无效');
        for (const item of node.items) objects[idx].push(resolve(item));
      } else {
        demand(Array.isArray(node.entries), '存档对象属性无效');
        const keys = new Set();
        for (const entry of node.entries) {
          demand(Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && !keys.has(entry[0]), '存档对象属性重复或无效');
          keys.add(entry[0]);
          // defineProperty also keeps a literal __proto__ key from changing a prototype.
          Object.defineProperty(objects[idx], entry[0], { value: resolve(entry[1]), writable: true, enumerable: true, configurable: true });
        }
      }
    });
    return resolve(graph.root);
  }
  function checksum(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }
  function parse(raw) {
    if (raw === null || raw === undefined) return failure('missing', '尚无生涯存档');
    try {
      const envelope = JSON.parse(raw);
      demand(record(envelope) && envelope.kind === KIND && integer(envelope.version, 1, Number.MAX_SAFE_INTEGER), '存档格式无效');
      if (envelope.version !== VERSION) return failure('unsupported', '存档版本 ' + envelope.version + ' 不受当前版本支持，原存档已保留');
      demand(typeof envelope.savedAt === 'string' && Number.isFinite(Date.parse(envelope.savedAt)), '存档时间无效');
      demand(typeof envelope.checksum === 'string' && checksum(JSON.stringify(envelope.payload)) === envelope.checksum, '存档校验失败');
      const snapshot = decodeGraph(envelope.payload);
      const validation = validateSnapshot(snapshot);
      demand(validation.ok, validation.error);
      return { ok: true, status: 'ok', snapshot, savedAt: envelope.savedAt, version: envelope.version };
    } catch (e) { return failure('corrupt', '存档损坏：' + e.message); }
  }
  function load(storage) {
    try {
      requireStorage(storage);
      const primary = parse(storage.getItem(KEY));
      if (primary.ok || primary.status === 'unsupported') return primary;
      const backup = parse(storage.getItem(BACKUP_KEY));
      if (backup.ok) return { ...backup, status: 'recovered', error: primary.error, recoveredFrom: BACKUP_KEY };
      if (backup.status === 'unsupported') return backup;
      if (primary.status === 'missing' && backup.status === 'missing') return primary;
      return failure('corrupt', primary.status === 'missing' ? backup.error : primary.error);
    } catch (e) { return storageError(e); }
  }
  function save(storage, snapshot) {
    const validation = validateSnapshot(snapshot);
    if (!validation.ok) return validation;
    let raw;
    try {
      const payload = encodeGraph(snapshot);
      const savedAt = new Date().toISOString();
      raw = JSON.stringify({ kind: KIND, version: VERSION, savedAt, checksum: checksum(JSON.stringify(payload)), payload });
    } catch (e) { return failure('invalid', '无法序列化生涯：' + e.message); }
    try {
      requireStorage(storage);
      const previous = storage.getItem(KEY);
      const primary = parse(previous);
      if (primary.status === 'unsupported') return primary;
      if (primary.ok) storage.setItem(BACKUP_KEY, previous);
      else {
        const backup = parse(storage.getItem(BACKUP_KEY));
        if (backup.status === 'unsupported') return backup;
        if (!backup.ok && (primary.status === 'corrupt' || backup.status === 'corrupt')) {
          return failure('corrupt', '没有可恢复的有效存档，损坏数据已保留；请明确重置后再保存');
        }
        // When recovering, keep the last valid backup intact and replace only main.
      }
      storage.setItem(KEY, raw);
      return { ok: true, status: 'saved', version: VERSION };
    } catch (e) { return storageError(e); }
  }
  return { VERSION, KEY, BACKUP_KEY, load, save, validateSnapshot };
});
