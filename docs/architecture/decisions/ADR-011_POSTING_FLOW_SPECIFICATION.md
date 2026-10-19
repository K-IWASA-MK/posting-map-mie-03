# ADR-011: Hアプリ Posting Flow 仕様確定および状態遷移モデル (Posting Flow Specification and State Transition Model)

- **Status**: ACCEPTED (OFFICIAL SPECIFICATION)
- **Date**: 2026-09-24
- **Deciders**: Universal POSTING MAP Architecture Board / MASTER
- **Consulted**: `AGENTS.md`, `docs/architecture/01_DESIGN_CONTRACT.md`, `docs/api/API_CONTRACT.md`, `docs/architecture/decisions/ADR-009_H_APP_CORE_SPECIFICATION.md`, `active/h-app/`

---

## 1. Context (背景と課題)

Phase 8「HアプリCore」の完了を受け、Phase 9「Posting Flow（オンライン配布完了登録フロー）」の仕様を確定する。
READ ONLY監査において、現行コードベース（`active/h-app/`）の Posting パイプラインを精査した結果、以下の構造が確認された：

1. **現行パイプラインの健全性**:
   - `openPointDetailModal` ➔ `openNumpad` ➔ `pressNum('OK')` ➔ 写真・GPS確認 ➔ `submitMissionComplete` ➔ `enqueueSync` ➔ `processQueue` ➔ `updateRecordWithGPSPhoto` (GAS) ➔ `配布実績YYYY-MM` (Spreadsheet)
   - このパイプラインはすでに本番環境で実稼働しており、排他ロック（15秒）、Identity強制解決、Drive写真保存、月次シート動的解決が完全に機能している。
2. **課題: 状態遷移における「配布完了」確定条件の曖昧さ**:
   - 現行実装では、写真撮影完了の段階で `p.isDone = true` がセットされており、ユーザーが「提出する」ボタンを押す前（あるいはAPI送信が失敗した場合）であっても、メモリ上で「完了」として扱われる潜在的リスクが存在した。
   - 「写真・GPS取得完了」はあくまで提出前の「下書き確認（DRAFT / READY_TO_SUBMIT）」であり、「配布完了（COMPLETED）」ではない。
   - 真の「配布完了（COMPLETED）」は、**Backend永続化成功（Spreadsheet [配布実績YYYY-MM] への書き込み完了）** を唯一の確定条件としなければならない。

---

## 2. Decision (決定内容)

### (1) 実装方針: 方針1（最小侵襲・既存フロー温存型）の正式採用
- 現行の `submitMissionComplete` ➔ `enqueueSync` ➔ `processQueue` ➔ `updateRecordWithGPSPhoto` パイプラインを完全維持する（その後 Wave 4 / Wave 7 にて `active/h-app/modules/activity.js` `ActivityModule` へオーケストレーション責務を移管完了）。
- `submitDistribution` は将来拡張用stubとして削除・改変せず温存する。
- `requestId` ベースの冪等性移行はPhase 10へ送り、Phase 9 時点では現行の `rowId` ベースの排他制御を維持する（Phase 10 にて Q列 `requestId` 照合として実装・検証完了済み）。
- 写真/GPSの現行必須フローは変更しない。
- IndexedDB Queue（`PostingMapDB`）そのものの再設計は行わず、Phase 10のOffline/Durable Queueへ境界を残す。

### (2) 厳格な状態遷移モデルの確立

