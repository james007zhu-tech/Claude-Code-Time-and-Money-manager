// 本地数据库（IndexedDB）：账单记录连同凭证照片、录音都只存在这台设备上

const DB_NAME = 'voice-ledger';
const VERSION = 1;
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) {
        db.createObjectStore('records', { keyPath: 'id' }).createIndex('time', 'time');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', mode);
    const req = fn(tx.objectStore('records'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const putRecord = rec => run('readwrite', s => s.put(rec));
export const getRecord = id => run('readonly', s => s.get(id));
export const deleteRecord = id => run('readwrite', s => s.delete(id));
export const clearAll = () => run('readwrite', s => s.clear());

const byTimeDesc = list => list.sort((a, b) => b.time - a.time);

export async function allRecords() {
  return byTimeDesc(await run('readonly', s => s.getAll()));
}

// [start, end) 时间范围内的记录，新的在前
export async function recordsBetween(start, end) {
  return byTimeDesc(await run('readonly', s => s.index('time').getAll(IDBKeyRange.bound(start, end, false, true))));
}

export async function latestRecord() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('records').objectStore('records').index('time').openCursor(null, 'prev');
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}
