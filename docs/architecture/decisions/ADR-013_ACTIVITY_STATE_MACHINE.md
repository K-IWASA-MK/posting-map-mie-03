# ADR-013: Activity State Machine, 状態整合性モデルおよび実績確定条件 (Activity State Machine, State Consistency Model and Achievement Finalization Conditions)

- **Status**: ACCEPTED (OFFICIAL SPECIFICATION)
- **Date**: 2026-09-25
- **Deciders**: Universal POSTING MAP Architecture Board / MASTER
- **Consulted**: `AGENTS.md`, `docs/architecture/01_DESIGN_CONTRACT.md`, `docs/architecture/decisions/ADR-011_POSTING_FLOW_SPECIFICATION.md`, `docs/architecture/decisions/ADR-012_DURABLE_QUEUE_SPECIFICATION.md`, `active/h-app/`, `active/business/`

---

## 1. Context (背景と目的)

Universal POSTING MAP 再構築において、Phase 8 (HアプリCore)、Phase 9 (Posting Flow)、Phase 10 (Durable Queue) の完了を受け、マスタープラン原本 (`docs/architecture/01_DESIGN_CONTRACT.md` 第9.2節、第10節、第11節、および Phase 11) に従い、**Phase 11: Activity State Machine** の正式仕様を制定する。

本ADRの目的は、UI状態（Hアプリ画面・マーカー・モーダル）、送信キュー状態（IndexedDB Durable Queue）、API状態（GAS受付・排他ロック）、およびDB状態（Google Spreadsheet [配布実績YYYY-MM]・Google Drive）のライフサイクルを完全に一致させ、個人ランキングの集計元となる活動実績の確定条件、各識別子の役割、および既存業務ルールを明文化・固定することにある。

---

## 2. Decision (決定事項)

### (1) 識別子の役割と対応関係 (原本仕様の不変維持)

各IDの定義および役割を以下のように厳格に定義する。勝手な同一視や概念の矮小化・独自解釈を永久に禁止する。

| 識別子 | 定義と役割 | 生成主体 / 保存先 | 原本仕様との関係 |
|---|---|---|---|
| `rowId` / `areaId` | 自治体内の町丁・小地域を一意に特定する連番主キー (1..N)。スプレッドシート行番号と1対1に対応。 | マスターCSV / 境界GeoJSON / Spreadsheet A列 | 地理・台帳空間の主キー |
| `clientEventId` | 活動送信ごとに端末側で生成される**不変の冪等性キー (Idempotency Key)**。同一活動送信のリトライや通信切断時の二重登録を排除するための識別子。**「同じ地区を同月に2回配布するための識別子」ではない**。 | クライアント端末 / Payload | 原本 第11節 準拠 |
| `requestId` | クライアント側の各送信意図・キュー内アイテムを一意に追跡・ログ照合するための不変操作識別子。 | クライアント端末 (IndexedDB `syncQueue`) | ADR-012 準拠 |
| `activityId` | サーバー側（Backend）で永続化が成功し確定した活動実績実体の一意の識別子。 | Backend / Spreadsheet / 実績ログ | 原本 第9.2節 準拠 |

**【clientEventId と requestId の対応関係】**:
- 原本仕様の `clientEventId`（冪等性キー）の定義は一切変更しない。
- クライアント側で生成する `requestId` は、端末内キューおよび送信トラッキングの不変操作キーであり、API送信時には `clientEventId` としてもペイロードに透過的に対応付け（`clientEventId: requestId`）を行い、サーバー側冪等性担保の入力値として機能させる。
- 両者を安易に単一概念へ融合・統合せず、それぞれのレイヤーにおける責務境界を維持する。

---

### (2) 活動ログ状態遷移マシン (Activity State Machine)

UI・キュー・API・DB間で以下の状態遷移モデル（State Transition Model）を厳格に適用する。