```text
[1. UNTOUCHED] (未着手 / マーカー緑)
       │ マーカータップ
       ▼
[2. IN_PROGRESS] (自端末選択中 / マーカー青)
       │ 「配布開始」➔「入力操作」タップ
       ▼
[3. MODAL_OPEN] (詳細モーダル展開: openPointDetailModal)
       │ 「OK」タップ
       ▼
[4. NUMPAD_ACTIVE] (枚数入力中: openNumpad / pressNum)
       │ テンキー「OK」タップ
       ▼
[5. READY_TO_SUBMIT (DRAFT)] (提出確認 / 写真・GPS取得完了)
       │ ※ 重要: この時点では p.isDone は確定させない (COMPLETED = false)
       │
       │ 「🚀 この内容で提出する」タップ ➔ submitMissionComplete
       ▼
[6. SUBMITTING] (送信中 / ボタン非活性化 / 多重送信ロック)
       │ enqueueSync ➔ processQueue ➔ updateRecordWithGPSPhoto
       │
       ├─【Backend SUCCESS & ACCEPTED (getRowStatus === null && p.syncStatus !== 'REJECTED')】
       │      │
       │      ▼
       │  [7. COMPLETED] (配布完了確定!)
       │      ・p.isDone = true (正式確定)
       │      ・globalPinStatus.completed.push(rowId)
       │      ・lockActivePinAndBubble(rowId) (ピン橙色化 🔒)
       │      ・モーダルクローズ & 完了アラート
       │
       ├─【Backend REJECTED (res.accepted === false / STALE_MONTH)】
       │      │
       │      ▼
       │  [7-B. REJECTED_TERMINATED] (旧月等・非受諾終端)
       │      ・COMPLETED = false (完了化しない)
       │      ・Queueから削除 (dequeueSync) して再試行終了
       │      ・Current Sheet再読込
       │
       ├─【AUTH ERROR】
       │      │
       │      ▼
       │  [8. AUTH_FAILED] (認証失敗)
       │      ・COMPLETED = false
       │      ・再提出ロック解除 & アラート
       │
       └─【API ERROR (RETRY)】
              │
              ▼
          [9. RETRY_WAIT] (送信失敗)
              ・COMPLETED = false (配布済みにしない)
              ・ボタン再活性化 ➔ 再提出可能状態へ復元
```

- **データ本体とプレビューUIの分離**:
  - 写真・GPS取得完了時、データ本体は `p.isDone = false` および `p.isReadyToSubmit = true` を維持し、絶対に完了確定させない。
  - モーダル内のみ提出前確認画面（MISSION COMPLETED / 提出ボタン）を表示するため、`renderDetailModalContent({ ...p, isDone: true })` と一時的なプレビューオブジェクトを渡す。
  - 提出せずにモーダルを閉じた場合やキャンセル時は、データ本体の `p.isDone` が元から `false` であるため、未提出ピンが配布済みとして誤認される可能性を物理的にゼロとする。
  - Backend保存成功（`status === null`）時に初めて、データ本体の `p.isDone = true` を正式確定し、`isReadyToSubmit` を消去し、`globalPinStatus.completed` への追加およびピンロックを実行する。

### (3) Queue消滅と完了確定条件（COMPLETED）の厳密な定義
現行 `db.js` および `app.js` の実装に基づき、Queue消滅と完了確定の因果関係を以下のように確定する：
- `getRowStatus(rowId)` は、IndexedDB の `syncQueue`（当月Queue）を探索し、対象アイテムが存在する間は `'PENDING'`, `'SYNCING'`, `'RETRY'` を返す。
- アイテムがキューから削除（`dequeueSync`）されるのは、`callApiPost('updateRecordWithGPSPhoto')` が `res.success === true` で応答した際である。
- ただし、旧月送信等による `res.accepted === false`（STALE_MONTH 等）の場合も再試行不要として `dequeueSync` される。この場合、対象ピンは `p.syncStatus = 'REJECTED'` となり、COMPLETED には昇格せず通常未完了へ復帰する。
- したがって、**Queue消滅（`getRowStatus === null`）単独ではCOMPLETED確定条件にならず、「Backend受諾成功（`res.success === true && res.accepted !== false`）」を確認した瞬間のみが真の完了確定（COMPLETED）である**。

### (4) Phase境界の厳格な分離

| フェーズ | 責務範囲 | 含まないもの |
|---|---|---|
| **Phase 8 (Core)** | 地図描画、マーカー、2段階タップ、`openPointDetailModal` 展開 | 枚数確定、Backend送信、実績永続化 |
| **Phase 9 (Posting Flow)** | `openPointDetailModal` ➔ 枚数入力 ➔ 写真/GPS確認 ➔ 送信 ➔ Backend永続化 ➔ COMPLETED確定 | オフライン時のキュー退避保証、オフライン再送ループ、Durable Queue |
| **Phase 10 (Offline Queue)**| 圏外・オフライン時の IndexedDB 退避保証、指数バックオフループ、Durable Queue | - |

---

## 3. Consequences (影響と効果)

### 肯定的な結果
1. **配布実績の真実性の保証**:
   - Backendへの書き込みが完了する前にUIが「完了」と誤認される不整合が100%排除される。
2. **最小侵襲とリグレッション排除**:
   - 稼働実績のある `db.js` やバックエンドサービスを変更せず、`app.js` の確定条件のみを正しく整流化するため、高い安全性が維持される。
3. **Phase 10への無矛盾な接続**:
   - オフラインキューの再設計に手を付けず、オンライン完了フローの整合性を確立した上で、次フェーズへ円滑に引き継ぐことができる。
