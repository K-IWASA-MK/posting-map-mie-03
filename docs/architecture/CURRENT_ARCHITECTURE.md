# POSTING MAP — 現行アーキテクチャ定義書
*(Current Architecture Specification)*

本書は、POSTING MAPの現行アーキテクチャを定義する技術定義書である。
最上位の設計契約・憲法として **[01_DESIGN_CONTRACT.md](01_DESIGN_CONTRACT.md)** が存在し、本書はその下位において現行システムの構造を定義する。

---

## 1. 最上位原則 (Supreme Principles)

### ① 1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定
- POSTING MAPは、**「1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定」** を基本アーキテクチャとする（AGENTS.md §1）。
- 共通Runtime（`active/`）は **Universal Engine** として全地区共通であり、コピーして変更しない。
- 地域間の差異（所属支部・活動対象地域・マスターデータ等）は、すべて **「データ（`data/`）」** および不可避の地区専用外部設定（`data/config.js` 等）として分離・吸収する。

### ② 共通エンジンとデータ層の完全分離 (Universal Engine vs. Master Data)
- **`active/` = 汎用 Universal Engine**
  - 全地域で100%同一の実行プログラム（JavaScript / HTML / CSS / 当該Spreadsheetに付属する1地区専用GAS）。
  - 地域固有のコード改変・条件分岐の混入を永久に禁止する。
- **`data/` = 地域データ & クライアント設定 (Regional Data & Config)**
  - 住所マスター、境界GeoJSON、自治体定義、クライアント接続情報が集約されるデータ領域。

### ③ 活動関係とIdentityの正規導出
- 活動関係モデル: `LINE User ID (verified) → 本人 (Staff Identity) → 所属支部 (Branch) → 支部の活動対象地域`
- クライアントが送信する `staffId` や `branchId` を権限根拠として信用しない（サーバー側で安全に解決）。
- 党員個人への固定担当エリア割り当ては存在しない。活動実績から個人ランキングを生成・可視化する。

---

## 2. システム構成と責務境界 (System Architecture)

```text
┌──────────────────────────────────────────────────────────────────┐
│                     POSTING MAP 独立インスタンス                  │
│                                                                  │
│  ┌────────────────────────┐          ┌────────────────────────┐  │
│  │   Hアプリ (配布員UI)    │          │  Dashboard (管理者UI)  │  │
│  │  active/h-app/         │          │  active/manager/       │  │
│  └───────────┬────────────┘          └───────────┬────────────┘  │
│              │ (静的読込)                         │ (静的読込)     │
│              ▼                                   ▼               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                     data/ (地区固有領域)                    │  │
│  │  ・address_master.csv      ・boundaries.geojson            │  │
│  │  ・municipality_master.csv  ・config.js                     │  │
│  │  ・area_mapping.json                                       │  │
│  └───────────────────────────┬────────────────────────────────┘  │
│                              │ API通信 (POST / JSON)             │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │    当該Spreadsheetに付属する1地区専用GAS (APIサーバー)     │  │
│  │  active/api/ , active/business/                             │  │
│  │  ※ TARGET_SPREADSHEET_ID → SPREADSHEET_ID → getActiveSpreadsheet() │  │
│  └───────────────────────────┬────────────────────────────────┘  │
│                              │ Sheets API                        │
│                              ▼                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼ 地区専用クラウド資産
              ┌──────────────────────────────────┐
              │     Google Spreadsheet (地区専用DB) │
              │     ※ ADR-024 標準構造（SYSTEM_INFO + 実運用5シート<Key> + 現場2シート） │
              │     ※ 当該Spreadsheet付属1地区専用GASと1対1結合     │
              └──────────────────────────────────┘
```

### 1. Hアプリ (配布員用モバイルUI: `active/h-app/`)
- LINE LIFF または スマートフォンWebブラウザ上で動作するポスティング配布員専用のUI。

#### 【Current Runtime (現在の実稼働状態)】
- Wave 1〜Wave 17 の段階移行が完了し、下記の **Target Architecture B'** に完全準拠して稼働している（`app.js` は 1,426行の Composition Root へ純化され、12個の Feature/Lifecycle Modules `active/h-app/modules/*.js` および 4個の Pure/UI Components `active/h-app/components/*.js` へ責務分離済み）。

