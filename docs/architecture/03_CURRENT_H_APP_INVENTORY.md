# 現行Hアプリ構造台帳 (Current H-App & System Inventory)
## Universal POSTING MAP Architecture Ledger — Current Runtime Synchronized (`f608033f`)

> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §19, Gate 1 出口基準）に基づき、
> リポジトリ内の全既存資産（コード、データ、シート構造、設定、スクリプト、テスト）の実測・現物棚卸し結果および
> 4分類（🟢 継承 / 🔴 廃止済 / 🟡 再構築完了 / 🔵 要検証）を Final Runtime HEAD（`f608033f76129b77e7ee06ca055e0be0ebb1db9e`）に同期記録した公式台帳である。

---

## 1. 現物計測サマリ（実測値）

リポジトリ内の全資産を実ファイルから直接機械計測した結果は以下の通りである。

### (1) コード規模・ファイル数サマリ

| 領域 | ファイル数 | 実行テキスト行数 (`wc -l`) | バイト数 (`wc -c`) | 主な構成・言語 |
|---|---|---|---|---|
| **Hアプリ (配布員用モバイルUI: `active/h-app/`)** | 23ファイル (22テキスト + 1画像) | **9,098行** (※1) | 376,679 bytes (テキスト 345,452 + PNG 31,227) | HTML, JS, CSS, PNG |
| **Manager Dashboard (管理者UI: `active/manager/`)** | 4ファイル | **4,518行** (※2) | 222,408 bytes | HTML, JS, CSS (Leaflet, Tailwind) |
| **APIルーター・認証 (`active/api/`)** | 4ファイル | **1,603行** | 66,535 bytes | GAS / JS (V8) |
| **ドメイン業務ロジック (`active/business/`)** | 21ファイル | **4,496行** | 181,619 bytes | GAS / JS (9業務ドメイン) |
| **GASコア・運用基盤 (`active/gas/`)** | 6ファイル | **1,512行** | 52,634 bytes | GAS / JS (バッチ・展開基盤・移行) |
| **インフラアダプター (`active/infrastructure/`)** | 4ファイル | **234行** | 7,771 bytes | GAS / JS (Spreadsheet, Drive, Lock, Cache) |
| **GASマニフェスト (`active/appsscript.json`)** | 1ファイル | **16行** (※3) | 495 bytes | JSON (OAuth Scopes, V8) |
| **`active/` 配下 小計 (全63ファイル)** | **63ファイル** (62テキスト + 1画像) | **21,491行** (※4) | 908,141 bytes (テキスト 866,914 + PNG 31,227) | 実行アプリケーション中核 |
| **ルートエントリ (`index.html`)** | 1ファイル | **42行** | 1,876 bytes | HTML (ルートリダイレクト・エントリ) |
| **マスターデータ・設定 (`data/`)** | **12ファイル** (7ルート + 5 `raw_reference/<city_code>/`) | 910行 (`address_master.csv`) + GeoJSON等 | 14,218,285 bytes | CSV, GeoJSON, JSON, JS, XML, HTML, ZIP |
| **検証・運用スクリプト (`scripts/`)** | **30ファイル** | — | — | Node.js (`.mjs`), Python (`.py`) |
| **自動検証テストスイート (`tests/`)** | **58ファイル** (Active 49スイート) | — | — | Node.js Test Runner (`.mjs`) |
| **リポジトリ全体 (Git追跡ファイル数)** | **268ファイル** (`git ls-files` 実測値) | — | — | 全体資産 (※5) |

