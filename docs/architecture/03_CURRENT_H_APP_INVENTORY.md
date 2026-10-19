# 現行Hアプリ構造台帳 (Current H-App & System Inventory)
## Universal POSTING MAP Architecture Ledger — Current Runtime Synchronized (`f608033f`)

> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §19, Gate 1 出口基準）に基づき、
> リポジトリ内の全既存資産（コード、データ、シート構造、設定、スクリプト、テスト）の実測・現物棚卸し結果および
> 4分類（🟢 継承 / 🔴 廃止済 / 🟡 再構築完了 / 🔵 要検証）を Final Runtime HEAD（`f608033f76129b77e7ee06ca055e0be0ebb1db9e`）に同期記録した公式台帳である。

---

## 1. 現物計測サマリ（実測値）

リポジトリ内の全資産を実ファイルから直接再計測した結果は以下の通りである。

### (1) コード規模・ファイル数サマリ

| 領域 | ファイル数 | 実行テキスト行数 (`wc -l`) | バイト数 | 主な構成・言語 |
|---|---|---|---|---|
| **Hアプリ (配布員用モバイルUI)** | 23ファイル (22テキスト + 1画像) | **8,187行** (※1) | 377,507 bytes | HTML, JS, CSS, PNG |
| **Manager Dashboard (管理者UI)** | 2ファイル | **3,979行** | 164,987 bytes | HTML, JS (Leaflet, Tailwind) |
| **APIルーター・認証 (`active/api/`)** | 4ファイル | **922行** | 38,314 bytes | GAS / JS (V8) |
| **ドメイン業務ロジック (`active/business/`)** | 21ファイル | **3,789行** | 141,252 bytes | GAS / JS (9業務ドメイン) |
| **GASコア・運用基盤 (`active/gas/`)** | 6ファイル | **942行** | 31,412 bytes | GAS / JS (バッチ・展開・移行) |
| **インフラアダプター (`active/infrastructure/`)** | 4ファイル | **165行** | 4,768 bytes | GAS / JS (Spreadsheet, Drive, Lock, Cache) |
| **GASマニフェスト (`active/appsscript.json`)** | 1ファイル | **16行** (※2) | 495 bytes | JSON (OAuth Scopes, V8) |
| **`active/` 配下 小計 (テキスト全60ファイル)** | **61ファイル** (60テキスト + 1画像) | **18,000行** (※3) | 758,735 bytes | 実行アプリケーション中核 |
| **マスターデータ・設定 (`data/`)** | 12ファイル (10ルート + 2 `raw_reference`) | 1,701行 (`address_master.csv`) + GeoJSON | — | CSV, GeoJSON, JSON, JS |
| **検証・運用スクリプト (`scripts/`)** | **28ファイル** | — | — | Node.js (`.mjs`), Python (`.py`) |
| **自動検証テストスイート (`tests/`)** | **38ファイル** | — | — | Node.js Test Runner (`.mjs`) |
| **リポジトリ全体 (Git追跡ファイル数)** | **214ファイル** (`git ls-files` 実測値) | — | — | 全体資産 (※4) |

> ※1: Hアプリは `active/h-app` 配下の22テキストファイルと1バイナリ画像（`icon180-v2.png`: 32,020 bytes）の合計。`app.js` は **1,426行**、`render.js` は **2,440行**、`db.js` は **486行**。Hアプリ全体のテキスト行数は **8,187行**。
> ※2: `active/appsscript.json` は末尾に改行コードが無いため、`wc -l`（改行数）では 16行となる。
> ※3: 内訳合計: 8,187 (Hアプリ) + 3,979 (Manager) + 5,834 (Backend 36テキストファイル小計: `api` 922 + `business` 3,789 + `gas` 942 + `infrastructure` 165 + `appsscript.json` 16) = **18,000行** となり、`wc -l $(find active -type f ! -name "*.png")` 実測値と完全に一致する。ルート `index.html`（43行, 1,419 bytes）を含めるとクライアント＋バックエンド全体で **18,043行**。
> ※4: Final Runtime HEAD における `git ls-files` 実測値 **214ファイル** である。