```text
[1. UNTOUCHED] (未着手 / 未操作)
       │ ピン色: 緑 (#10B981)
       │ バブル: 「詳細地図」「配布開始」ボタン表示
       │
       │ ピンタップ ➔ 自端末選択中
       ▼
[2. IN_PROGRESS] (操作受付 / 自端末選択中)
       │ ピン色: 青 (#00B7FF)
       │ PinStatus<Key>: setPinStatus (PinStatusModule.reportInProgress / PinStatusService.updatePinStatus)
       │
       │ 「配布開始」タップ ➔ 詳細モーダル ➔ テンキー枚数入力 ➔ 写真撮影・GPS取得
       ▼
[3. DRAFT (READY_TO_SUBMIT)] (下書き確認 / ローカル保存)
       │ p.isDone = false (未完了維持)
       │ p.isReadyToSubmit = true (提出前確認)
       │ ピン色: 青 (#00B7FF)
       │ モーダル: 提出前プレビュー表示
       │ ※ この段階でアプリ終了・キャンセルした場合、完了には昇格しない
       │
       │ 「🚀 この内容で提出する」タップ ➔ submitMissionComplete
       ▼
[4. SUBMITTING] (送信中 / 排他ロック)
       │ p.syncStatus = 'submitting'
       │ UI: ボタン非活性化 (多重送信防止)
       │ enqueueSync({ requestId, clientEventId, rowId, ... }) ➔ IndexedDB保存
       │
       ├─【通信中 / オフライン】
       │      │
       │      ▼
       │  [5. PENDING / RETRY_WAIT] (同期待ち / 指数バックオフ)
       │      ・p.syncStatus = 'pending'
       │      ・p.isDone = false (未完了維持)
       │      ・IndexedDB syncQueue に保持され、バックグラウンド自動再送
       │      ・画面は即座に解放
       │
       ├─【AUTH ERROR】
       │      │
       │      ▼
       │  [6. AUTH_FAILED] (認証失敗 / 要確認)
       │      ・p.syncStatus = 'failed'
       │      ・p.isDone = false (未完了維持)
       │      ・恒久エラーとして再送信ボタンを再活性化
       │
       ├─【Backend SUCCESS & ACCEPTED (getRowStatus === null && res.success === true && res.accepted !== false)】
       │      │
       │      ▼
       │  [7. COMPLETED] (活動確定 / 配布完了!)
       │      ・p.isDone = true (正式確定)
       │      ・globalPinStatus.completed.push(rowId)
       │      ・globalPinStatus.inProgress.remove(rowId)
       │      ・lockActivePinAndBubble(rowId)
       │      ・ピン色: 橙 (#EA5F08) 🔒
       │      ・バブル: 「配布済み 🔒」(操作ボタン非表示・完全ロック)
       │      ・Spreadsheet [配布実績YYYY-MM] D列〜Q列 永続化完了
       │
       └─【Backend REJECTED (res.accepted === false / STALE_MONTH)】
              │
              ▼
          [7-B. REJECTED_TERMINATED] (旧月等・非受諾終端)
              ・p.isDone = false (未完了維持)
              ・dequeueSync(item.id) (Queueから削除して再試行終了)
              ・Current Sheet再読込 (最新状態へ復帰)
```

---

### (3) 完了確定条件 (Backend Persistence Confirmed as Single Source of Truth)

**配布完了（COMPLETED）の唯一の確定条件は、「Backend永続化成功および受諾確認（`res.success === true && res.accepted !== false`）」とする。**

以下の状態はいずれも完了（COMPLETED）ではない：
1. テンキーで枚数を確定した状態 ≠ COMPLETED
2. 写真撮影およびGPS取得が完了した状態 ≠ COMPLETED (DRAFT)
3. IndexedDB の送信キューに登録された状態 ≠ COMPLETED (PENDING)
4. HTTP リクエストを送信中の状態 ≠ COMPLETED (SUBMITTING)
5. オフラインで端末内に退避された状態 ≠ COMPLETED (PENDING)
6. STALE_MONTH 等によりサーバーで非受諾となった状態 (`res.accepted === false`) ≠ COMPLETED (キュー終端だが未完了維持)