> ※1: Hアプリは `active/h-app/` 配下の22テキストファイル（`wc -l` 合計 **9,098行**, 345,452 bytes）と1バイナリ画像（`active/h-app/assets/icon180-v2.png`: 31,227 bytes）の合計。`app.js` は **1,426行**（54,282 bytes）、`render.js` は **2,597行**（109,823 bytes）、`db.js` は **486行**（18,385 bytes）。
> ※2: Manager Dashboard は `active/manager/index.html`（1,061行, 52,912 bytes）、`active/manager/manager.js`（3,454行, 142,647 bytes）、`active/manager/tailwind-input.css`（3行, 59 bytes）、`active/manager/assets/manager.tailwind.css`（末尾改行なし単一行のため `wc -l` は 0行, 26,790 bytes）の4ファイル構成（`wc -l` 小計 **4,518行**）。
> ※3: `active/appsscript.json` は末尾に改行コードが無いため、`wc -l`（改行数）では 16行（17論理行, 495 bytes）となる。
> ※4: `wc -l $(find active -type f ! -name "*.png")` による62テキストファイルの一括計測では、末尾改行なしファイル連結時の改行カウント特性により合計 **21,491行**（個別 `wc -l` 単純和は 9,098 + 4,518 + 1,603 + 4,496 + 1,512 + 234 + 16 = 21,477行）となる。ルート `index.html`（42行, 1,876 bytes）を含めると個別 `wc -l` 合計 **21,519行**。
> ※5: Final Runtime HEAD における `git ls-files | wc -l` 実測値 **268ファイル** である。

---

## 2. データベース現物構造（地区専用 Spreadsheet DB / ADR-024 Dual Lifecycle 準拠）

`active/business/system/district_provisioner.js`、`monthly_sheet_resolver.js`、`system_info_service.js`、`bulletin_service.js`、および ADR-024 に基づく実シート構成：

### (1) システム管理シート（1シート）
- **`SYSTEM_INFO`**: 2列（A〜B列: 項目・内容、`A1:B16` 保護対象）。行構成は `B2` 地区コード、`B3` 地区名、`B4` HアプリURL、`B5` Dashboard URL、`B6` LIFFアプリ名、`B7` LIFF ID、`B8` LIFF URL、`B9` Endpoint URL、`B10` Manager認証パスワード、`B11` 状態、`B12` 契約終了日、`B13` **運用モード**、`B14` **Active Dataset Key**、`B15` **契約開始日時**、`B16` **`GOOGLE_MAPS_API_KEY`**。

### (2) 実運用データセット（5シート: ELECTION固定 または SUBSCRIPTION月次）
- **ELECTION モード**: 契約開始日時に確定した固定 Dataset Key（例: `2026-10`）を用い、契約終了日まで同一の 5 シートを継続使用する（月次リセット禁止）。
- **SUBSCRIPTION モード**: 現在年月（`YYYY-MM`）を用い、毎月新しい 5 シートを直接生成し過去月は履歴保持する。
- ※第1世代の原本5種（マスターテンプレート）は ADR-024 により完全撤廃され、新規プロビジョニングでは生成されない。
1. **`配布実績<Key>`**: 17列 `[ID, 市町村, 町域, 配布完了日時, 配布枚数, 担当者ID, 担当者名, GPS, 写真, 緯度, 経度, GPS日時, 写真ファイルID, 写真URL, 写真日時, lineUserId, requestId]`
2. **`名簿<Key>`**: 4列 `[ID, 名前, LINE_USER_ID, 登録日時]`
3. **`保有チラシ枚数<Key>`**: 7列 `[ID, 担当者ID, 担当者名, 保管場所, 保有枚数, 最終更新日時, lineUserId]`
4. **`受渡要請履歴<Key>`**: 14列 `[日時, 要請者, 要請者ID, 保管者, 保管者ID, 連絡方法, 連絡先, 状態, requestId, LINE送信状態, LINE HTTP status, LINE送信日時, requesterLineUserId, holderLineUserId]`
5. **`PinStatus<Key>`**: 2列 `[rowId, status]`