---

## 2. データベース現物構造（地区専用 Spreadsheet DB / ADR-024 Dual Lifecycle 準拠）

`active/business/system/district_provisioner.js`、`monthly_sheet_resolver.js`、`bulletin_service.js`、および ADR-024 に基づく実シート構成：

### (1) システム管理シート（1シート）
- **`SYSTEM_INFO`**: 2列（A〜B列: 項目・内容）＋ 14標準設定キー・バリュー（地区コード、地区名、HアプリURL、Dashboard URL、LIFFアプリ名、LIFF ID、LIFF URL、Endpoint URL、Manager認証パスワード、状態、契約終了日、**運用モード**、**Active Dataset Key**、**契約開始日時**）＋ 16行目拡張 `GOOGLE_MAPS_API_KEY`（`A1:B16` 保護対象）。

### (2) 実運用データセット（5シート: ELECTION固定 または SUBSCRIPTION月次）
- **ELECTION モード**: 契約開始日時に確定した固定 Dataset Key（例: `2026-10`）を用い、契約終了日まで同一の 5 シートを継続使用する（月次リセット禁止）。
- **SUBSCRIPTION モード**: 現在年月（`YYYY-MM`）を用い、毎月新しい 5 シートを直接生成し過去月は履歴保持する。
- ※第1世代の原本5種（マスターテンプレート）は ADR-024 により完全撤廃され、新規プロビジョニングでは生成されない。
1. **`配布実績<Key>`**: 17列 `[ID, 市町村, 町域, 配布完了日時, 配布枚数, 担当者ID, 担当者名, GPS, 写真, 緯度, 経度, GPS日時, 写真ファイルID, 写真URL, 写真日時, lineUserId, requestId]`
2. **`名簿<Key>`**: 4列 `[ID, 名前, LINE_USER_ID, 登録日時]`
3. **`保有チラシ枚数<Key>`**: 7列 `[ID, 担当者ID, 担当者名, 保管場所, 保有枚数, 最終更新日時, lineUserId]`
4. **`受渡要請履歴<Key>`**: 14列 `[日時, 要請者, 要請者ID, 保管者, 保管者ID, 連絡方法, 連絡先, 状態, requestId, LINE送信状態, LINE HTTP status, LINE送信日時, requesterLineUserId, holderLineUserId]`
5. **`PinStatus<Key>`**: 2列 `[rowId, status]`

### (3) 現場コミュニケーション・履歴シート群（2シート: 任意）
1. **`掲示板`**: 5列 `[日時, 投稿者ID, 投稿者名, メッセージ, lineUserId]`
2. **`掲示板連絡履歴`**: 10列 `[日時, 送信者ID, 送信者名, 相手ID, 連絡方法, 連絡先, requestId, LINE送信状態, LINE HTTP status, LINE送信日時]`

---

## 3. 全資産の4分類台帳 (Classification Ledger)

`01_DESIGN_CONTRACT.md` §19 に基づき、現有全資産を以下の基準で分類する。
- 🟢 **継承**: 現行の優れたUI/UX、現場思想、確立されたコア機能。
- 🔴 **廃止済**: 削除・撤廃が完了した旧地区複製モデルの残骸・ゾンビコード（Current Tree 不在）。
- 🟡 **再構築完了**: Universal POSTING MAP（1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独DB = 付属1地区専用GAS）および Target Architecture B' へ適合済みのコアモジュール。
- 🔵 **要検証**: 現場での利用実態・非機能要件・負荷耐性の継続観測項目。

### (1) Frontend — Hアプリ (`active/h-app/`, `index.html`)

