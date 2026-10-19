/**
 * POSTING MAP — IndexedDB 送信キュー管理
 * 
 * オフラインでも作業を止めない FIELD OPERATIONS OS の核心モジュール。
 * 
 * フロー:
 *   enqueueSync() → processQueue() → callApiPost('updateRecordWithGPSPhoto')
 *                                   → 成功: dequeueSync()
 *                                   → 失敗: scheduleRetry() (指数バックオフ)
 * 
 * リトライスケジュール: 10s → 30s → 60s → 60s → 60s (最大5回)
 */

const DB_NAME    = 'PostingMapDB';
const STORE_NAME = 'syncQueue';
const DB_VERSION = 2; // スキーマ拡張のためバージョンアップ

// リトライ設定
const RETRY_DELAYS  = [10000, 30000, 60000, 60000, 60000]; // ms
const MAX_RETRIES   = 5;

// 同期中フラグ（多重実行防止）
let isProcessing = false;

// ── DB接続 ───────────────────────────────────────────────────
let dbPromise = null;

function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // v1 → v2: インデックスは不要だが syncStatus フィールドを追加
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror   = (e) => reject(e.target.error);
  });
  return dbPromise;
}

// ── キュー操作 ────────────────────────────────────────────────

/**
 * キューにタスクを追加して即座に送信を試みる
 * @param {Object} item - { areaName, rowId, isDone, count, latitude, longitude,
 *                          accuracy, branchCode, areaId, photoBase64, staffName, staffId }
 */
/**
 * JST基準の月度文字列（YYYY-MM）を取得
 */
function getJstMonth(ts) {
  const num = Number(ts);
  const d = (Number.isFinite(num) && num > 0) ? new Date(num) : new Date();
  const jst = new Date(d.getTime() + (9 * 60 * 60 * 1000));
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function enqueueSync(item) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // 同一 readwrite トランザクション境界内で探索（競合窓を完全排除）
    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const queue = getAllReq.result || [];
      const targetRowId = Number(item.rowId);
      const targetMonth = getJstMonth(item.timestamp || Date.now());

      // 同一 JST月 かつ 同一 rowId のアイテムが既にキューに存在するかチェック
      const existing = queue.find(q => Number(q.rowId) === targetRowId && getJstMonth(q.timestamp) === targetMonth);
      if (existing) {
        console.warn(`[Queue] Duplicate enqueue avoided for rowId=${targetRowId}, month=${targetMonth}, existingId=${existing.id}`);
        resolve(existing.id);
        processQueue();
        return;
      }

      // クライアント不変操作識別子 (requestId) を付与（Backend冪等性ロジックは変更せずクライアント識別子として活用）
      const record = {
        ...item,
        requestId:   item.requestId || ('req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)),
        syncStatus:  'PENDING',
        retryCount:  item.retryCount || 0,
        nextRetryAt: item.nextRetryAt || 0,
        timestamp:   item.timestamp || Date.now()
      };

      const addReq = store.add(record);
      addReq.onsuccess = () => {
        resolve(addReq.result);
        // 即座に同期を試みる（バックグラウンド）
        processQueue();
      };
      addReq.onerror = (e) => reject(e.target.error);
    };

    getAllReq.onerror = (e) => reject(e.target.error);
    tx.onerror = (e) => reject(e.target.error);
  });
}

/**
 * 全キューを取得
 */
async function getQueue() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readonly');
    const store   = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * 特定アイテムを削除（送信完了時）
 */
async function dequeueSync(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE_NAME, 'readwrite');
    const store   = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * アイテムのフィールドを更新
 */
async function updateQueueItem(id, fields) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_NAME, 'readwrite');
    const store  = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const data = getReq.result;
      if (data) {
        Object.assign(data, fields);
        store.put(data);
      }
      resolve();
    };
    getReq.onerror = (e) => reject(e.target.error);
  });
}

/**
 * クライアント不変操作識別子 (requestId) を生成
 * @param {string} prefix プレフィックス (デフォルト: 'req')
 * @returns {string} 一意の識別子
 */
function generateRequestId(prefix = 'req') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
window.generateRequestId = generateRequestId;