### (3) 現場コミュニケーション・履歴シート群（2シート: オンデマンド生成）
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

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `index.html` (ルート) | 42 | 1,876 | 🟢 継承 | ルートリダイレクトおよびLIFFエントリ。 |
| `active/h-app/index.html` | 397 | 22,592 | 🟢 継承 | HアプリのメインDOM。ブラック基調のプレミアムUI、下部ナビゲーション、モーダル構造、20スクリプト順序定義。 |
| `active/h-app/style.css` | 1,227 | 29,277 | 🟢 継承 | グラスモフィズム、ネオモルフィズム、タッチアニメーション等のデザインシステム。 |
| `active/h-app/tailwind-utils.css` | 321 | 16,683 | 🟢 継承 | オフライン稼働・高速レンダリングのためのTailwind事前生成CSS。 |
| `active/h-app/app.js` | 1,426 | 54,282 | 🟡 再構築完了 | Target Architecture B' に基づく Composition Root（Wave 1〜17 分離完了、Dead Code 除去後 1,426行）。Boot/Bootstrap、DI配線（`setApiAuthGates`, `setQueueLifecycleGates`）、Google Maps ライフサイクル、各 Feature Module と View の結合を担当。 |
| `active/h-app/render.js` | 2,597 | 109,823 | 🟡 再構築完了 | Google Maps ピン・ポリゴン・モーダル描画、および `NumpadView` / `StorageView` / `BulletinView` / `TransferView` / `RankingView` / `StaffRegistrationView` の Presentation 層を集約。 |
| `active/h-app/db.js` | 486 | 18,385 | 🟢 継承 | IndexedDB オフライン送信キュー（`PostingMapDB` -> `syncQueue`）。配布完了送信（`updateRecordWithGPSPhoto`）の先行永続化、指数バックオフ再送（10s/30s/60s/60s）、4固定フック連携、DI Gate 受領を担当。 |
| `active/h-app/components/navigation.js` | 50 | 3,386 | 🟢 継承 | `renderBottomNavigation` — 現場目線の2層（Tier1/Tier2）ボトムナビゲーションHTML生成。 |
| `active/h-app/components/ranking.js` | 72 | 3,499 | 🟢 継承 | `renderRankingCard(rankingData, myStaffId, mySummary)` — 個人ランキングカードの純粋関数描画（グローバル状態非依存）。 |
| `active/h-app/components/staff.js` | 360 | 17,470 | 🟢 継承 | `renderStaffCard`, `initCardGyro`, `StaffIdInfoView` — デジタル配布員証およびID情報モーダル。 |
| `active/h-app/components/sync-status.js` | 51 | 1,839 | 🟢 継承 | `SyncStatusView` — ヘッダー通信状態（ONLINE / OFFLINE / SYNCING）Presentation Component。 |
| `active/h-app/modules/activity.js` | 497 | 17,412 | 🟢 継承 | `ActivityModule` — 活動ログライフサイクル、Draft作成・破棄、`requestId` (`clientEventId`) 生成、Queue調停、`startDraftWorkflow`。 |
| `active/h-app/modules/api.js` | 240 | 8,319 | 🟡 再構築完了 | `callApiPost`, `setApiAuthGates`, `fetchMunicipalityMaster`, `fetchStorageLocations`, `fetchElectionHistory`, `fetchAreaMapping` — 通信制御およびマスター読込。 |
| `active/h-app/modules/auth.js` | 149 | 4,780 | 🟢 継承 | `AuthModule` — LIFF認証状態、本人確認State、同期Promise、Gate所有権、Atomic Setter管理。 |
| `active/h-app/modules/bulletin.js` | 215 | 7,194 | 🟢 継承 | `BulletinModule` — 掲示板投稿取得・作成・連絡送信・送信ロック・認可世代セッション確認。 |
| `active/h-app/modules/device.js` | 122 | 3,335 | 🟢 継承 | `getGPSLocation`, `compressImage` — 高精度GPS取得およびクライアント側画像圧縮。 |
| `active/h-app/modules/navigation.js` | 217 | 7,047 | 🟢 継承 | `switchPage`, `restoreMapStateIfNeeded` — 画面遷移・スクロール位置保持・ナビ切り替え。 |
| `active/h-app/modules/pin-status.js` | 142 | 4,461 | 🟢 継承 | `PinStatusModule` — 作業中・完了ピンの排他制御・キャッシュ同期・`setPinStatus` 通知。 |
| `active/h-app/modules/ranking.js` | 63 | 1,973 | 🟢 継承 | `RankingModule` — ランキングデータ・本人サマリ・In-flight Promise のカプセル化管理（`fetchRanking`, `getSnapshot`）。 |
| `active/h-app/modules/staff-registration.js` | 78 | 2,343 | 🟢 継承 | `StaffRegistrationModule` — 初回スタッフ登録状態・多重呼出し防止・Hooks管理。 |
| `active/h-app/modules/storage.js` | 120 | 3,237 | 🟢 継承 | `StorageModule` — チラシ在庫・保管場所データアクセス（`saveHold` 経由の `updateFlyerStock` オンライン送信、キャッシュ管理）。 |
| `active/h-app/modules/summary.js` | 40 | 1,085 | 🟢 継承 | `SummaryModule` — `lastSummaryData` および `_systemSummaryPromise` のカプセル化管理。 |
| `active/h-app/modules/transfer.js` | 228 | 7,030 | 🟢 継承 | `TransferModule` — 受渡要請セッション世代管理、連絡先バリデーション、Pre-Auth送信前ロック、API送信調整。 |
| `active/h-app/assets/icon180-v2.png` | binary | 31,227 | 🟢 継承 | PWA / LIFF 用公式アプリアイコン。 |