- **Script Load Order (`active/h-app/index.html`)**:
  `data/config.js` → `area/address_master_service.js` → `db.js` → `components/{navigation,ranking,staff,sync-status}.js` → `modules/{device,api,auth,summary,navigation,storage,ranking,bulletin,pin-status,activity,transfer,staff-registration}.js` → `render.js` → `app.js`

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `index.html` (ルート) | 43 | 1,419 | 🟢 継承 | ルートリダイレクトおよびLIFFエントリ。 |
| `active/h-app/index.html` | 372 | 17,679 | 🟢 継承 | HアプリのメインDOM。ブラック基調のプレミアムUI、下部ナビゲーション、モーダル構造、20スクリプト順序定義。 |
| `active/h-app/style.css` | 700 | 17,775 | 🟢 継承 | グラスモフィズム、ネオモルフィズム、タッチアニメーション等のデザインシステム。 |
| `active/h-app/tailwind-utils.css` | 321 | 21,945 | 🟢 継承 | オフライン稼働・高速レンダリングのためのTailwind事前生成CSS。 |
| `active/h-app/app.js` | 1,426 | 62,159 | 🟡 再構築完了 | Target Architecture B' に基づく Composition Root（Wave 1〜17 分離完了、Dead Code 除去後 1,426行）。Boot/Bootstrap、DI配線（`setApiAuthGates`, `setQueueLifecycleGates`）、Google Maps ライフサイクル、各 Feature Module と View の結合を担当。 |
| `active/h-app/render.js` | 2,440 | 122,943 | 🟡 再構築完了 | Google Maps ピン・ポリゴン・モーダル描画、および `NumpadView` / `StorageView` / `BulletinView` / `TransferView` / `RankingView` / `StaffRegistrationView` の Presentation 層を集約。 |
| `active/h-app/db.js` | 486 | 21,508 | 🟢 継承 | IndexedDB オフライン送信キュー（`PostingMapDB` -> `syncQueue`）。配布完了送信（`updateRecordWithGPSPhoto`）の先行永続化、指数バックオフ再送（10s/30s/60s/60s）、4固定フック連携、DI Gate 受領を担当。 |
| `active/h-app/components/navigation.js` | 50 | 2,477 | 🟢 継承 | `renderBottomNavigation` — 現場目線の2層（Tier1/Tier2）ボトムナビゲーションHTML生成。 |
| `active/h-app/components/ranking.js` | 72 | 3,131 | 🟢 継承 | `renderRankingCard(rankingData, myStaffId, mySummary)` — 個人ランキングカードの純粋関数描画（グローバル状態非依存）。 |
| `active/h-app/components/staff.js` | 253 | 12,188 | 🟢 継承 | `renderStaffCard`, `initCardGyro`, `StaffIdInfoView` — デジタル配布員証およびID情報モーダル。 |
| `active/h-app/components/sync-status.js` | 51 | 2,003 | 🟢 継承 | `SyncStatusView` — ヘッダー通信状態（ONLINE / OFFLINE / SYNCING）Presentation Component。 |
| `active/h-app/modules/api.js` | 238 | 8,926 | 🟡 再構築完了 | `callApiPost`, `setApiAuthGates`, `fetchMunicipalityMaster`, `fetchStorageLocations`, `fetchElectionHistory`, `fetchAreaMapping` — 通信制御およびマスター読込。 |
| `active/h-app/modules/device.js` | 122 | 4,043 | 🟢 継承 | `getGPSLocation`, `compressImage` — 高精度GPS取得およびクライアント側画像圧縮。 |
| `active/h-app/modules/navigation.js` | 124 | 5,090 | 🟢 継承 | `switchPage`, `restoreMapStateIfNeeded` — 画面遷移・スクロール位置保持・ナビ切り替え。 |
| `active/h-app/modules/storage.js` | 120 | 4,845 | 🟢 継承 | `StorageModule` — チラシ在庫・保管場所データアクセス（`saveHold` 経由の `updateFlyerStock` オンライン送信、キャッシュ管理）。 |
| `active/h-app/modules/ranking.js` | 63 | 2,340 | 🟢 継承 | `RankingModule` — ランキングデータ・本人サマリ・In-flight Promise のカプセル化管理（`fetchRanking`, `getSnapshot`）。 |
| `active/h-app/modules/bulletin.js` | 322 | 11,996 | 🟢 継承 | `BulletinModule` — 掲示板投稿取得・作成・連絡送信・送信ロック・認可世代セッション確認。 |
| `active/h-app/modules/pin-status.js` | 142 | 5,112 | 🟢 継承 | `PinStatusModule` — 作業中・完了ピンの排他制御・キャッシュ同期・`setPinStatus` 通知。 |
| `active/h-app/modules/activity.js` | 497 | 19,930 | 🟢 継承 | `ActivityModule` — 活動ログライフサイクル、Draft作成・破棄、`requestId` (`clientEventId`) 生成、Queue調停、`startDraftWorkflow`。 |
| `active/h-app/modules/transfer.js` | 228 | 8,579 | 🟢 継承 | `TransferModule` — 受渡要請セッション世代管理、連絡先バリデーション、Pre-Auth送信前ロック、API送信調整。 |
| `active/h-app/modules/staff-registration.js` | 78 | 2,922 | 🟢 継承 | `StaffRegistrationModule` — 初回スタッフ登録状態・多重呼出し防止・Hooks管理。 |
| `active/h-app/modules/auth.js` | 149 | 6,368 | 🟢 継承 | `AuthModule` — LIFF認証状態、本人確認State、同期Promise、Gate所有権、Atomic Setter管理。 |
| `active/h-app/modules/summary.js` | 40 | 1,528 | 🟢 継承 | `SummaryModule` — `lastSummaryData` および `_systemSummaryPromise` のカプセル化管理。 |
| `active/h-app/assets/icon180-v2.png` | binary | 32,020 | 🟢 継承 | PWA / LIFF 用公式アプリアイコン。 |

