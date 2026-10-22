/**
 * active/h-app/modules/activity.js
 * H-App Activity Feature / Lifecycle Module (Architecture B' Wave 4)
 *
 * 単一責任:
 * - 現場端末における配布活動（Activity）のライフサイクル管理
 * - 下書き（Draft）状態の生成、GPS測位結果の適用、および破棄
 * - 提出ワークフロー調整（SUBMITTING ➔ enqueue ➔ polling ➔ outcome判定）
 * - 送信キュー状態とポイント状態の調停（reconcileQueueState）
 * - 待機中ピンの復元（restorePendingState）
 * - Queue 実行結果に基づくポイント状態遷移（applyQueueOutcome）
 *
 * 厳格な制約:
 * - DOM/Map/UI/Globals への直接依存は一切禁止
 * - 外部ストレージへの直接参照禁止
 * - 状態公開は厳密に 8 つの承認メソッドのみ。内部状態オブジェクトや getSnapshot() は露出しない
 * - Classic-script lexical binding (window/global property export なし)
 */
const ActivityModule = (() => {
  /**
   * 1. 下書き作成 (枚数・写真撮影受領後に DRAFT 確定)
   * @param {Object} point
   * @param {Object|number|string} countOrOptions - options object { valNum, staffName, staffId, timeStr, tempPhotoUrl, photoBase64 } or count
   * @param {Object} [maybeStaffInfo] - { staffName, staffId, completedAt }
   * @param {string} [maybePhotoData] - Base64 data
   * @param {string} [maybeTempPhotoUrl] - Blob URL
   * @returns {Object} point
   */
  function createDraft(point, countOrOptions, maybeStaffInfo, maybePhotoData, maybeTempPhotoUrl, maybeLockId) {
    if (!point) return point;
    let count, staffInfo, photoData, tempPhotoUrl, lockId;
    if (typeof countOrOptions === 'object' && countOrOptions !== null) {
      count = countOrOptions.valNum ?? countOrOptions.count ?? 0;
      staffInfo = {
        staffName: countOrOptions.staffName,
        staffId: countOrOptions.staffId,
        completedAt: countOrOptions.timeStr ?? countOrOptions.completedAt
      };
      photoData = countOrOptions.photoBase64 ?? countOrOptions.photoData;
      tempPhotoUrl = countOrOptions.tempPhotoUrl;
      lockId = countOrOptions.lockId;
    } else {
      count = countOrOptions;
      staffInfo = maybeStaffInfo;
      photoData = maybePhotoData;
      tempPhotoUrl = maybeTempPhotoUrl;
      lockId = maybeLockId;
    }

    const num = parseFloat(count) || 0;
    const hasPhoto = Boolean(photoData && photoData.length > 0);

    point.isDone = false;
    point.isReadyToSubmit = hasPhoto;
    point.count = num;
    point.staffName = staffInfo?.staffName || '';
    point.staffId = staffInfo?.staffId || '';
    point.completedAt = staffInfo?.completedAt || '';
    point.syncStatus = 'pending';
    point.gpsStatus = 'pending';
    point.photoStatus = hasPhoto ? 'OK' : 'NONE';
    point.tempPhotoUrl = tempPhotoUrl || undefined;
    point.photoBase64 = photoData || undefined;
    if (lockId !== undefined && lockId !== null && String(lockId).trim() !== '') {
      point.lockId = String(lockId).trim();
    }

    return point;
  }

  /**
   * 2. GPS 測位結果の適用 (Current HEAD Runtime セマンティクス遵守)
   * @param {Object} point
   * @param {Object} gpsData - { latitude, longitude, accuracy }
   * @returns {Object} point
   */
  function applyGpsResult(point, gpsData) {
    if (!point) return point;
    const latNum = Number(gpsData?.latitude);
    const lngNum = Number(gpsData?.longitude);
    const hasValidGps =
      Number.isFinite(latNum) &&
      Number.isFinite(lngNum) &&
      latNum !== 0 &&
      lngNum !== 0 &&
      latNum >= -90 && latNum <= 90 &&
      lngNum >= -180 && lngNum <= 180;

    if (!hasValidGps) {
      console.warn("GPS acquisition failed or out of range.");
      point.gpsStatus = 'NO';
    } else {
      point.gpsStatus = 'OK';
      point.gps = `${gpsData.latitude},${gpsData.longitude}`;
      point.latitude = gpsData.latitude;
      point.longitude = gpsData.longitude;
      point.accuracy = gpsData.accuracy || null;
      if (gpsData.gpsTimestamp) {
        point.gpsTimestamp = gpsData.gpsTimestamp;
      }
    }

    return point;
  }

  /**
   * 3. 活動下書きの破棄 (キャンセル時)
   * @param {Object} point
   * @returns {Object} point
   */
  function resetDraft(point) {
    if (!point) return point;
    point.isDone = false;
    point.count = 0;
    point.staffName = '';
    point.staffId = '';
    point.completedAt = '';
    point.syncStatus = '';
    point.photoStatus = 'NONE';
    point.gpsStatus = 'NO';
    point.gps = '';
    point.latitude = '';
    point.longitude = '';
    point.accuracy = null;
    delete point.tempPhotoUrl;
    delete point.photoBase64;
    delete point.lockId;
    return point;
  }

  /**
   * 4. 提出ライフサイクルの実行
   * @param {Object} point
   * @param {Object} options - { areaName, branchCode }
   * @param {Object} hooks - DI hooks
   * @returns {Promise<{ success: boolean, status?: string, reason?: string, error?: any }>}
   */
  async function submitActivity(point, options, hooks) {
    if (!point) return { success: false, reason: 'POINT_NOT_FOUND' };
    const currentHooks = hooks || {};

    // 1. 完了済みガード
    if (typeof currentHooks.isAlreadyCompleted === 'function' && currentHooks.isAlreadyCompleted(point.rowId)) {
      return { success: false, reason: 'ALREADY_COMPLETED' };
    }

    // 2. 多重送信ガード
    if (point.syncStatus === 'submitting') {
      return { success: false, reason: 'ALREADY_SUBMITTING' };
    }
    point.syncStatus = 'submitting';

    // 3. 写真必須チェック (基準コード順序: 写真不備時はボタン操作・alertなし・isDone代入なしで pending に戻して終了)
    if (point.photoStatus !== 'OK' || !point.photoBase64) {
      point.syncStatus = 'pending';
      return { success: false, reason: 'INVALID_PHOTO' };
    }

    // 4. UI排他ロック通知 & 提出開始時描画待ち (表示側での描画待ち完了を非同期待機)
    if (typeof currentHooks.onSubmitting === 'function') {
      await currentHooks.onSubmitting();
    }

    try {
      // 5. GPS完了待機
      if (typeof currentHooks.waitGps === 'function') {
        await currentHooks.waitGps();
      }

      // 6. Identity認証待機
      try {
        if (typeof currentHooks.authorize === 'function') {
          await currentHooks.authorize();
        }
      } catch (authErr) {
        point.syncStatus = 'failed';
        point.isDone = false;
        if (typeof currentHooks.onError === 'function') {
          currentHooks.onError(authErr, 'AUTH_FAILED');
        }
        return { success: false, reason: 'AUTH_FAILED', error: authErr };
      }

      // 7. 担当者解決
      const verifiedUser = (typeof currentHooks.getVerifiedUser === 'function')
        ? currentHooks.getVerifiedUser()
        : {};
      const finalStaffId = verifiedUser.staffId || point.staffId || '';
      const finalStaffName = verifiedUser.staffName || point.staffName || '';

      // 8. 識別子発番
      const requestId = (typeof currentHooks.generateRequestId === 'function')
        ? currentHooks.generateRequestId('req')
        : ('req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
      const clientEventId = requestId;

      // 9. ペイロード構築
      const branchCode = (typeof currentHooks.getBranchCode === 'function')
        ? currentHooks.getBranchCode()
        : (options?.branchCode || '');

      const resolvedLockId = String((options && options.lockId) || point.lockId || '').trim();
      if (resolvedLockId) {
        point.lockId = resolvedLockId;
      }

      const payload = {
        requestId,
        areaName: options?.areaName,
        clientEventId,
        rowId: Number(point.rowId),
        lockId: resolvedLockId,
        isDone: true,
        count: point.count || 0,
        latitude: point.gpsStatus === 'OK' ? (point.latitude || '') : '',
        longitude: point.gpsStatus === 'OK' ? (point.longitude || '') : '',
        accuracy: point.gpsStatus === 'OK' ? (point.accuracy || null) : null,
        gpsTimestamp: point.gpsStatus === 'OK' ? (point.gpsTimestamp || '') : '',
        gpsStatusReason: point.gpsStatus || 'NO',
        branchCode,
        areaId: String(point.rowId),
        photoBase64: point.photoBase64 || '',
        staffName: finalStaffName,
        staffId: finalStaffId
      };

      // 10. キュー永続化 (Fail-Closed: 提出フローの必須 dependency)
      if (typeof currentHooks.enqueue !== 'function') {
        throw new Error('enqueue hook is missing');
      }
      await currentHooks.enqueue(payload);

      // 11. オフライン判定
      const isOnline = (typeof currentHooks.isOnline === 'function')
        ? currentHooks.isOnline()
        : false;

      if (!isOnline) {
        point.syncStatus = 'pending';
        point.isDone = false;
        if (typeof currentHooks.onOfflineQueued === 'function') {
          currentHooks.onOfflineQueued();
        }
        return { success: true, status: 'OFFLINE_QUEUED' };
      }

      // 12. オンライン時 最大15秒ポーリング (テスト都合の可変化を全廃した固定契約)
      const maxWaitMs = 15000;
      const pollIntervalMs = 500;
      const startTime = Date.now();
      let isPersisted = false;

      while (Date.now() - startTime < maxWaitMs) {
        if (typeof currentHooks.getRowStatus !== 'function') {
          throw new Error('getRowStatus hook is missing');
        }
        const status = await currentHooks.getRowStatus(Number(point.rowId));

        if (status === null) {
          // キューから削除された
          if (point.syncStatus === 'REJECTED') {
            point.isDone = false;
            delete point.isReadyToSubmit;
            delete point.tempPhotoUrl;
            delete point.syncStatus;
            if (typeof currentHooks.onRejected === 'function') {
              currentHooks.onRejected({ code: 'STALE_MONTH' });
            }
            return { success: false, reason: 'REJECTED' };
          }

          const isCompleted = (typeof currentHooks.isPinCompleted === 'function')
            ? currentHooks.isPinCompleted(point.rowId)
            : false;

          if (isCompleted) {
            point.isDone = true;
          }

          if (point.isDone === true) {
            delete point.isReadyToSubmit;
            point.syncStatus = 'synced';
            isPersisted = true;
            if (typeof currentHooks.onAccepted === 'function') {
              currentHooks.onAccepted({ photoUrl: point.photoUrl });
            }
            break;
          }
        }

        if (status === 'FAILED_PERMANENT') {
          point.isDone = false;
          point.syncStatus = 'FAILED_PERMANENT';
          if (typeof currentHooks.onError === 'function') {
            currentHooks.onError(new Error('Permanent submission failure'), 'FAILED_PERMANENT');
          }
          return { success: false, reason: 'FAILED_PERMANENT' };
        }

        if (status === 'RETRY') {
          throw new Error('GAS Save Failed');
        }

        await new Promise(r => setTimeout(r, pollIntervalMs));
      }

      if (isPersisted) {
        return { success: true, status: 'ACCEPTED' };
      } else {
        point.syncStatus = 'pending';
        point.isDone = false;
        if (typeof currentHooks.onTimeout === 'function') {
          currentHooks.onTimeout();
        }
        return { success: true, status: 'TIMEOUT' };
      }

    } catch (err) {
      point.syncStatus = 'pending';
      point.isDone = false;
      if (typeof currentHooks.onError === 'function') {
        currentHooks.onError(err, 'SUBMISSION_FAILED');
      }
      return { success: false, reason: 'SUBMISSION_FAILED', error: err };
    } finally {
      if (typeof currentHooks.onFinally === 'function') {
        currentHooks.onFinally();
      }
    }
  }

  /**
   * 5. キュー状態との調停 (triggerUISyncRefresh からの委譲)
   * @param {Array<Object>} points
   * @param {Array<Object>} queueItems
   */
  function reconcileQueueState(points, queueItems) {
    if (!Array.isArray(points)) return;
    const queue = Array.isArray(queueItems) ? queueItems : [];

    points.forEach(p => {
      // 提出処理中のポイントは上書き保護
      if (p.syncStatus === 'submitting') return;

      const found = queue.find(q => Number(q.rowId) === Number(p.rowId));
      if (found) {
        p.syncStatus = found.syncStatus || found.status;
        if (found.lockId && !p.lockId) {
          p.lockId = String(found.lockId);
        }
      } else {
        if (p.syncStatus === 'REJECTED') {
          p.isDone = false;
          delete p.isReadyToSubmit;
          delete p.tempPhotoUrl;
          delete p.lockId;
        } else if (p.isDone === true) {
          delete p.isReadyToSubmit;
          delete p.tempPhotoUrl;
          delete p.syncStatus;
          delete p.lockId;
        } else if (!p.isDone) {
          delete p.syncStatus;
        }
      }
    });
  }

  /**
   * 6. 待機中キューからの状態復元 (loadData 起動時)
   * @param {Array<Object>} points
   * @param {Array<number|Object>} pendingRowIds
   */
  function restorePendingState(points, pendingRowIds) {
    if (!Array.isArray(points) || !Array.isArray(pendingRowIds)) return;
    pendingRowIds.forEach(entry => {
      const isObj = typeof entry === 'object' && entry !== null;
      const rowId = isObj ? entry.rowId : entry;
      const status = isObj ? (entry.syncStatus || entry.status || 'pending') : 'pending';
      const lockId = isObj && entry.lockId ? String(entry.lockId).trim() : '';
      const pt = points.find(p => Number(p.rowId) === Number(rowId));
      if (pt && !pt.isDone) {
        pt.syncStatus = status;
        if (lockId) {
          pt.lockId = lockId;
        }
      }
    });
  }

  /**
   * 7. 【明示的単一状態遷移入口】Queue 実行結果の Point への反映
   * @param {Object} point
   * @param {Object} outcome - { type: 'ACCEPTED'|'REJECTED'|'FAILED'|'RETRY_RESET', res?, item?, finalStatus? }
   */
  function applyQueueOutcome(point, outcome) {
    if (!point || !outcome) return;
    switch (outcome.type) {
      case 'ACCEPTED':
        point.isDone = true;
        delete point.isReadyToSubmit;
        point.syncStatus = undefined;
        point.photoUrl = outcome.res?.photoUrl || '';
        if (outcome.item?.latitude && outcome.item?.longitude) {
          point.gps = `${outcome.item.latitude},${outcome.item.longitude}`;
        }
        delete point.tempPhotoUrl;
        delete point.lockId;
        break;
      case 'REJECTED':
        point.syncStatus = 'REJECTED';
        delete point.isReadyToSubmit;
        delete point.tempPhotoUrl;
        delete point.lockId;
        break;
      case 'FAILED':
        point.syncStatus = outcome.finalStatus;
        break;
      case 'RETRY_RESET':
        point.syncStatus = 'PENDING';
        break;
    }
  }

  /**
   * 8. 下書き開始非同期ワークフロー (写真受領 ➔ Draft生成 ➔ GPS測位 ➔ 完了通知)
   * 画面・DOM・端末APIへの直接依存は持たず、純粋な非同期オーケストレーションと状態適用を担当する。
   * @param {Object} point
   * @param {Object} options - { valNum, staffName, staffId, timeStr, lockId, cameraPromise, gpsPromise }
   * @param {Object} hooks - { isSessionValid, blobToBase64, createObjectURL, getGPSLocationRetry, onDraftReady, onGpsReady, onFinally }
   */
  async function startDraftWorkflow(point, options, hooks) {
    if (!options || !hooks) return;
    const { valNum, staffName, staffId, timeStr, lockId, cameraPromise, gpsPromise } = options;
    const { isSessionValid, blobToBase64, createObjectURL, getGPSLocationRetry, onDraftReady, onGpsReady, onFinally } = hooks;

    try {
      if (!point) {
        console.warn("Target point is missing. Draft creation aborted.");
        return;
      }

      let imageBlob = null;
      try {
        if (cameraPromise) {
          imageBlob = await cameraPromise;
        }
      } catch (err) {
        console.error("Camera activation failed:", err);
      }

      // 非同期処理完了後の有効性確認 1 (写真受領後)
      if (typeof isSessionValid === 'function' && !isSessionValid()) return;

      // カメラ取消・失敗判定
      if (!imageBlob || typeof blobToBase64 !== 'function') {
        console.warn("Photo capture cancelled or failed. Draft creation aborted.");
        return;
      }

      let photoBase64 = '';
      try {
        photoBase64 = await blobToBase64(imageBlob);
      } catch (err) {
        console.warn("Photo Base64 conversion threw an error.", err);
      }

      // 非同期処理完了後の有効性確認 2 (Base64変換後)
      if (typeof isSessionValid === 'function' && !isSessionValid()) return;
      if (!photoBase64) {
        console.warn("Photo Base64 conversion returned empty data. Draft creation aborted.");
        return;
      }

      // 3. 写真確定後に下書き状態を生成（GPSは待たない）
      const tempPhotoUrl = typeof createObjectURL === 'function' ? createObjectURL(imageBlob) : undefined;
      createDraft(point, {
        valNum,
        staffName,
        staffId,
        timeStr,
        lockId,
        tempPhotoUrl,
        photoBase64
      });

      // 再描画通知 1 (DRAFT プレビュー)
      if (typeof onDraftReady === 'function') {
        onDraftReady(point);
      }

      // 4. バックグラウンドで GPS 結果を待機
      let gps = null;
      if (gpsPromise) {
        gps = await gpsPromise;
      }

      // 既存の再取得条件を維持: GPSが空の場合は1回再試行
      if ((!gps || !gps.latitude || !gps.longitude) && typeof getGPSLocationRetry === 'function') {
        console.log("GPS empty after camera, retrying...");
        gps = await getGPSLocationRetry();
      }

      // 非同期処理完了後の有効性確認 3 (GPS完了後)
      if (typeof isSessionValid === 'function' && !isSessionValid()) return;

      // 5. GPS 結果を適用（空結果・測位失敗時も applyGpsResult に渡し、従来の gpsStatus = 'NO' 遷移を維持）
      applyGpsResult(point, gps);

      // 再描画通知 2 (GPS 確定)
      if (typeof onGpsReady === 'function') {
        onGpsReady(point);
      }
    } catch (err) {
      console.error("Async draft workflow task failed:", err);
    } finally {
      if (typeof onFinally === 'function') {
        onFinally();
      }
    }
  }

  return {
    createDraft,
    applyGpsResult,
    resetDraft,
    submitActivity,
    reconcileQueueState,
    restorePendingState,
    applyQueueOutcome,
    startDraftWorkflow
  };
})();
