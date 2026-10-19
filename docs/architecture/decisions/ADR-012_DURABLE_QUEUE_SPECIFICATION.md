# ADR-012: Durable Queue Specification (堅牢な永続キュー仕様)

## 状態
承認済み (Approved) — Phase 10 実装

## 文脈 (Context)
POSTING MAP のフィールドワーク（ポスティング配布現場）では、地下、建物間、郊外などの電波微弱エリアや一時的オフライン環境において配布完了報告（GPS・写真・配布枚数）を安全に受け付け、オフライン復旧時やアプリ再起動時にもデータを絶対に消失・重複させずバックエンド（GAS/スプレッドシート）へ永続化することが求められる。

Phase 9 では「写真・GPS取得完了 ≠ COMPLETED」「Backend永続化成功のみが真の完了」という因果関係を確立した。
Phase 10 では、この因果関係を支えるクライアント側の送信キューについて、以下の設計原則・運用境界を確立する。

## 決定事項 (Decisions)

### 1. IndexedDB スキーマとバージョン管理
- **データベース名**: `PostingMapDB`
- **オブジェクトストア名**: `syncQueue` (keyPath: `'id'`, autoIncrement: true)
- **スキーマバージョン**: `DB_VERSION = 2` を維持する（v3 へのアップグレードや drop/recreate は禁止）。
- **既存データ互換性**: 既存レコードに `requestId` 等の新設フィールドが存在しない場合でも、エラーなく読み取り・処理・復旧を継続できること。

### 2. トランザクション境界と重複防止 (rowId-level Deduplication)
- **単一 readwrite トランザクション境界**:
  `enqueueSync(item)` 実行時、同一トランザクション内で既存キューの走査（`store.getAll()`）とレコード追加（`store.add()`）を不可分に実行する。
  分離された `getQueue()` → 判定 → `add()` による競合窓（race window）の発生を防止する。
- **重複キューイング抑止 (月単位 rowId-level Deduplication)**:
  同一JST月かつ同一 `rowId` を持つアイテムが既にキュー内に存在する場合、新たなレコード追加を行わず、既存レコードの ID を返却して即時送信（`processQueue()`）を促す。別月の同一 `rowId` は新月操作として共存を許容する。

### 3. クライアント側不変操作識別子 (requestId) と Backend 冪等性連携
- **役割**: クライアント側の各送信意図を一意に特定する不変操作識別子（UUID/プレフィックス付きタイムスタンプ）とする。
- **Backend 冪等性連携 (Phase ②-B)**: API payload へ渡され、Backend側で Q列照合による duplicate 判定（同一操作の重複排除）および D列照合による alreadyCompleted 判定（当月完了行の上書き防止）に使用される。

### 4. COMPLETED 因果関係の絶対順序
キュー処理時、以下の因果関係とライフサイクル順序を厳格に維持する：
```
1. [Backend persistence & acceptance confirmed] (res.success === true && res.accepted !== false 受信)
       ↓
2. [dequeueSync()] (IndexedDB syncQueue からレコード削除)
       ↓
3. [COMPLETED 確定] (UI / メモリキャッシュに同期完了を反映)
       ↓
4. [p.isDone = true] (配布ポイント完了フラグ確定)
       ↓
5. [完了ピン・ロック] (UI上のピン完了化およびロック)
```

以下の状態はいずれも COMPLETED ではない：
- `enqueue 成功` ≠ COMPLETED
- `HTTP request 送信` ≠ COMPLETED
- `SUBMITTING` ≠ COMPLETED
- `QUEUE_PENDING` ≠ COMPLETED
- `RETRY_WAIT` ≠ COMPLETED
- `REJECTED (res.accepted === false / STALE_MONTH)` ≠ COMPLETED (キュー終端だが未完了維持)

### 5. 指数バックオフと強制終了復旧 (Crash Recovery)
- **リトライ間隔**: 10秒 → 30秒 → 60秒 → 60秒 → 60秒 (最大5回)。
- **強制終了・クラッシュ復旧**:
  ブラウザの強制終了やタブ閉じにより `SYNCING` 状態で中断されたレコードは、次回起動時または `processQueue()` 実行時に自動検出され、即時再送対象として安全に復旧・送信される。
- **待機ピン復元 (`getSyncQueueRowIds`) と月跨ぎライフサイクル権限**:
  起動時やデータロード時、Clientは `syncQueue` に存在する未終端アイテムを月を理由に隠さず、`getSyncQueueRowIds()` / `getRowStatus()` / `manualRetrySync()` / `triggerUISyncRefresh()` の対象として状態を復元・維持する。ELECTION / SUBSCRIPTION の月跨ぎ受理判定は Backend Authority とし、SUBSCRIPTION 旧月アイテムは `STALE_MONTH`（`accepted: false`）で terminal dequeue され（非COMPLETED）、ELECTION 旧月アイテムは同一 Active Dataset 上で継続・受理可能とする。

### 6. オフラインUI即時解放と待機制御
- **オフライン提出**:
  `enqueueSync` 成功後、オフライン時は待機せず即座にモーダルを閉じて画面を解放する（UIフリーズの完全防止）。
- **オンライン提出**:
  最大15秒間の上限待機時間を設け、タイムアウト時もバックグラウンド送信に引き継いでモーダルを解放し、通常操作へ即座に復帰可能とする。
- **完了AuthorityとUI状態同期の責務分離 (`triggerUISyncRefresh`)**:
  Queue消滅単独では COMPLETED に昇格しない（Queue消滅だけを根拠にした完了推測は禁止）。Backend accepted（`p.isDone = true` または `globalPinStatus.completed` への反映）のみを完了Authorityとする。`triggerUISyncRefresh()` はバックグラウンド送信状態（SYNCING / RETRY / FAILED_PERMANENT）の UI 状態同期のみを担当する。非受諾（`p.syncStatus === 'REJECTED'`）の場合は安全に未完了状態へ復帰させる。

## 影響・遵守事項 (Consequences & Compliance)
- Universal 原則を遵守し、地区名や専用ロジックを一切含まない。
- Phase ②-B で確立された月次1行固定モデルおよび Q列 requestId 冪等性モデルと完全整合する。