#### 【Approved Target Architecture B' (承認済・段階移行完了)】
- `active/h-app/app.js`
  - **Composition Root / Boot Orchestrator**
  - 起動順序の統制、Global Lifecycle Wiring、および Feature Module の初期化のみを担当。
- `active/h-app/modules/`
  - **Browser-side Frontend Feature / Lifecycle Modules**
  - Feature State、キャッシュ、in-flight lifecycle、Workflow Coordination、API Coordination を Private State として所有。
  - ※注意: `active/business/**`（GAS上の Backend Business Domain）とは明確に異なる、ブラウザ側のフロントエンド層である。
- `active/h-app/render.js`
  - **Presentation Layer**
  - Map / Page rendering、Visual interaction、および Presentation-local state（UI開閉など）のみを担当。Domain State を所有しない。
- `active/h-app/components/`
  - **Pure Rendering**
  - API通信禁止、Domain State所有禁止。同一入力に対して常に同一のHTMLを返す。
- **Target Dependency Direction (依存方向)**
  - `app.js` ─▶ initializes Feature/Lifecycle Modules, wires Presentation
  - `Feature/Lifecycle Modules` ─▶ `api.js` (Backend通信) / `db.js` / `device.js`
  - `render.js` ─▶ `components/`
  - **Feature ↔ Presentation 間** は Stable Interface / DI を原則とし、固定的な逆依存を新設しない。

#### 【Resolved Migration Gaps (解消済みの移行課題)】
- `modules/api.js` から `app.js` 内部の Auth/Identity Gate への逆依存（`window.waitForLiffAuthReady` 等の直接参照）は、Wave 13 にて Dependency Injection（DI: `setApiAuthGates`）を通じて解消済み。
- `active/h-app/db.js` から `app.js` 内部の Lifecycle/UI 関数への逆依存（`window.isIdentityVerifiedReady`, `window.triggerUISyncRefresh`, `loadData` の直接参照）は、Wave 14 にて Dependency Injection（DI: `setQueueLifecycleGates`）を通じて解消済み。
- `app.js` に残留していた Auth / Identity private state（`_liffAuthState`, `_liffAuthReadyPromise`, `_identityVerified`, `_identityLastError`, `_identitySyncPromise` 等）および Gate（`waitForLiffAuthReady`, `waitForIdentityVerified`, `isLiffAuthReady`, `isIdentityVerifiedReady`）の所有権は、Wave 15 にて `active/h-app/modules/auth.js` (`AuthModule`) へ完全移管済み。`app.js` 側は薄い Compatibility Wrapper による delegate と DI 注入のみを担う Composition Root へ純化。
- `app.js` に残留していた System Summary private state（`lastSummaryData`）および in-flight/cached Promise（`_systemSummaryPromise`）の所有権は、Wave 16 にて `active/h-app/modules/summary.js` (`SummaryModule`) へ完全移管済み。`app.js` 側は production fallback を一切持たず `SummaryModule` へ直接 delegate する純粋な Composition Root へ純化。
- `app.js` に残留していた通信状態表示（`setSyncStatus`: ONLINE / OFFLINE / SYNCING）の DOM 操作責務は、Wave 17 にて `active/h-app/components/sync-status.js` (`SyncStatusView`) へ完全移管済み。`index.html` 上で `app.js` より前に物理先行ロードされ、`app.js` 側は production fallback や typeof guard を持たず `window.SyncStatusView.setStatus(state)` へ直接同期 delegate する薄い Compatibility Wrapper へ純化。

### 2. Dashboard (統括管理者用UI: `active/manager/`)
- PC/タブレット向けの進捗管理・チラシ在庫・配布員名簿・受渡要請の統括管理画面。
- `data/address_master.csv`、`data/municipality_master.csv`、`data/boundaries.geojson` を動的解析して表示。
- 接続情報は `data/config.js` を唯一の参照先とする。

### 3. API & Backend Business Domain (`active/api/`, `active/business/`)
- 当該Spreadsheetに付属する1地区専用GAS上で稼働する共通REST/RPC風APIサーバー。
- `active/business/` は **Backend Business Domain** であり、フロントエンド側の `active/h-app/modules/` (Browser-side Feature Module) とは明確に区別される。
- 認証、進捗集計、受渡要請、在庫管理、名簿管理を実行し、当該地区のSpreadsheet（DB）へアクセス。