/**
 * 特定 rowId の送信ステータスを取得（キュー内に存在する未終端レコードを対象、数値/文字列の型を正規化）
 * @returns {string|null} 'PENDING' | 'SYNCING' | 'RETRY' | 'FAILED_PERMANENT' | null
 */
async function getRowStatus(rowId) {
  const targetId = Number(rowId);
  const queue = await getQueue();
  const found = queue.find(q => Number(q.rowId) === targetId);
  return found ? (found.syncStatus || found.status || 'PENDING') : null;
}
window.getRowStatus = getRowStatus;

/**
 * 現在キュー内に存在する未終端レコードの rowId 配列（数値）を取得
 * 起動時やデータロード時の待機ピン復元に使用
 * @returns {Promise<number[]>}
 */
async function getSyncQueueRowIds() {
  const queue = await getQueue();
  return (queue || [])
    .map(item => Number(item.rowId))
    .filter(id => !isNaN(id));
}
window.getSyncQueueRowIds = getSyncQueueRowIds;

// ── 指数バックオフリトライスケジューリング ─────────────────────

/**
 * 失敗時にリトライをスケジュール
 * - retryCount >= MAX_RETRIES の場合は FAILED_PERMANENT（手動再送待機、nextRetryAt=0）
 * - 呼出元へ最終 syncStatus ("RETRY" または "FAILED_PERMANENT") を返却
 */
async function scheduleRetry(item) {
  const count = (item.retryCount || 0) + 1;
  const isPermanent = count >= MAX_RETRIES;
  const delay = RETRY_DELAYS[Math.min(count - 1, RETRY_DELAYS.length - 1)];
  const status = isPermanent ? 'FAILED_PERMANENT' : 'RETRY';

  console.log(`[Queue] Retry scheduled: id=${item.id}, attempt=${count}/${MAX_RETRIES}, status=${status}, delay=${isPermanent ? 0 : delay / 1000}s`);

  await updateQueueItem(item.id, {
    syncStatus:  status,
    retryCount:  count,
    nextRetryAt: isPermanent ? 0 : Date.now() + delay
  });

  return status;
}

// ── メイン同期処理 ────────────────────────────────────────────

// Queue Lifecycle Gates (Auth readiness, UI Sync, LoadData)
let _queueLifecycleGates = null;

function setQueueLifecycleGates(gates) {
  _queueLifecycleGates = gates;
}

// Activity Feature Module 連携用固定 Hooks (Generic Event Bus 禁止)
let _activityQueueHooks = null;

/**
 * Activity Feature Module との固定連携 Hooks を設定
 * 4本すべての Hook が function であることを厳格に検証 (Partial Fail-Open 禁止)
 * @param {Object} hooks
 * @param {Function} hooks.onRejectedBeforeDequeue - async (item, res) => void
 * @param {Function} hooks.onAcceptedAfterDequeue - async (item, res) => void
 * @param {Function} hooks.onFailedAfterQueueUpdate - async (item, finalStatus, err) => void
 * @param {Function} hooks.onManualRetryReset - (item) => void
 */
function configureActivityQueueHooks(hooks) {
  if (!hooks ||
      typeof hooks.onRejectedBeforeDequeue !== 'function' ||
      typeof hooks.onAcceptedAfterDequeue !== 'function' ||
      typeof hooks.onFailedAfterQueueUpdate !== 'function' ||
      typeof hooks.onManualRetryReset !== 'function') {
    throw new Error("[Queue] Invalid Activity Queue Hooks: All 4 hooks must be provided as functions.");
  }
  _activityQueueHooks = hooks;
}

/**
 * キュー内の送信待ちアイテムを順次送信する
 * - 多重実行防止（isProcessing フラグ）
 * - オフライン時はスキップ
 * - 指数バックオフによる nextRetryAt チェック
 * - クラッシュ復旧（SYNCING のまま中断されたレコードの再送）
 */
