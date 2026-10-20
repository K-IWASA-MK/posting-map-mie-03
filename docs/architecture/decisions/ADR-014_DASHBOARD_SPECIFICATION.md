# ADR-014: Universal Dashboard 仕様確定および全体観測境界 (Universal Dashboard Specification and Global Observation Boundary)

- **Status**: ACCEPTED (OFFICIAL SPECIFICATION)
- **Date**: 2026-09-25
- **Deciders**: Universal POSTING MAP Architecture Board / MASTER
- **Consulted**: `AGENTS.md`, `docs/architecture/01_DESIGN_CONTRACT.md` §3.2, §Phase 13, `docs/architecture/DISTRICT_AGNOSTIC_ARCHITECTURE_PRINCIPLE.md`, `docs/architecture/decisions/ADR-007.md`, `docs/architecture/decisions/ADR-013_ACTIVITY_STATE_MACHINE.md`, `active/manager/`

---

## 1. Context (背景と目的)

Universal POSTING MAP 再構築において、Phase 7 (Dashboard Snapshot)、Phase 8 (HアプリCore)、Phase 9 (Posting Flow)、Phase 10 (Durable Queue)、Phase 11 (Activity State Machine) の完了を受け、マスタープラン原本 (`docs/architecture/01_DESIGN_CONTRACT.md` §3.2, §Phase 13) に従い、**Phase 13: Dashboard** の正式仕様を制定する。

本ADRの目的は、管理者・運営側が地域全体を観測するための画面（Dashboard）の仕様境界を確定し、Universal Engine としての不変性と、Phase 7 Snapshot 契約および Phase 11 活動状態マシンとの完全な整合性を保証することにある。

---

## 2. Universal 原則とテストデータの厳格分離

Universal POSTING MAP は「特定地区のための個別アプリ」ではなく、全国展開可能な **Universal Engine（製品本体）** である。

本仕様において、製品本体の正式仕様とテスト検証条件の記述を厳格に分離する。

| レイヤー | 責務と定義 | 規程内容 |
|---|---|---|
| **Universal Engine (製品本体)** | 全国共通の不変ランタイム。地区固有値を一切持たない。 | ・地区数 / 自治体名 / 地区コードを固定しない<br>・エリア数 / 件数を固定しない (動的 N 件処理)<br>・Spreadsheet ID / シート名をハードコードしない<br>・地区固有差分は `data/` の配置・交換のみで吸収する |
| **テストデータ (検証環境)** | Universal Engine の動作を機械検証するための実データ。 | ・**対象地区の確定マスターデータ (`data/address_master.csv`, N件) をテストデータとして使用する**<br>・「固定件数だから固定件数を処理する」のではなく、「与えられた地区マスターの件数 (N件) を正しく動的処理できることを、実データ N 件で検証する」 |

---

## 3. Decision (決定事項)

### (1) Dashboard の主責務と観測専用（Read-Only）境界

Dashboard は、**管理者・運営側が地域全体のポスティング活動を観測するための専用画面**とする。

- **基本思想**: 「配布員は操作する。管理者は見る。」
- **タスク割当・現場強制の完全排除**:
  - 管理者から現場個人への固定担当エリア割当、活動強制、および現場への指示送信機能は一切設けない。
  - ピンやエリアを選択した際、表示されるのは世帯数・人口・進捗率・配布実績等の「観測データ」のみであり、ステータス変更や割当変更のUIは物理的に存在しない。

---

### (2) MAP中心 Overview およびレスポンシブ観測設計

1. **MAP中心 Overview**:
   - Leaflet マップエンジンを採用し、対象地区の `data/address_master.csv` に定義された**全エリア (N件) のピンを動的に読み込み常時俯瞰表示**する。件数は固定しない。
   - ピン状態マッピング（AREA_STATUS_CONFIG）：
     - **● 配布済 (`COMPLETED`)**: 橙色 (`#EA5F08` / stroke: `#fb923c` / 半径 6.0px) 🔒
     - **● 配布中 (`IN_PROGRESS`)**: 青色 (`#00B7FF` / stroke: `#0284c7` / 半径 5.5px)
     - **○ 未配布 (`UNALLOCATED`)**: 緑色 (`#22C55E` / stroke: `#16a34a` / 半径 4.5px)
2. **PC大画面 (1024px+) 3カラムレイアウト**:
   - 左カラム: 町丁目リスト (独立スクロール) ＆ 業務ナビゲーション
   - 中央メインステージ: MAP中心 Overview ＆ 詳細ビュー
   - 右カラム: 全体進捗サマリー ＆ 選択エリア統計 / 配布実績ログ
3. **Smartphone compact view (1023px以下)**:
   - 上部コンパクトヘッダー (ロゴ, 自治体/町丁目ドロップダウン, LIVEステータス)
   - 下部固定ナビゲーションバーによる快適な片手操作

---

### (3) Phase 11 活動状態マシンとの完全同期

Dashboard 上の表示は、Phase 11 (ADR-013) で確立された活動状態マシンおよび業務ルールと完全に同期する。

