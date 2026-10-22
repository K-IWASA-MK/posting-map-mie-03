/**
 * active/h-app/modules/pin-status.js
 * H-App Pin Status Feature Module (Architecture B' Wave 3 + Ownership & Generation Recovery)
 *
 * 単一責任:
 * - 現場端末における Pin Status (inProgress / completed / myLocks) のローカルキャッシュ管理
 * - 定期同期 (fetchStatus: 10s throttle / force bypass)
 * - 配布開始時の Backend Authority ロック取得・本人1人1ピン同期・世代付き解除再送 (setInProgress)
 * - 活動完了事実のローカル反映 (reflectCompleted)
 *
 * 厳格な制約:
 * - DOM/Map/UI/Globals への直接依存は一切禁止
 * - app.js private 関数への直接参照禁止 (DI hooks 経由)
 * - 状態公開は承認された7つの関数のみ。状態オブジェクトや mutable callback は外部露出しない
 * - Classic-script lexical binding (window/global property export なし)
 */
const PinStatusModule = (() => {
  // Private State (外部露出 0)
  let _inProgress = [];
  let _completed = [];
  const _myLocks = new Map(); // rowId (number) -> lockId (string)
  let _lastSyncTime = 0;
  let _actionPromiseChain = Promise.resolve();
  let _flushingPendingRemoves = false;

  const PENDING_REMOVES_KEY = 'h_app_pending_pin_removes_v1';

  function _generateLockId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return `lock_${crypto.randomUUID()}`;
      } catch (e) {}
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      try {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return `lock_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      } catch (e) {}
    }
    return `lock_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  function _loadPendingRemoves() {
    if (typeof localStorage === 'undefined' || !localStorage || typeof localStorage.getItem !== 'function') {
      return [];
    }
    try {
      const raw = localStorage.getItem(PENDING_REMOVES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(item => ({
          rowId: parseInt(item && item.rowId, 10),
          lockId: String((item && item.lockId) || '').trim()
        }))
        .filter(item => !isNaN(item.rowId) && item.rowId >= 1 && item.lockId.length > 0);
    } catch (e) {
      return [];
    }
  }

  function _savePendingRemoves(list) {
    if (typeof localStorage === 'undefined' || !localStorage || typeof localStorage.setItem !== 'function') {
      return;
    }
    try {
      if (!Array.isArray(list) || list.length === 0) {
        if (typeof localStorage.removeItem === 'function') {
          localStorage.removeItem(PENDING_REMOVES_KEY);
        } else {
          localStorage.setItem(PENDING_REMOVES_KEY, '[]');
        }
      } else {
        localStorage.setItem(PENDING_REMOVES_KEY, JSON.stringify(list));
      }
    } catch (e) {}
  }

  function _enqueuePendingRemove(rowId, lockId) {
    const id = parseInt(rowId, 10);
    const lid = String(lockId || '').trim();
    if (isNaN(id) || id < 1 || !lid) return;
    const list = _loadPendingRemoves().filter(item => !(item.rowId === id && item.lockId === lid));
    list.push({ rowId: id, lockId: lid });
    _savePendingRemoves(list);
  }

  function _dequeuePendingRemove(rowId, lockId) {
    const id = parseInt(rowId, 10);
    const lid = String(lockId || '').trim();
    if (isNaN(id) || id < 1) return;
    const list = _loadPendingRemoves().filter(item => {
      if (item.rowId !== id) return true;
      if (lid && item.lockId !== lid) return true;
      return false;
    });
    _savePendingRemoves(list);
  }

  function _isTerminalRemoveError(code) {
    return (
      code === 'OWNER_MISMATCH' ||
      code === 'LOCK_MISMATCH' ||
      code === 'ALREADY_REMOVED' ||
      code === 'INVALID_ROW_ID' ||
      code === 'INVALID_ACTION'
    );
  }

  async function _flushPendingRemoves(hooks) {
    if (_flushingPendingRemoves) return;
    const pending = _loadPendingRemoves();
    if (pending.length === 0) return;
    if (typeof callApiPost !== 'function') return;

    _flushingPendingRemoves = true;
    const currentHooks = hooks || {};
    let remaining = pending.slice();

    try {
      for (let i = 0; i < pending.length; i++) {
        const entry = pending[i];
        try {
          if (typeof currentHooks.authorize === 'function') {
            await currentHooks.authorize();
          }
          await callApiPost('setPinInProgress', {
            rowId: entry.rowId,
            pinAction: 'remove',
            lockId: entry.lockId
          });
          remaining = remaining.filter(r => !(r.rowId === entry.rowId && r.lockId === entry.lockId));
        } catch (err) {
          const code = err && err.code ? String(err.code) : '';
          if (_isTerminalRemoveError(code)) {
            remaining = remaining.filter(r => !(r.rowId === entry.rowId && r.lockId === entry.lockId));
          }
          // 通信失敗等の非終端エラーは remaining に残して次回再試行
        }
      }
      _savePendingRemoves(remaining);
    } finally {
      _flushingPendingRemoves = false;
    }
  }

  /**
   * 1. Fetch & Throttle Lifecycle
   * @param {Object} [hooks]
   * @param {boolean} [hooks.force] - true の場合は 10秒スロットルをバイパスして即時再同期
   * @param {Function} [hooks.authorize]
   * @param {Function} [hooks.onStatusUpdated]
   * @param {Function} [hooks.onError]
   * @returns {Promise<void>}
   */
  async function fetchStatus(hooks) {
    const currentHooks = hooks || {};
    const force = currentHooks.force === true;
    const now = Date.now();
    if (!force && now - _lastSyncTime < 10000) {
      return;
    }
    _lastSyncTime = now;
    try {
      if (typeof callApiPost !== 'function') {
        throw new Error('callApiPost is not available');
      }

      await _flushPendingRemoves(currentHooks);
      const pendingRemoves = _loadPendingRemoves();

      const res = await callApiPost('getGlobalPinStatus');
      if (res && res.success) {
        const rawInProgress = Array.isArray(res.inProgress)
          ? res.inProgress.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
          : [];
        const rawCompleted = Array.isArray(res.completed)
          ? res.completed.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
          : [];
        const rawMyInProgress = Array.isArray(res.myInProgress) ? res.myInProgress : null;

        // まだ解除再送待ちの自分の同一 (rowId, lockId) は、青への巻き戻りを防ぐためローカル除外
        const suppressedRowIds = new Set();
        if (rawMyInProgress) {
          _myLocks.clear();
          for (let i = 0; i < rawMyInProgress.length; i++) {
            const item = rawMyInProgress[i];
            const rid = parseInt(item && item.rowId, 10);
            const lid = String((item && item.lockId) || '').trim();
            if (isNaN(rid) || !lid) continue;
            const isPendingRemove = pendingRemoves.some(p => p.rowId === rid && p.lockId === lid);
            if (isPendingRemove) {
              suppressedRowIds.add(rid);
            } else {
              _myLocks.set(rid, lid);
            }
          }
        }

        _inProgress = rawInProgress.filter(rid => !suppressedRowIds.has(rid));
        _completed = rawCompleted;

        if (typeof currentHooks.onStatusUpdated === 'function') {
          currentHooks.onStatusUpdated();
        }
      }
    } catch (err) {
      if (typeof currentHooks.onError === 'function') {
        currentHooks.onError(err);
      }
    }
  }

  /**
   * 2. Mutation & Serialized FIFO Queue
   * @param {number|string} rowId
   * @param {'add'|'remove'} action
   * @param {Object} [hooks]
   * @param {string} [hooks.lockId]
   * @param {Function} [hooks.authorize]
   * @param {Function} [hooks.onStatusUpdated]
   * @param {Function} [hooks.onError]
   * @returns {Promise<Object>}
   */
  function setInProgress(rowId, action, hooks) {
    const currentHooks = hooks || {};
    const numericRowId = parseInt(rowId, 10);

    // remove は UI 応答性維持のためローカル状態を即時解除し、ロック世代を特定して送信
    let removeLockId = String(currentHooks.lockId || '').trim();
    if (!isNaN(numericRowId) && action === 'remove') {
      if (!removeLockId && _myLocks.has(numericRowId)) {
        removeLockId = _myLocks.get(numericRowId) || '';
      }
      _inProgress = _inProgress.filter(id => id !== numericRowId);
      _myLocks.delete(numericRowId);
      if (typeof currentHooks.onStatusUpdated === 'function') {
        currentHooks.onStatusUpdated();
      }
    }

    const opPromise = _actionPromiseChain.then(async () => {
      if (isNaN(numericRowId)) {
        return { success: false, code: 'INVALID_ROW_ID' };
      }

      if (action === 'add') {
        const candidateLockId = String(currentHooks.lockId || '').trim() || _generateLockId();
        try {
          if (typeof currentHooks.authorize === 'function') {
            await currentHooks.authorize();
          }
          if (typeof callApiPost !== 'function') {
            throw new Error('callApiPost is not available');
          }
          const res = await callApiPost('setPinInProgress', {
            rowId: numericRowId,
            pinAction: 'add',
            lockId: candidateLockId
          });

          if (res && res.success === false) {
            const err = new Error(res.message || 'setPinInProgress add failed');
            err.code = res.code || 'ADD_FAILED';
            throw err;
          }

          const canonicalLockId = String((res && res.lockId) || candidateLockId).trim();

          // 1人1ピン: 以前自端末が保持していた別 rowId のロックをローカルからも即時整理
          for (const prevRowId of Array.from(_myLocks.keys())) {
            if (prevRowId !== numericRowId) {
              _myLocks.delete(prevRowId);
              _inProgress = _inProgress.filter(id => id !== prevRowId);
            }
          }

          _myLocks.set(numericRowId, canonicalLockId);
          _dequeuePendingRemove(numericRowId, canonicalLockId);
          if (!_inProgress.includes(numericRowId)) {
            _inProgress.push(numericRowId);
          }

          if (typeof currentHooks.onStatusUpdated === 'function') {
            currentHooks.onStatusUpdated();
          }

          return {
            success: true,
            status: (res && res.status) || 'IN_PROGRESS',
            rowId: numericRowId,
            lockId: canonicalLockId,
            restored: Boolean(res && res.restored)
          };
        } catch (err) {
          const code = err && err.code ? String(err.code) : '';
          if (code === 'LOCKED_BY_OTHER' || code === 'ALREADY_COMPLETED') {
            // 10秒スロットルをバイパスして Backend 権威状態を即時再同期
            await fetchStatus({
              force: true,
              authorize: currentHooks.authorize,
              onStatusUpdated: currentHooks.onStatusUpdated,
              onError: currentHooks.onError
            });
          }
          if (typeof currentHooks.onError === 'function') {
            currentHooks.onError(err);
          }
          return {
            success: false,
            code: code || 'ADD_FAILED',
            error: err
          };
        }
      } else if (action === 'remove') {
        const effectiveLockId = removeLockId || _generateLockId();
        try {
          if (typeof currentHooks.authorize === 'function') {
            await currentHooks.authorize();
          }
          if (typeof callApiPost !== 'function') {
            throw new Error('callApiPost is not available');
          }
          const res = await callApiPost('setPinInProgress', {
            rowId: numericRowId,
            pinAction: 'remove',
            lockId: effectiveLockId
          });

          if (res && res.success === false) {
            const err = new Error(res.message || 'setPinInProgress remove failed');
            err.code = res.code || 'REMOVE_FAILED';
            throw err;
          }

          _dequeuePendingRemove(numericRowId, effectiveLockId);
          return {
            success: true,
            status: (res && res.status) || 'REMOVED',
            rowId: numericRowId,
            lockId: effectiveLockId
          };
        } catch (err) {
          const code = err && err.code ? String(err.code) : '';
          if (code === 'OWNER_MISMATCH' || code === 'LOCK_MISMATCH') {
            // 古い世代または他者ロックのため pending remove を破棄し、10秒スロットルをバイパスして青表示を即時復元
            _dequeuePendingRemove(numericRowId, effectiveLockId);
            await fetchStatus({
              force: true,
              authorize: currentHooks.authorize,
              onStatusUpdated: currentHooks.onStatusUpdated,
              onError: currentHooks.onError
            });
          } else if (_isTerminalRemoveError(code)) {
            _dequeuePendingRemove(numericRowId, effectiveLockId);
          } else if (removeLockId && !_completed.includes(numericRowId)) {
            // 実ロックを保持しており未完了の場合の通信失敗のみ再送キューへ永続化
            _enqueuePendingRemove(numericRowId, removeLockId);
          }
          if (typeof currentHooks.onError === 'function') {
            currentHooks.onError(err);
          }
          return {
            success: false,
            code: code || 'REMOVE_FAILED',
            error: err
          };
        }
      }

      return { success: false, code: 'INVALID_ACTION' };
    });

    // チェーン自体は決して reject させず後続アクションを継続させる
    _actionPromiseChain = opPromise.catch(() => {});
    return opPromise;
  }

  /**
   * 3. Status Query API (isInProgress)
   * @param {number|string} rowId
   * @returns {boolean}
   */
  function isInProgress(rowId) {
    const numericRowId = Number(rowId);
    return !isNaN(numericRowId) && _inProgress.includes(numericRowId);
  }

  /**
   * 4. Status Query API (isMyInProgress)
   * @param {number|string} rowId
   * @returns {boolean}
   */
  function isMyInProgress(rowId) {
    const numericRowId = Number(rowId);
    return !isNaN(numericRowId) && _myLocks.has(numericRowId);
  }

  /**
   * 5. Status Query API (getMyLockId)
   * @param {number|string} rowId
   * @returns {string}
   */
  function getMyLockId(rowId) {
    const numericRowId = Number(rowId);
    if (isNaN(numericRowId)) return '';
    return _myLocks.get(numericRowId) || '';
  }

  /**
   * 6. Status Query API (isCompleted)
   * @param {number|string} rowId
   * @returns {boolean}
   */
  function isCompleted(rowId) {
    const numericRowId = Number(rowId);
    return !isNaN(numericRowId) && _completed.includes(numericRowId);
  }

  /**
   * 7. Activity Derived Snapshot Reflection API
   * Backend / Activity で確定した完了事実をローカルキャッシュへ反映
   * (完了Authorityではなく、ローカル同期のみ。API通信は一切行わない)
   * @param {number|string} rowId
   */
  function reflectCompleted(rowId) {
    const numericRowId = Number(rowId);
    if (!isNaN(numericRowId)) {
      if (!_completed.includes(numericRowId)) {
        _completed.push(numericRowId);
      }
      _inProgress = _inProgress.filter(id => id !== numericRowId);
      const oldLockId = _myLocks.get(numericRowId) || '';
      _myLocks.delete(numericRowId);
      _dequeuePendingRemove(numericRowId, oldLockId);
    }
  }

  return {
    fetchStatus,
    setInProgress,
    isInProgress,
    isMyInProgress,
    getMyLockId,
    isCompleted,
    reflectCompleted
  };
})();