async function processQueue() {
  if (isProcessing) return;
  if (!navigator.onLine) {
    updateUISyncStatus();
    return;
  }

  // Activity Queue Hooks 準備防壁 (Fail-Closed: 契約 Gate 37)
  // Hooks 未設定時は API通信・dequeue・retryCount消費を一切行わず安全に待機
  if (!_activityQueueHooks) {
    console.warn("[Queue] Activity Queue Hooks not configured. Fail-Closed guard activated.");
    updateUISyncStatus();
    return;
  }

  // Auth / Identity 準備防壁 (Fail-Closed)
  // 未準備時は retryCount を消費せず、ネットワーク通信も行わず安全に待機中断
  const isAuthReady = _queueLifecycleGates && typeof _queueLifecycleGates.isIdentityVerifiedReady === 'function'
    ? _queueLifecycleGates.isIdentityVerifiedReady()
    : false;

  if (!isAuthReady) {
    updateUISyncStatus();
    return;
  }

  isProcessing = true;
  updateUISyncStatus();

  try {
    const queue = await getQueue();

    // 送信対象: PENDING, クラッシュ後の SYNCING, または nextRetryAt を過ぎた RETRY
    const now = Date.now();
    const targets = queue.filter(item => {
      const s = item.syncStatus || item.status;
      if (s === 'PENDING' || s === 'pending' || s === 'SYNCING') return true;
      if (s === 'RETRY'   || s === 'failed') {
        return (item.nextRetryAt || 0) <= now;
      }
      return false;
    });

    if (targets.length === 0) {
      isProcessing = false;
      updateUISyncStatus();
      return;
    }

    console.log(`[Queue] Processing ${targets.length} item(s)...`);
    let anySuccess = false; // 全アイテム処理後に1回だけloadDataを呼ぶフラグ

    for (const item of targets) {
      // 送信中マーク
      await updateQueueItem(item.id, { syncStatus: 'SYNCING' });
      updateUISyncStatus();

      try {
        const payload = {
          timestamp:      item.timestamp || '',
          requestId:      item.requestId  || '',
          clientEventId:  item.clientEventId || item.requestId || '',
          areaName:       item.areaName,
          rowId:          item.rowId,
          isDone:         item.isDone,
          count:          item.count,
          latitude:       item.latitude   || '',
          longitude:      item.longitude  || '',
          accuracy:       item.accuracy   || '',
          photoData:      item.photoBase64 || '',
          staffName:      item.staffName,
          staffId:        item.staffId
        };

        // 写真データはURL長制限を超えるためPOSTで送信
        const res = await callApiPost('updateRecordWithGPSPhoto', payload);

        if (res && res.success) {
          // ── STALE_MONTH 等の非受諾終端処理 (Race防止: dequeue前にHook発火) ──
          if (res.accepted === false) {
            console.warn(`[Queue] Item rejected without retry: id=${item.id}, code=${res.code}`);

            // 1. REJECTED Hook を dequeue 前に同期呼出 (ポーリングとの Race を完全遮断、直接呼出)
            await _activityQueueHooks.onRejectedBeforeDequeue(item, res);

            // 2. Queue から削除
            await dequeueSync(item.id);
            anySuccess = true; // loadData(true) でCurrent Sheet再読込
            continue;
          }

          // ── 因果関係の絶対順序 (正常受諾) ─────────────────────────
          // 1. Backend persistence confirmed (res.success === true && res.accepted !== false)
          // 2. dequeueSync()
          await dequeueSync(item.id);

          // 3. onAcceptedAfterDequeue Hook 呼出 (直接呼出)
          // (PinStatus remove ➔ reflectCompleted ➔ applyQueueOutcome ACCEPTED ➔ lockPin ➔ rerender)
          await _activityQueueHooks.onAcceptedAfterDequeue(item, res);

          console.log(`[Queue] Synced: id=${item.id}, rowId=${item.rowId}, reqId=${item.requestId || 'legacy'}`);
          anySuccess = true; // 1件でも成功 → 後でまとめてUI更新
        } else {
          throw new Error(res ? (res.message || 'API failure') : 'No response');
        }

      } catch (err) {
        console.error(`[Queue] Failed: id=${item.id}`, err.message);

        // TRANSIENT か PERMANENT かを判定
        const TRANSIENT_CODES = ['NETWORK_FAILURE', 'LOCK_TIMEOUT', 'RATE_LIMIT_EXCEEDED', 'INTERNAL_ERROR'];
        const isTransient = err.retryable === true || (err.retryable === undefined && TRANSIENT_CODES.includes(err.code));

        let finalStatus;
        if (isTransient) {
          // TRANSIENT だけ既存 scheduleRetry() (10s->30s->60s->60s->60s / 最大5回)
          finalStatus = await scheduleRetry(item);
        } else {
          // PERMANENT (UNAUTHORIZED, NOT_REGISTERED, CONTRACT_EXPIRED, INVALID_ARGUMENT 等):
          // scheduleRetry() 禁止、retryCount を人工的に増やさず即座に FAILED_PERMANENT 終端 (payload保持)
          finalStatus = 'FAILED_PERMANENT';
          await updateQueueItem(item.id, {
            syncStatus: 'FAILED_PERMANENT',
            nextRetryAt: 0,
            lastError: err.message,
            errorCode: err.code || 'PERMANENT_ERROR'
          });
        }

        // FAILED Hook 呼出 (ActivityModule.applyQueueOutcome(point, FAILED) へ委譲、直接呼出)
        await _activityQueueHooks.onFailedAfterQueueUpdate(item, finalStatus, err);
      }
    }

    // 全キュー処理完了後に1回だけUI更新（件数分の連続API呼び出しを防止）
    if (
      anySuccess &&
      _queueLifecycleGates &&
      typeof _queueLifecycleGates.loadData === 'function'
    ) {
      _queueLifecycleGates.loadData(true);
    }

  } catch (err) {
    console.error('[Queue] processQueue error:', err);
  } finally {
    isProcessing = false;
    updateUISyncStatus();
  }
}