### (2) Frontend — Manager Dashboard (`active/manager/`)

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/manager/index.html` | 1,061 | 52,912 | 🟢 継承 | 管理者向けダッシュボードDOM。7画面構成（`overview`, `records`, `stocks`, `roster`, `requests`, `bulletin`, `mail`）。 |
| `active/manager/manager.js` | 3,454 | 142,647 | 🟡 再構築完了 | 管理者業務ロジック。Google Maps 連携、6桁PINサーバーセッション認証（`verifyManagerPassword` / `logoutManager`）、スナップショット観測、CSV出力。 |
| `active/manager/tailwind-input.css` | 3 | 59 | 🟢 継承 | Manager Dashboard 用 Tailwind CSS ビルド入力定義。 |
| `active/manager/assets/manager.tailwind.css` | 0 (1論理行) | 26,790 | 🟢 継承 | Manager Dashboard 用に事前コンパイル・最小化された Tailwind CSS アセット。 |

### (3) Backend API & 認証 (`active/api/`)

| ファイル / コンポーネント | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/api/v2_api.js` | 1,257 | 56,440 | 🟡 再構築完了 | `doGet`/`doPost`/`processPostAction` エントリポイント。5層認可境界（Public / Dashboard Manager / Dual-Audience / Unregistered Staff / Active Staff）、`verifyIntegrityGuard`（`SYSTEM_INFO` 地区コード照合 + 契約期限検証）、全22 POSTアクション＋GETヘルスチェックを統制。 |
| `active/api/AssetRegistry.js` | 12 | 361 | 🟢 継承 | `AssetRegistry` — 静的アセット・設定レジストリ。 |
| `active/api/auth/auth.js` | 92 | 2,504 | 🟡 再構築完了 | `authenticateRequest`, `verifyLiffAccessToken` — LINE Profile API (`GET https://api.line.me/v2/profile`) トークン検証および `CacheService` SHA-256 キャッシュ（30分）。 |
| `active/api/auth/session.js` | 242 | 7,230 | 🟢 継承 | `createDashboardSession`, `verifyDashboardSession`, `revokeDashboardSession` — Dashboard 6桁PINセッション管理（TTL 6時間・地区バインド）。 |

### (4) Backend ドメイン業務ロジック (`active/business/`)