### (2) Frontend — Manager Dashboard (`active/manager/`)

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/manager/index.html` | 665 | 35,342 | 🟢 継承 | 管理者向けダッシュボードDOM。7画面構成（`overview`, `records`, `stocks`, `roster`, `requests`, `bulletin`, `mail`）。 |
| `active/manager/manager.js` | 3,314 | 129,645 | 🟡 再構築完了 | 管理者業務ロジック。Google Maps 連携、6桁PINサーバーセッション認証（`verifyManagerPassword` / `logoutManager`）、スナップショット観測、CSV出力。 |

### (3) Backend API & 認証 (`active/api/`)

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/api/v2_api.js` | 695 | 30,277 | 🟡 再構築完了 | `doGet`/`doPost`/`processPostAction` エントリポイント。5層認可境界（Public / Dashboard Manager / Dual-Audience / Unregistered Staff / Active Staff）、`verifyIntegrityGuard`（`SYSTEM_INFO` 地区コード照合 + 契約期限検証）、全22 POSTアクション＋GETヘルスチェックを統制。 |
| `active/api/AssetRegistry.js` | 73 | 2,208 | 🟢 継承 | `AssetRegistry` — 静的アセット・設定レジストリ。 |
| `active/api/auth/auth.js` | 83 | 3,128 | 🟡 再構築完了 | `authenticateRequest`, `verifyLiffAccessToken` — LINE Profile API (`GET https://api.line.me/v2/profile`) トークン検証および `CacheService` SHA-256 キャッシュ（30分）。 |
| `active/api/auth/session.js` | 71 | 2,701 | 🟢 継承 | `createDashboardSession`, `verifyDashboardSession`, `revokeDashboardSession` — Dashboard 6桁PINセッション管理（TTL 6時間・地区バインド）。 |

### (4) Backend ドメイン業務ロジック (`active/business/`)