1. **完了判定の唯一のSSOT**:
   - `completed`（橙色ピン）の判定基準は、**当月 `配布実績YYYY-MM` シートに `completedAt`（D列）が記録されていること**を唯一の確定条件とする。
   - Hアプリ端末側のローカル下書き（DRAFT）、送信中（SUBMITTING）、送信待ち（PENDING）のデータは、Dashboard 上で配布済（橙色）には絶対に昇格させない。
2. **当月完了確定エリアのロック表示**:
   - 当月完了確定ピンは、ピンタップ時の情報ウィンドウ（バブル）内に「配布済み 🔒」が表示され、再操作不可状態として観測される。
3. **未完了エリアの日次再開**:
   - 当日中に完了確定に至らなかった未完了エリアは、当月シートに `completedAt` が記録されないため、翌日0:00以降も未配布（緑色）または作業中（青色）として観測され、翌日以降の再開が可能である。
4. **Dual Lifecycle（ELECTION / SUBSCRIPTION）と月跨ぎ実績判定**:
   - バックエンドの `MonthlySheetResolver` を唯一のSSOTとし、以下の2つのライフサイクルに従って対象 Dataset（`配布実績<Key>`）を解決する：
     - **`ELECTION`（選挙期間累積型）**: `SYSTEM_INFO.Active Dataset Key` が示す選挙期間 Dataset の完了実績全件を取得する。月が変わっても同一 Dataset を継続し、契約終了日まで累積する。
     - **`SUBSCRIPTION`（月次更新型）**: JST現在年月で解決された月次 Dataset（`配布実績YYYY-MM`）の完了実績全件を取得する。月が変わった（翌月1日 0:00 JST）瞬間、過去月の確定実績を消去することなく新月シートが参照される。
5. **個人ランキングの観測**:
   - 当月配布実績シート + completedAt + groupKey + count>0 の確定行のみを集計したランキングデータ（金銀銅メダル表示）を観測する。

---

### (4) Phase 7 Snapshot 契約の完全維持とマーカー差分更新

1. **7 API ➔ 1 Snapshot 一括取得（対象 Dataset の完了実績全件返却）**:
   - `active/manager/manager.js` の `syncDashboardData()` において、`callApiPost('getDashboardSnapshot', { districtId })` を実行し、1回の通信で全観測ドメインを一括取得する。
   - `getDashboardSnapshot` の配布実績ドメイン（`latestDistribution`）は、対象 Dataset の完了実績を**全件返却**して `DashboardState.liveRecords` に保持する。表示件数の制限（下部LIVEフィードバーにおける `slice(0, 4)` 等）は View 側の責務とする。
2. **Partial Failure 耐性 (No Blanking)**:
   - 取得結果のうち、成功したドメインのみをメモリステート（`DashboardState`）へ反映し、失敗したドメインは既存の画面表示データを保持する。ドメイン障害による画面の点滅・ブランクをゼロとする。
3. **マーカー差分更新による操作状態維持**:
   - 30秒間隔の自動定期同期において、ピン状態（`globalPinStatus`）に変更がない場合は `renderPinsOnMap`（Leaflet レイヤー再構築）をスキップする。
   - これにより、管理者が操作中のマップのパン位置・ズーム倍率・選択中のピン状態がリセットされず、フリッカー（画面チラつき）を完全に防止する。

---

### (5) スコープ境界（Phase 13 策定時点の非改変温存と Current Runtime 7 ビュー）

マスタープラン原本において「Phase 12 (Resource / Logistics)」は独立実装Phaseから削除されたが、既存の `active/manager/` に実装済みの以下ビューは**削除せず温存**し、現行 Runtime では 7 つのビュー（`overview`, `records`, `stocks`, `roster`, `requests`, `bulletin`, `mail`）が稼働している（Phase 13 策定時点の追加改修スコープから除外して既存挙動を維持）：

1. **保有チラシ (`stocks`)**: `getDashboardSnapshot` の `stocks` ドメインと連動して稼働（既存実装を維持）。
2. **受渡要請 (`requests`)**: `getDashboardSnapshot` の `transfers` ドメインと連動して稼働（既存実装を維持）。
3. **活動メール (`mail`)**: 案内文テンプレートコピーツールとして稼働（既存実装を維持）。
4. **スマホペアリング (`mobile`)**: モーダル表示ツール（既存実装を維持）。
5. **掲示板 (`bulletin`)**: `getBulletinPosts` 個別API通信により稼働（既存実装を維持）。

---

### (6) GAP-13-01 是正（初期表示の Universal 化）

`active/manager/index.html` 316行目に特定地区の旧件数「104」がハードコードされていたバグを是正し、初期表示を「`--`」に修正し、コメント内の特定件数表記を排除する。
これにより、マスターCSVがロードされる前に旧件数が一瞬チラつく現象を完全解消する。

---

## 4. Consequences & Compliance (影響と遵守事項)

- **Universal 原則の徹底**: コードベースから特定地区の件数・名前・IDのハードコードを排除し、完全なデータ駆動アーキテクチャを確立。
- **データ不可侵**: `data/address_master.csv` および `data/boundaries.geojson` は一切変更しない。
- **外部接続不可侵**: 旧KUWANAの外部接続切替には一切触れない。
- **リグレッションゼロ**: 既存の `manager.js` を無暗に変更・リファクタリングせず温存することで、稼働実績のあるコードの安定性を100%維持する。