| ドメイン / ファイル | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `area/address_master_service.js` | 97 | 2,887 | 🟢 継承 | `AddressMasterService` — 住所マスターCSVの読込・パース・自治体別町丁目クエリSSOT（ブラウザ/GAS両対応）。 |
| `area/area_repository.js` | 67 | 2,836 | 🟢 継承 | `AreaRepository` — エリアデータの検索・取得リポジトリ（`findByAreaName`, `getAllAreas`）。 |
| `area/area_service.js` | 27 | 687 | 🟢 継承 | `AreaService` — エリア詳細情報提供サービス（`getAreaDetails`）。 |
| `area/tier1_service.js` | 92 | 2,979 | 🟢 継承 | `Tier1Service` — 自治体別集計（`getTier1Summary`）提供サービス。 |
| `bulletin/bulletin_service.js` | 376 | 14,667 | 🔵 要検証 | `BulletinService` — 掲示板投稿・連絡履歴管理（`getPosts`, `createPost`, `sendContact`）。 |
| `distribution/distribution_model.js` | 43 | 1,433 | 🟢 継承 | `DistributionEvent` — 配布実績データモデル（設計上の論理エンティティ名 `DistributionRecord` に対応）。 |
| `distribution/distribution_repository.js` | 286 | 10,387 | 🟢 継承 | `DistributionRepository` — 配布実績保存（`save`）、最新履歴（`fetchLatest`）、統計（`fetchDeliveryStats`）、ランキング集計（`fetchRankingData`）。 |
| `distribution/distribution_service.js` | 99 | 3,710 | 🟢 継承 | `DistributionService` — 配布実績登録・取得サービス（`recordDistribution`, `getLatestRecords`, `getDeliveryStats`, `getRanking`）。 |
| `flyer/flyer_repository.js` | 143 | 4,862 | 🟢 継承 | `FlyerRepository` — チラシ在庫データアクセス（`getAllStocks`, `upsertStock`）。 |
| `flyer/flyer_service.js` | 31 | 903 | 🟢 継承 | `FlyerService` — チラシ在庫取得・更新サービス（`getStockSummary`, `updateStock`）。 |
| `gps/gps_repository.js` | 200 | 8,032 | 🟢 継承 | `GPSRepository` — Drive証跡写真保存（`savePhotoToDrive`）および配布実績行更新（`updateDistributionRow`）。 |
| `gps/gps_service.js` | 157 | 6,621 | 🟢 継承 | `GPSService` — 15秒排他ロック（`waitLock(15000)`）、日本国内GPS座標境界検証、Q列 `requestId` 冪等性・D列 `alreadyCompleted` 判定（`updateRecordWithGPSPhoto`）。 |
| `pin/pin_status_service.js` | 97 | 3,079 | 🟢 継承 | `PinStatusService` — ピンのリアルタイム作業中・完了状態管理（`getPinStatus`, `updatePinStatus`）。 |
| `staff/staff_model.js` | 56 | 1,426 | 🟢 継承 | `Staff` — 配布員データモデル。 |
| `staff/staff_repository.js` | 166 | 5,335 | 🟢 継承 | `StaffRepository` — 名簿シートへの読み書きリポジトリ（`findById`, `findByLineUserId`, `getNextSequenceNumber`, `save`, `findAll`）。 |
| `staff/staff_service.js` | 141 | 5,108 | 🟢 継承 | `StaffService` — 配布員登録、LINE User IDからのIdentity強制解決（`resolveStaffIdentity`, `getStaffIdentity`, `registerStaff`, `getRoster`）。 |
| `system/district_provisioner.js` | 989 | 41,132 | 🟢 継承 | `DistrictProvisioner` — ADR-024 準拠のデータセット自動ロールオーバー（`rolloverMonthlySheets`）、実運用5シートの初期作成・同期、`SYSTEM_INFO` 初期生成を担うプロビジョニング実装。 |
| `system/monthly_sheet_resolver.js` | 150 | 5,796 | 🟢 継承 | `MonthlySheetResolver` — アクティブデータセット名（`<Key>` / `YYYY-MM`）の厳格な参照解決SSOT。 |
| `system/system_info_service.js` | 713 | 27,320 | 🟢 継承 | `SystemInfoService` — `SYSTEM_INFO` シートの管理、契約期間チェック、管理者認証、運用モード解決。 |
| `system/system_summary_service.js` | 125 | 4,392 | 🟢 継承 | `SystemSummaryService` — システム全体の進捗・統計サマリ提供（`getSummary`）。 |
| `transfer/transfer_service.js` | 455 | 18,027 | 🔵 要検証 | `TransferService` — チラシ受渡要請サービス（`requestTransfer`, `getTransferRequests`, `resolveTransferRequest`）。 |
| `active/business/*` 削除済み・不在確認 | — | — | 🔴 廃止済 | 旧メソッド `AddressMasterService.getTowns`, `AddressMasterService.search`, `AreaRepository.findByRowId`, `DistributionService.getRankingData`, `PinStatusService.getGlobalPinStatus`, `PinStatusService.setPinInProgress`, `StaffRepository.findByName`, `StaffRepository.findByNameAndApp`, `StaffRepository.updateLineUserIdAtRow`, `SystemSummaryService.refreshAreaSummaryCache` は Cleanup Mission により完全削除済み。 |