| ドメイン / ファイル | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `area/address_master_service.js` | 109 | 3,667 | 🟢 継承 | `AddressMasterService` — 住所マスターCSVの読込・パース・自治体別町丁目クエリSSOT（ブラウザ/GAS両対応）。 |
| `area/area_repository.js` | 53 | 1,929 | 🟢 継承 | `AreaRepository` — エリアデータの検索・取得リポジトリ（`findByAreaName`, `getAllAreas`）。 |
| `area/area_service.js` | 36 | 1,105 | 🟢 継承 | `AreaService` — エリア詳細情報提供サービス（`getAreaDetails`）。 |
| `area/tier1_service.js` | 76 | 2,523 | 🟢 継承 | `Tier1Service` — 自治体別集計（`getTier1Summary`）提供サービス。 |
| `bulletin/bulletin_service.js` | 358 | 13,522 | 🔵 要検証 | `BulletinService` — 掲示板投稿・連絡履歴管理（`getPosts`, `createPost`, `sendContact`）。 |
| `distribution/distribution_model.js` | 57 | 1,704 | 🟢 継承 | `DistributionEvent` — 配布実績データモデル（設計上の論理エンティティ名 `DistributionRecord` に対応）。 |
| `distribution/distribution_repository.js` | 252 | 9,745 | 🟢 継承 | `DistributionRepository` — 配布実績保存（`save`）、最新履歴（`fetchLatest`）、統計（`fetchDeliveryStats`）、ランキング集計（`fetchRankingData`）。 |
| `distribution/distribution_service.js` | 91 | 2,994 | 🟢 継承 | `DistributionService` — 配布実績登録・取得サービス（`recordDistribution`, `getLatestRecords`, `getDeliveryStats`, `getRanking`）。 |
| `flyer/flyer_repository.js` | 131 | 4,768 | 🟢 継承 | `FlyerRepository` — チラシ在庫データアクセス（`getAllStocks`, `upsertStock`）。 |
| `flyer/flyer_service.js` | 31 | 946 | 🟢 継承 | `FlyerService` — チラシ在庫取得・更新サービス（`getStockSummary`, `updateStock`）。 |
| `gps/gps_repository.js` | 179 | 7,764 | 🟢 継承 | `GPSRepository` — Drive証跡写真保存（`savePhotoToDrive`）および配布実績行更新（`updateDistributionRow`）。 |
| `gps/gps_service.js` | 88 | 3,662 | 🟢 継承 | `GPSService` — 15秒排他ロック（`waitLock(15000)`）、日本国内GPS座標境界検証、Q列 `requestId` 冪等性・D列 `alreadyCompleted` 判定（`updateRecordWithGPSPhoto`）。 |
| `pin/pin_status_service.js` | 74 | 2,718 | 🟢 継承 | `PinStatusService` — ピンのリアルタイム作業中・完了状態管理（`getPinStatus`, `updatePinStatus`）。 |
| `staff/staff_model.js` | 56 | 1,665 | 🟢 継承 | `Staff` — 配布員データモデル。 |
| `staff/staff_repository.js` | 128 | 4,765 | 🟢 継承 | `StaffRepository` — 名簿シートへの読み書きリポジトリ（`findById`, `findByLineUserId`, `getNextSequenceNumber`, `save`, `findAll`）。 |
| `staff/staff_service.js` | 145 | 5,455 | 🟢 継承 | `StaffService` — 配布員登録、LINE User IDからのIdentity強制解決（`resolveStaffIdentity`, `getStaffIdentity`, `registerStaff`, `getRoster`）。 |
| `system/district_provisioner.js` | 670 | 25,651 | 🟢 継承 | `DistrictProvisioner` — ADR-024 準拠のデータセット自動ロールオーバー（`rolloverMonthlySheets`）、実運用5シートの初期作成・同期、`SYSTEM_INFO` 初期生成を担うプロビジョニング実装。 |
| `system/monthly_sheet_resolver.js` | 67 | 2,535 | 🟢 継承 | `MonthlySheetResolver` — アクティブデータセット名（`<Key>` / `YYYY-MM`）の厳格な参照解決SSOT。 |
| `system/system_info_service.js` | 329 | 12,350 | 🟢 継承 | `SystemInfoService` — `SYSTEM_INFO` シートの管理、契約期間チェック、管理者認証、運用モード解決。 |
| `system/system_summary_service.js` | 91 | 3,453 | 🟢 継承 | `SystemSummaryService` — システム全体の進捗・統計サマリ提供（`getSummary`）。 |
| `transfer/transfer_service.js` | 358 | 13,604 | 🔵 要検証 | `TransferService` — チラシ受渡要請サービス（`requestTransfer`, `getTransferRequests`, `resolveTransferRequest`）。 |
| `active/business/*` 削除済み・不在確認 | — | — | 🔴 廃止済 | 旧メソッド `AddressMasterService.getTowns`, `AddressMasterService.search`, `AreaRepository.findByRowId`, `DistributionService.getRankingData`, `PinStatusService.getGlobalPinStatus`, `PinStatusService.setPinInProgress`, `StaffRepository.findByName`, `StaffRepository.findByNameAndApp`, `StaffRepository.updateLineUserIdAtRow`, `SystemSummaryService.refreshAreaSummaryCache` は Cleanup Mission により完全削除済み。 |