// ── ユーティリティ ────────────────────────────────────────────

/**
 * Blob を Base64 Data URL に変換（Safari/LINE WebView 対応）
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}
window.blobToBase64 = blobToBase64;

/**
 * UI の同期ステータス表示を更新（app.js の triggerUISyncRefresh を呼ぶ）
 */
function updateUISyncStatus() {
  if (
    _queueLifecycleGates &&
    typeof _queueLifecycleGates.triggerUISyncRefresh === 'function'
  ) {
    _queueLifecycleGates.triggerUISyncRefresh();
  }
}

/**
 * FAILED_PERMANENT 状態のキューを手動で再送待機 (PENDING) に戻し、即時 processQueue() を実行
 * - 既存Queue item の id, requestId, timestamp, count, photoBase64, 座標等全payloadを完全維持
 * - retryCount: 0, nextRetryAt: 0, syncStatus: 'PENDING' の3状態フィールドのみ更新
 * - 新規レコード作成禁止 (enqueueSync は呼ばない)
 * @param {number|string} rowId
 */
async function manualRetrySync(rowId) {
  const targetId = Number(rowId);
  const queue = await getQueue();
  const item = queue.find(q => Number(q.rowId) === targetId);
  if (!item) {
    console.warn(`[Queue] manualRetrySync: Item not found for rowId=${rowId}`);
    return;
  }

  // 状態フィールド（syncStatus, retryCount, nextRetryAt）の3点のみリセット（payload完全維持）
  await updateQueueItem(item.id, {
    syncStatus:  'PENDING',
    retryCount:  0,
    nextRetryAt: 0
  });

  // onManualRetryReset Hook 呼出 (ActivityModule.applyQueueOutcome(point, RETRY_RESET) へ委譲、直接呼出)
  if (!_activityQueueHooks) {
    console.warn("[Queue] Activity Queue Hooks not configured. manualRetrySync aborted.");
    return;
  }
  _activityQueueHooks.onManualRetryReset(item);

  updateUISyncStatus();
  processQueue();
}
window.manualRetrySync = manualRetrySync;

// ── イベントリスナー ──────────────────────────────────────────

// オンライン復帰時に自動同期
window.addEventListener('online', () => {
  console.log('[Queue] Online restored. Processing queue...');
  processQueue();
});

// 定期ポーリング: nextRetryAt を過ぎたアイテムを検出して送信
// 最小 RETRY_DELAYS[0] = 10s に合わせて10秒ごとにチェック
setInterval(() => {
  if (navigator.onLine) processQueue();
}, 10000);