### 4. Spreadsheet = 1地区専用データベース (District Database)
- スプレッドシートは地区ごとに1対1で独立したデータベースとして存在する。
- シート数式（`=QUERY`, `=IMPORTRANGE` 等）による動的集計や旧式マクロには依存せず、業務ロジックはすべて付属の1地区専用GAS（`active/api/v2_api.js`）に一元化する。
- **ADR-024 Dual Lifecycle 標準構造**:
  - システム管理 (1): `SYSTEM_INFO`（`A1:B16`）
  - 実運用データセット (5): `配布実績<Key>`, `名簿<Key>`, `保有チラシ枚数<Key>`, `受渡要請履歴<Key>`, `PinStatus<Key>`（`ELECTION` モードは固定期間ラベル、`SUBSCRIPTION` モードは `YYYY-MM` 月次ロールオーバー。旧「原本」5シートは廃止）
  - 現場 (2): `掲示板`, `掲示板連絡履歴`（オンデマンド自動生成）
  - ※詳細な正式名称・列定義は唯一の正本である `docs/data/DATA_DICTIONARY.md` に準拠する。
- **生成ライフサイクル**:
  - `MonthlySheetResolver` が `SYSTEM_INFO` の運用モード（`B15`）および活動期間キー（`B16`）に従い、アクティブ期間シート `<Key>` を自動解決・初期化する。
  - 現場系2シート（`掲示板`, `掲示板連絡履歴`）は現場での初回利用時にオンデマンド自動生成される。

### 5. GAS = 当該Spreadsheetに付属する1地区専用GAS
- Google Apps Script は各地区の Spreadsheet に1対1で付属する **「当該Spreadsheetに付属する1地区専用GAS」** として配備し、`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` の優先順で解決する。
- 複数地区を1本の共有親GAS（`DISTRICT_REGISTRY`）で束ねる構造は採用せず、地区ごとに物理的に自己完結させる。

### 6. 旧式非管理スクリプト・共有親GASの廃止
- Git管理外のアドホックな旧式スクリプトや、他地区DBを混在ルーティングする共有親GASは現行アーキテクチャ外であり、採用しない。

### 7. 認証 / LINE LIFF (`active/api/auth/`)
- Hアプリは LINE LIFF Access Token による本人確認（`GET https://api.line.me/v2/profile`）・セッション管理。
- 管理者画面はセッション認証（パスワード / トークン）。

---

## 3. 地区データの境界 (data/ 仕様)

新地区展開時に交換・初期化するファイルは、原則として以下の **`data/` 配下5ファイル** に集約される：

| ファイルパス | 役割 | 新地区展開時の扱い |
|---|---|---|
| `data/address_master.csv` | 町丁目・座標データ（SSOT） | 新地区の国勢調査町丁目データで**全数交換** |
| `data/boundaries.geojson` | 町丁目境界GeoJSON（MultiPolygon対応） | 新地区のGeoJSONで**全数交換** |
| `data/municipality_master.csv` | 地区を構成する自治体一覧 | 新地区の自治体一覧で**全数交換** |
| `data/config.js` | クライアント公開設定 (`gasWebAppUrl`, `liffId`) | 汎用時は空テンプレート、新地区デプロイ時に**同期・生成** |
| `data/area_mapping.json` | 過去エリアからの集約マッピング | 新地区立ち上げ時は **空配列 `[]` に初期化** |
| `data/storage_locations.json` | 保管場所候補マスター（小選挙区構成自治体） | 開催地から小選挙区データに基づき**機械的導出・配備** |

> **注記（外部データ生成ツールについて）**:  
> 国勢調査データ（e-Stat Shapefile）から上記マスターを生成するETLツールは、実行エンジン（`active/`）に含めず、データ調達用の独立ツール（`scripts/` 等）として分離管理する。

### 地区固有データの正式移行完了 (`data/election_history.json`)

衆院選・参院選投票率データ（`election_history.json`）の配置・参照方式については、Target Districtホワイトリスト方式の確立に伴い、以下の通り正式移行が完了した：

1. **地区固有データとしての一元化**:
   - `election_history.json` は地区固有データであるため、`docs/` から `data/election_history.json` へ正式移行完了。