### (5) Backend GAS運用・移行基盤 (`active/gas/`)

| ファイル | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/gas/sheet_guard.js` | 106 | 3,522 | 🟢 継承 | `SheetGuard` — スプレッドシート構造保護・シート検証。 |
| `active/gas/v2_batch.js` | 162 | 5,451 | 🟢 継承 | 定期バッチ・月次ロールオーバートリガー処理（`v2_dailyBatch`, `v2_monthlyRolloverBatch`）。 |
| `active/gas/v2_config.js` | 112 | 3,661 | 🟡 再構築完了 | `V2_CONFIG`, `getConfigValue` — スクリプトプロパティ取得・設定。 |
| `active/gas/v2_extract.js` | 149 | 4,849 | 🟢 継承 | データ抽出ユーティリティ。 |
| `active/gas/v2_map.js` | 145 | 4,764 | 🟢 継承 | 座標計算・マップデータ補助。 |
| `active/gas/v2_migration.js` | 228 | 7,827 | 🟡 再構築完了 | カラム・スキーママイグレーションユーティリティ。 |
| `active/gas/v2_core.js` / `v2_deployment_foundation.js` / `v2_stats.js` | — | — | 🔴 廃止済 | 旧複製モデル用スクリプトおよび未使用ユーティリティは物理削除済み（Current Tree 不在）。 |

### (6) インフラアダプター (`active/infrastructure/`)

| ファイル | 行数 (`wc -l`) | バイト数 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/infrastructure/cache/cache_adapter.js` | 41 | 1,073 | 🟢 継承 | `CacheAdapter` — GAS `CacheService` ラッパー。 |
| `active/infrastructure/drive/drive_adapter.js` | 25 | 708 | 🟢 継承 | `DriveAdapter` — GAS `DriveApp` ラッパー。 |
| `active/infrastructure/lock/lock_adapter.js` | 36 | 1,004 | 🟢 継承 | `LockServiceProvider` — GAS `LockService` 排他制御ラッパー（デフォルト10秒）。 |
| `active/infrastructure/spreadsheet/spreadsheet_adapter.js` | 63 | 1,983 | 🟢 継承 | `SpreadsheetResolver`, `getSS` — 1地区専用DB解決アダプター（`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()`）。旧 `SpreadsheetRepository` / `SpreadsheetBatchReader` / `SpreadsheetBatchWriter` は削除済み。 |

### (7) マスターデータ・設定 (`data/`)

