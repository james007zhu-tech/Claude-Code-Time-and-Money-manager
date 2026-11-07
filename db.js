// 本地数据库（IndexedDB）：所有数据只存在这台设备上
//   records   记录：做了什么、用了多久、花了/收了多少钱、凭证、录音
//   accounts  资产/负债账户；balances 账户余额快照
//   usage     电脑端记录器导入的应用使用时段
//   decisions 投资决策日记
//   kv        其他（例如电脑上选择的同步文件夹）

const DB_NAME = 'voice-ledger';
const VERSION = 2;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ensure = (name, opts, indexes = []) => {
        if (db.objectStoreNames.contains(name)) return;
        const s = db.createObjectStore(name, opts);
        for (const [idx, key] of indexes) s.createIndex(idx, key);
      };
      ensure('records', { keyPath: 'id' }, [['time', 'time']]);
      ensure('accounts', { keyPath: 'id' });
      ensure('balances', { keyPath: 'id' }, [['account', 'accountId'], ['time', 'time']]);
      ensure('usage', { keyPath: 'id' }, [['start', 'start'], ['dayKey', 'dayKey']]);
      ensure('decisions', { keyPath: 'id' }, [['time', 'time']]);
      ensure('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const byTimeDesc = list => list.sort((a, b) => b.time - a.time);

// 通用
export const put = (store, v) => run(store, 'readwrite', s => s.put(v));
export const get = (store, id) => run(store, 'readonly', s => s.get(id));
export const del = (store, id) => run(store, 'readwrite', s => s.delete(id));
export const all = store => run(store, 'readonly', s => s.getAll());

export async function putMany(store, list) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const s = tx.objectStore(store);
    for (const v of list) s.put(v);
    tx.oncomplete = () => resolve(list.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 记录
export const putRecord = rec => put('records', rec);
export const getRecord = id => get('records', id);
export const deleteRecord = id => del('records', id);
export const allRecords = async () => byTimeDesc(await all('records'));

// [start, end) 时间范围内开始的记录，新的在前
export async function recordsBetween(start, end) {
  return byTimeDesc(await run('records', 'readonly', s => s.index('time').getAll(IDBKeyRange.bound(start, end, false, true))));
}

export async function latestRecord() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('records').objectStore('records').index('time').openCursor(null, 'prev');
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

// 设备使用：同一台设备同一天的文件重复导入时整体替换
export async function replaceUsageDay(device, dayKey, sessions) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('usage', 'readwrite');
    const s = tx.objectStore('usage');
    const req = s.index('dayKey').openCursor(IDBKeyRange.only(`${device}|${dayKey}`));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) { cur.delete(); cur.continue(); return; }
      for (const u of sessions) s.put(u);
    };
    tx.oncomplete = () => resolve(sessions.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function usageBetween(start, end) {
  // 跨过 start 的会话也算，所以多取一天
  return run('usage', 'readonly', s => s.index('start').getAll(IDBKeyRange.bound(start - 86400000, end, false, true)))
    .then(list => list.filter(u => u.end > start));
}

export const kvGet = key => run('kv', 'readonly', s => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', s => s.put(value, key));