2. **Universal Engineにおける動的パス解決への統一**:
   - `active/manager/manager.js` における旧レガシーパス直書き（`/docs/`）を廃止。
   - `data/config.js` の `staticMaster.electionHistoryFilename` および `fetchStaticDataFile` を用いた動的解決方式に統一された。
3. **データ層品質ゲート（データ整合検証）での全数監査**:
   - `election_history.json` の自治体キー（`municipalities`）が `data/municipality_master.csv`（SSOT）と100%完全一致することを静的データ照合により機械判定し、不整合ゼロの証跡をデータ整合検証レポートとして記録する。

### 保管場所候補マスター（`data/storage_locations.json`）の責務と動的連携

Hアプリの「保有チラシ」機能において、チラシ保管場所（市町村名）を選択・登録・共有するためのマスターデータであり、以下のアーキテクチャ境界を持つ：

1. **`address_master.csv` との責務分離（完全独立）**:
   - `address_master.csv`: ポスティング配布対象エリアそのものの確定SSOT（単一自治体または対象選挙区の確定町丁）。
   - `storage_locations.json`: ポスティングスタッフの活動拠点・保管拠点候補マスター。選挙開催地が属する**衆議院小選挙区の全構成市町村**を公式データから機械的に導出して定義（周辺自治体を含む）。両者は目的・粒度・範囲が完全に異なる独立責務である。
2. **Hアプリによるオンデマンド遅延取得（Zero Startup Lag）**:
   - 起動処理、`loadData()`、地図描画、LIFF初期化には一切接続せず、ユーザーが「保有チラシ登録画面」を開いた瞬間のみ非同期オンデマンドフェッチされる。初期起動性能への影響は 0ms を維持する。
3. **Spreadsheet が保有チラシデータの唯一の正本**:
   - Hアプリから登録されたデータは、GAS API（`updateFlyerStock`）を経由してスプレッドシート（`保有チラシ枚数<Key>` シート）の `location` 列に直接保存される。
4. **他端末Hアプリおよび Manager Dashboard での正本表示**:
   - **他端末Hアプリ**: `render.js` がスプレッドシートの最新データを取得し、`location` ごとに動的グループを自動生成して在庫状況を表示。
   - **Manager Dashboard**: `manager.js` がスプレッドシートの `location` をそのまま動的エスケープ表示。
   - Universal Engine（`active/`）側への自治体名ハードコードは一切行わず、地区データとスプレッドシート正本のみで表示・共有が成立する。

---

## 4. 外部リソースとデプロイメントメタデータ

### 1. 外部独立リソース (External Resources)
Universal POSTING MAP は各地区ごとに独立した以下の外部クラウドインフラと連携する：
1. **Googleスプレッドシート**: 1地区専用DB（ADR-024 標準台帳）。
2. **Google Driveフォルダ**: 写真・添付データ等の地区専用保管フォルダ。
3. **LINE Developers**: 地区専用 LIFF アプリおよび本人性確認。
4. **当該Spreadsheetに付属する1地区専用GAS**: 地区専用APIサーバーとして配備。

### 2. Deployment Metadata (`deployment.json`)
- インフラ接続の物理ID（`scriptId`, `deploymentId`, `webAppUrl`, `productionLiffUrl`）および地区識別子（`districtId`）を保持するローカル設定ファイル（Git追跡除外）。
- テンプレート `deployment.template.json` のみがリポジトリに保持される。

---

## 5. Universal アーキテクチャの不可侵原則 (Universal Architecture Invariants)

Universal POSTING MAP の運用・開発において、以下の原則はいかなる例外もなく遵守されなければならない：

1. **`active/` ゼロ改変原則**:  
   地域展開や機能追加において、地域固有のハードコードや分岐を `active/` 内に混入させてはならない。
2. **共通Runtime（`active/`）コード複製・改変禁止原則**:
   共通Runtime（`active/`）は Universal Engine として全地区共通であり、地区固有の個別コピー・改変を行ってはならない。「1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定」の原則のもと、地区差はすべて `data/` および地区専用外部設定で吸収する。
3. **リポジトリ境界絶対遵守原則**:
   作業中のリポジトリ以外を参照・探索・比較しない。他地区のコードやデータを推測で流用しない。