Backend API からの受諾成功応答（`res.success === true && res.accepted !== false`）を受信し、Durable Queue からレコードが安全にデキュー（`dequeueSync` / `getRowStatus === null`）された瞬間にのみ、UIおよびメモリの `p.isDone = true` を確定させ、完了ピン（橙色ロック）へと昇格させる（旧月送信等の `res.accepted === false` / `STALE_MONTH` の場合は、Queueから削除されるが COMPLETED には昇格せず通常未完了へ復帰する）。

---

### (4) 既存業務ルールの維持と保証

POSTING MAP のフィールドワークにおける以下の業務ルールを厳格に維持する。

#### ルール1: 完了確定した地区は「当月再操作不可」
- 当月シート（`配布実績YYYY-MM`）に `completedAt` が記録された `rowId` は、月内において完了確定状態（`COMPLETED`）を維持する。
- `PinStatusModule`（`syncFromSnapshot` / `applyPinStatus`）により `window.globalPinStatus.completed` に登録され、ピンアイコンは橙色（`#EA5F08`）にロックされる。
- ピンをタップした際、カスタム情報ウィンドウ（バブル）には「配布済み 🔒」のみが表示され、「詳細地図」や「配布開始」等の操作ボタンは一切表示されず、再操作は物理的に遮断される。
- 月が更新された場合（翌月1日 0:00 JST）、`MonthlySheetResolver` により翌月シートが新設・参照されるため、完了ロックは自動的に解除され新月の配布が可能となる。

#### ルール2: 完了できなかった地区（未完了）は「翌日0:00以降に再操作可能」
- 写真撮影・GPS取得後の DRAFT 状態でアプリを終了した場合、またはオフライン・送信エラーで完了確定（Backend書き込み）に至らなかった地区は、未完了（`UNTOUCHED` または `DRAFT`）のままとする。
- `配布実績YYYY-MM` には `completedAt` が記録されないため、`globalPinStatus.completed` には入らない。
- 日付が翌日（0:00 JST）を跨いだ場合でも、当月内の未完了地区として翌日以降に改めてピンをタップし、「配布開始」から再操作・完了報告を行うことができる。

---

### (5) 個人ランキング集計確定条件

個人ランキング（`DistributionRepository.fetchRankingData`）の集計仕様を以下のように確定する。

1. **集計データソース**:
   - 当月の `配布実績YYYY-MM` シートのみを集計元とする。
2. **確定行の必須抽出条件**:
   - `completedAt`（D列: 配布完了日時）が空でないこと。
   - `groupKey`（P列: 認証済み `lineUserId` を最優先、未設定の場合は F列: `staffId`）が存在すること。
   - `count`（E列: 配布枚数）が 0 より大きい数値（`count > 0`）であること。
3. **未確定データの完全除外**:
   - DRAFT、SUBMITTING、PENDING 状態のデータは `配布実績YYYY-MM` に書き込まれていない、または `completedAt` が空であるため、ランキング集計対象から物理的に除外される。
4. **集計ロジック**:
   - 同一 `groupKey` ごとに `count` を単純合算し、降順で順位付けを行う。

---

## 3. Consequences & Compliance (影響と遵守事項)

- **Universal 原則遵守**: 本仕様は共通Runtime（Universal Engine `active/**`）の全地区共通基底ルールとして機能し、地区固有の条件分岐を一切含まない。
- **データ不可侵**: `data/address_master.csv` および `data/boundaries.geojson` は直前の `7bf64d3` で確定済みであり、本ADRによる変更は一切加えない。
- **外部接続不可侵**: 旧KUWANAの外部接続切替には一切触れない。
- **Phase 8〜10 互換性**: 既存の `db.js`、`gps_service.js`、`gps_repository.js`、`distribution_repository.js` の堅牢な設計を100%継承し、回帰障害を発生させない。