### (5) Backend GAS運用・移行基盤 (`active/gas/`)

| ファイル | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/gas/v2_batch.js` | 307 | 11,109 | 🟢 継承 | 定期バッチ・月次ロールオーバートリガー処理（`v2_dailyBatch`, `v2_monthlyRolloverBatch`）。 |
| `active/gas/v2_config.js` | 116 | 3,208 | 🟡 再構築完了 | `V2_CONFIG`, `getConfigValue` — スクリプトプロパティ取得・設定。 |
| `active/gas/v2_deployment_foundation.js` | 314 | 9,182 | 🟡 再構築完了 | 1地区専用GAS配備・初期化・設定検証基盤ユーティリティ。 |
| `active/gas/v2_extract.js` | 138 | 4,489 | 🟢 継承 | データ抽出ユーティリティ。 |
| `active/gas/v2_map.js` | 26 | 784 | 🟢 継承 | 座標計算・マップデータ補助。 |
| `active/gas/v2_migration.js` | 611 | 23,862 | 🟡 再構築完了 | カラム・スキーママイグレーションおよびIdentity補完ユーティリティ。 |
| `active/gas/v2_core.js` / `v2_stats.js` | — | — | 🔴 廃止済 | 旧複製モデル用スクリプトおよび未使用ユーティリティは物理削除済み（Current Tree 不在）。 |

### (6) インフラアダプター (`active/infrastructure/`)

| ファイル | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `active/infrastructure/cache/cache_adapter.js` | 41 | 1,124 | 🟢 継承 | `CacheAdapter` — GAS `CacheService` ラッパー。 |
| `active/infrastructure/drive/drive_adapter.js` | 26 | 1,021 | 🟢 継承 | `DriveAdapter` — GAS `DriveApp` ラッパー。 |
| `active/infrastructure/lock/lock_adapter.js` | 36 | 998 | 🟢 継承 | `LockServiceProvider` — GAS `LockService` 排他制御ラッパー（デフォルト10秒）。 |
| `active/infrastructure/spreadsheet/spreadsheet_adapter.js` | 131 | 4,628 | 🟢 継承 | `SpreadsheetResolver`, `getSS` — 1地区専用DB解決アダプター（`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()`）。旧 `SpreadsheetRepository` / `SpreadsheetBatchReader` / `SpreadsheetBatchWriter` は削除済み。 |

### (7) マスターデータ・設定 (`data/` — 全12ファイル)

| ファイル | 行数 (`wc -l`) | バイト数 (`wc -c`) | 分類 | 分類理由・現物根拠 |
|---|---|---|---|---|
| `data/address_master.csv` | 910 (ヘッダ1 + 909町丁目) | 62,165 | 🟢 継承 | 公式住所（位置参照情報・ABR）および国勢調査小地域に基づく8列アドレスマスターSSOT。 |
| `data/area_mapping.json` | 0 (1論理行 `[]`) | 2 | 🟢 継承 | エリア実績マッピングメタデータ（新規地区標準の空配列 `[]`）。 |
| `data/boundaries.geojson` | 0 (1論理行 GeoJSON) | 2,428,113 | 🔵 要検証 | 町丁目境界ポリゴンデータ。モバイルでの描画パフォーマンスの継続観測対象。 |
| `data/config.js` | 21 | 559 | 🟢 継承 | クライアント接続設定（`districtId`, `gasWebAppUrl`, `liffId` 等）。 |
| `data/election_history.json` | 79 (80論理行) | 2,181 | 🔵 要検証 | 過去の衆議院選挙得票実績データ。 |
| `data/municipality_master.csv` | 9 (ヘッダ1 + 8自治体) | 204 | 🟢 継承 | 対象地区の構成自治体一覧（`<city_name>,<city_code>,<total_towns>`）。 |
| `data/storage_locations.json` | 10 | 132 | 🟢 継承 | チラシ保管場所の自治体候補リスト。 |
| `data/raw_reference/<city_code>/` (5ファイル) | — | 11,724,929 | 🟢 継承 | 国交省位置参照情報等の一次参照資料5ファイル（HTML: 110行/4,194B, 位置参照CSV: 57,661行/6,222,011B, メタデータXML: 396行/16,993B, アーカイブZIP: 295,981B, `reference_points.csv`: 57,661行/5,185,750B）。 |

### (8) 開発・検証・運用スクリプト (`scripts/` — 実在全30ファイル)

| カテゴリ | スクリプト一覧 (Current Tree 実在30ファイル) | 分類 | 役割・現物根拠 |
|---|---|---|---|
| **Governance & Gate Scripts (8ファイル)** | `check-architecture-gate.mjs`, `check-auditor-gate.mjs`, `check-cleanup-gate.mjs`, `check-entrance-gate.mjs`, `check-knowledge-gate.mjs`, `check-scope.mjs`, `check-secrets.mjs`, `check-universal-invariants.mjs` | 🟢 継承 | Stage 0 / Stage 4 / Stage 5 / Stage 9 の機械検証ゲート群（`package.json` 連動）。 |
| **District Provisioning & Master Data Pipeline (9ファイル)** | `acquire-liff-id.mjs`, `build-district-master.py`, `fetch-district-raw-data.py`, `generate-boundaries-geojson.py`, `provision-domain.mjs`, `provision-line-assets.mjs`, `sort-address-master.py`, `stamp-h-app-token.mjs`, `validate-district-data-gate.mjs` | 🟢 継承 | アドレスマスター・境界GeoJSON生成、Master Triad検証、ドメイン・LINE/LIFFアセットプロビジョニング。 |
| **Deploy & Endpoint Verification (3ファイル)** | `safe-deploy.mjs`, `validate-gas-endpoint-ssot.mjs`, `verify-gas-deployment.mjs` | 🟢 継承 | 安全デプロイ執行、GAS エンドポイントSSOT検証、GAS Web App デプロイ疎通検証。 |
| **Local Server & Browser E2E Verification (10ファイル)** | `serve.mjs`, `test_browser_h_app.mjs`, `test_browser_h_app_activity.mjs`, `test_browser_h_app_bulletin.mjs`, `test_browser_h_app_id_info.mjs`, `test_browser_h_app_numpad.mjs`, `test_browser_h_app_pin_status.mjs`, `test_browser_h_app_ranking.mjs`, `test_browser_h_app_storage.mjs`, `test_browser_h_app_transfer.mjs` | 🟢 継承 | ローカル開発サーバーおよび Hアプリ各機能モジュールのブラウザ実機E2E検証スクリプト群。 |
| **削除済み旧スクリプト** | `check-universal-boundary.mjs`, `verify-runtime-integrity.mjs`, `run-gemini-auditor.mjs` | 🔴 廃止済 | 旧複製モデル用または廃止済みスクリプト（Current Tree から物理削除済み）。 |

### (9) 自動検証テストスイート (`tests/` — 実在全58ファイル / Active 49スイート)

- `npm test` は `node scripts/check-secrets.mjs && node tests/run_all_tests.mjs` を実行し、`tests/run_all_tests.mjs` に登録された **49のアクティブテストスイート** を順次実行する。
- `tests/` 配下に実在する **全58ファイル** の内訳は以下の通りである：
  - **テストランナー & 実機計測ハーネス (2ファイル)**:
    `run_all_tests.mjs`, `measure_chrome_real.mjs`
  - **H-App Feature & View Lifecycle Suites (19ファイル)**:
    `test_activity_module_lifecycle.mjs`, `test_auth_module_lifecycle.mjs`, `test_bulletin_module_lifecycle.mjs`, `test_bulletin_post_contact_lifecycle.mjs`, `test_durable_queue_verification.mjs`, `test_gap001_ready_freeze_regression.mjs`, `test_h_app_core_verification.mjs`, `test_numpad_view_lifecycle.mjs`, `test_optimistic_startup_safety.mjs`, `test_pin_status_module_lifecycle.mjs`, `test_posting_flow_verification.mjs`, `test_ranking_module_lifecycle.mjs`, `test_staff_id_info_lifecycle.mjs`, `test_staff_identity_boundary.mjs`, `test_staff_registration_lifecycle.mjs`, `test_storage_register_lifecycle.mjs`, `test_summary_module_lifecycle.mjs`, `test_sync_status_view_lifecycle.mjs`, `test_transfer_module_lifecycle.mjs`
  - **Manager Dashboard & Backend Domain Suites (8ファイル)**:
    `test_backend_dashboard_identity.mjs`, `test_contract_expiry.mjs`, `test_dashboard_integrity_acceptance.mjs`, `test_dashboard_snapshot.mjs`, `test_dual_lifecycle_mode.mjs`, `test_line_push_idempotency_audit.mjs`, `test_manager_ui_interaction.mjs`, `test_schema_provisioning_healing.mjs`
  - **Phase Verification & Step Rectification Suites (11ファイル)**:
    `test_phase11_activity_state_machine.mjs`, `test_phase13_dashboard_verification.mjs`, `test_phase14_performance_verification.mjs`, `test_phase15_security_verification.mjs`, `test_phase16_testing_verification.mjs`, `test_phase18_migration_verification.mjs`, `test_phase19_cutover_verification.mjs`, `test_phase20_monitoring_verification.mjs`, `test_phase21_multiregion_verification.mjs`, `test_step2_step3_verification.mjs`, `test_step3_rectification.mjs`
  - **District Provisioning, Security & Governance Gate Suites (18ファイル)**:
    `test_architecture_gate.mjs`, `test_auditor_effectiveness_regression.mjs`, `test_auditor_gate.mjs`, `test_cleanup_gate.mjs`, `test_district_app_deployment_skill.mjs`, `test_district_data_gate.mjs`, `test_district_phase2_universal.mjs`, `test_district_scripts_universal.mjs`, `test_knowledge_sync_gate.mjs`, `test_multi_district_routing_auth.mjs`, `test_provision_domain.mjs`, `test_provision_line_assets.mjs`, `test_registry_provisioning_gate.mjs`, `test_sec001_dashboard_auth_fix.mjs`, `test_sec002_formula_injection.mjs`, `test_sec005_getsysteminfo_disclosure.mjs`, `test_sec007_district_maps_api_key.mjs`, `test_secret_leak_guard.mjs`

---

## 4. 🔵 要検証項目（Pending Verification Items）

推測による独断判定を排除し、継続的に実機検証・運用観測を行う項目は以下の **4点** である。

1. **掲示板（Bulletin）機能の現場運用性**:
   - `active/business/bulletin/bulletin_service.js`（376行）および `active/h-app/modules/bulletin.js`（215行）。
   - 検証項目: 配布員間のメッセージ交換が実際の活動で有効に機能しているか、不適切な投稿や個人情報露出のリスクはないか、通知インフラの負荷。
2. **チラシ受渡要請（Transfer）機能とLINE Push通知**:
   - `active/business/transfer/transfer_service.js`（455行）および `active/h-app/modules/transfer.js`（228行）。
   - 検証項目: LINE Messaging API によるプッシュ通知送信の月間クォータ消費、送信失敗時のリトライ・フォールバック仕様、当事者間連絡の成立実態。
3. **境界GeoJSON描画パフォーマンス（モバイル低スペック端末耐性）**:
   - `data/boundaries.geojson`（2,428,113 bytes）および `active/h-app/render.js`（2,597行）。
   - 検証項目: スマートフォン（特に低スペック機や通信制限下）において、Google Maps 上でのポリゴン描画負荷、ズーム操作時のFPS低下、メモリ消費量の限界値。
4. **過去選挙実績データ（`election_history.json`）の機能的有用性**:
   - `data/election_history.json`（79行 / 80論理行, 2,181 bytes）。
   - 検証項目: HアプリまたはDashboardでの参照実態、今後の選挙戦略機能としての必要性。