| ファイル | 規模 | 分類 | 分類理由・現物根拠 |
|---|---|---|---|
| `data/address_master.csv` | 1,701行 (ヘッダ1 + 1,700町丁目) | 🟢 継承 | 公式住所（位置参照情報・ABR）および国勢調査小地域に基づく8列アドレスマスターSSOT。 |
| `data/address_master_provenance.json` | 495行 | 🟢 継承 | アドレスマスター生成元の一次資料・件数・ハッシュ追跡Provenance。 |
| `data/boundaries.geojson` | GeoJSON | 🔵 要検証 | 町丁目境界ポリゴンデータ。モバイルでの描画パフォーマンスの継続観測対象。 |
| `data/boundaries_provenance.json` | 38行 | 🟢 継承 | 境界GeoJSON生成元の一次資料・件数追跡Provenance。 |
| `data/municipality_master.csv` | 9行 (ヘッダ1 + 8自治体) | 🟢 継承 | 対象地区の構成自治体一覧（`<city_name>,<city_code>,<total_towns>`）。 |
| `data/config.js` | 21行 | 🟢 継承 | クライアント接続設定（`districtId`, `gasWebAppUrl`, `liffId` 等）。 |
| `data/storage_locations.json` | 10行 | 🟢 継承 | チラシ保管場所の自治体候補リスト。 |
| `data/election_history.json` | 124行 | 🔵 要検証 | 過去の衆議院選挙得票実績データ。 |
| `data/election_history_provenance.json` | 68行 | 🟢 継承 | 選挙実績データの公式選管資料Provenance。 |
| `data/area_mapping.json` | 1行 (`[]`) | 🟢 継承 | エリア実績マッピングメタデータ（新規地区標準の空配列 `[]`）。 |
| `data/raw_reference/` | 2ファイル (`README.md`, `official_ward_town_lists.json`) | 🟢 継承 | 公式町字一覧リファレンス（旧 `data/raw_estat_r2/` バイナリ群はGit履歴肥大化防止のため排除済み）。 |

### (8) 開発・検証・運用スクリプト (`scripts/` — 全28ファイル)

| カテゴリ | スクリプト一覧 | 分類 | 役割・現物根拠 |
|---|---|---|---|
| **Governance & Gate Scripts (8種)** | `check-entrance-gate.mjs`, `check-auditor-gate.mjs`, `check-cleanup-gate.mjs`, `check-knowledge-gate.mjs`, `check-architecture-gate.mjs`, `check-scope.mjs`, `check-secrets.mjs`, `check-universal-invariants.mjs` | 🟢 継承 | Stage 0 / Stage 4 / Stage 5 / Stage 9 の機械検証ゲート群（`package.json` 連動）。 |
| **District Provisioning & Data Pipeline (8種)** | `generate-address-master.mjs`, `generate-boundaries-geojson.py`, `sort-address-master.py`, `validate-district-data-gate.mjs`, `init-district-spreadsheet-master.mjs`, `verify-spreadsheet-master-sync.mjs`, `setup-mie03-spreadsheet.mjs`, `inspect-spreadsheet-state.mjs` | 🟢 継承 | アドレスマスター・境界GeoJSON生成、Master Triad検証、Spreadsheet DB初期化・同期検証。 |
| **Deploy & Runtime Verification (7種)** | `safe-deploy.mjs`, `clasp-Runner.mjs`, `verify-gas-Binding.mjs`, `verify-gas-Deployment.mjs`, `verify-production-Endpoints.mjs`, `verify-remote-Sync.mjs`, `run-tests-Isolated.mjs` | 🟢 継承 | Clasp 安全配備、GAS バインド・デプロイ検証、本番エンドポイント疎通確認、並列分離テストランナー。 |
| **Local Server & Browser Smoke (5種)** | `serve.mjs`, `test_browser_h_app.mjs`, `test_browser_h_app_full.mjs`, `test_browser_h_app_smoke.mjs`, `verify_sec007_browser_e2e.mjs` | 🟢 継承 | ローカル開発サーバーおよび Headless Browser 実機スモーク・E2E検証。 |
| **削除済み旧スクリプト** | `check-universal-boundary.mjs`, `verify-runtime-integrity.mjs`, `run-gemini-auditor.mjs`, `provision-district.mjs`, `sync-deployment-config.mjs`, `check-pre-copy-purity.mjs`, `check-provisioning-gate.mjs`, `test-copy-simulation.mjs` | 🔴 廃止済 | 旧複製モデル用または統合済みスクリプト（Current Tree から物理削除済み）。 |

### (9) 自動検証テストスイート (`tests/` — 全38ファイル)

- `npm test`（`node scripts/run-tests-Isolated.mjs`）により以下の **38テストファイル** が分離実行され、全件 PASS が保証されている：
  - **Phase / Domain Suites**: `test_phase9_backend_domain.mjs`, `test_phase10_durable_idempotency.mjs`, `test_phase11_activity_state_machine.mjs`, `test_phase12_dashboard_analytics.mjs`, `test_phase13_security_hardening.mjs`, `test_phase14_observability_monitoring.mjs`, `test_phase15_deployment_automation.mjs`, `test_phase16_testing_verification.mjs`, `test_phase17_production_readiness.mjs`, `test_phase18_post_launch_ops.mjs`
  - **H-App Wave Refactoring Suites**: `test_happ_storage_extraction.mjs`, `test_happ_bulletin_extraction.mjs`, `test_happ_pinstatus_extraction.mjs`, `test_happ_activity_extraction.mjs`, `test_happ_transfer_extraction.mjs`, `test_happ_numpad_extraction.mjs`, `test_happ_draft_start_extraction.mjs`, `test_happ_id_info_modal_extraction.mjs`, `test_happ_storage_view_extraction.mjs`, `test_happ_ranking_extraction.mjs`, `test_happ_bulletin_modal_extraction.mjs`, `test_happ_staff_registration_extraction.mjs`, `test_happ_api_auth_gate_di.mjs`, `test_happ_db_lifecycle_gate_di.mjs`, `test_happ_auth_module_extraction.mjs`, `test_happ_summary_module_extraction.mjs`, `test_happ_sync_status_component_extraction.mjs`
  - **Security, Provisioning & Governance Suites**: `test_sec001_dashboard_auth_fix.mjs`, `test_sec007_maps_api_key_isolation.mjs`, `test_adr024_dual_lifecycle_mode.mjs`, `test_registry_provisioning_gate.mjs`, `test_spreadsheet_binding_priority.mjs`, `test_universal_master_triad_gate.mjs`, `test_address_master_generation_skill.mjs`, `test_district_app_deployment_skill.mjs`, `test_entrance_gate.mjs`, `test_auditor_gate.mjs`, `test_cleanup_gate.mjs`

---

## 4. 🔵 要検証項目（Pending Verification Items）

推測による独断判定を排除し、継続的に実機検証・運用観測を行う項目は以下の **4点** である。

1. **掲示板（Bulletin）機能の現場運用性**:
   - `active/business/bulletin/bulletin_service.js`（358行）および `active/h-app/modules/bulletin.js`（322行）。
   - 検証項目: 配布員間のメッセージ交換が実際の活動で有効に機能しているか、不適切な投稿や個人情報露出のリスクはないか、通知インフラの負荷。
2. **チラシ受渡要請（Transfer）機能とLINE Push通知**:
   - `active/business/transfer/transfer_service.js`（358行）および `active/h-app/modules/transfer.js`（228行）。
   - 検証項目: LINE Messaging API によるプッシュ通知送信の月間クォータ消費、送信失敗時のリトライ・フォールバック仕様、当事者間連絡の成立実態。
3. **境界GeoJSON描画パフォーマンス（モバイル低スペック端末耐性）**:
   - `data/boundaries.geojson` および `active/h-app/render.js`（2,440行）。
   - 検証項目: スマートフォン（特に低スペック機や通信制限下）において、Google Maps 上でのポリゴン描画負荷、ズーム操作時のFPS低下、メモリ消費量の限界値。
4. **過去選挙実績データ（`election_history.json`）の機能的有用性**:
   - `data/election_history.json`（124行）。
   - 検証項目: HアプリまたはDashboardでの参照実態、今後の選挙戦略機能としての必要性。
