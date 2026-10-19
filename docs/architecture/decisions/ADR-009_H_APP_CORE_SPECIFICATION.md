# ADR-009: HアプリCoreアーキテクチャ仕様確定および地図エンジン公式採用決定 (H-App Core Specification and Map Engine Decision)

- **Status**: ACCEPTED (OFFICIAL SPECIFICATION)
- **Date**: 2026-09-24
- **Deciders**: Universal POSTING MAP Architecture Board / MASTER
- **Consulted**: `AGENTS.md`, `docs/architecture/01_DESIGN_CONTRACT.md`, `docs/api/API_CONTRACT.md`, `active/h-app/`, `tests/test_h_app_core_verification.mjs`

---

## 1. Context (背景と課題)

Phase 7（Pure DB / Snapshot）の完了に伴い、Phase 8「HアプリCore」の実装・確定フェーズへ移行した。
READ ONLY監査において、現場配布員向けUI（Hアプリ）の現行コードベース（`active/h-app/`）を精査した結果、以下の事実が確認された：

1. **現行実装の極めて高い完成度**:
   - 起動シーケンス、Identity同期、地図描画、マスターデータロード、活動入口（誤操作防止）、状態表示の6領域がすでに極めて強固かつ高度な水準で稼働している。
2. **地図エンジンの実態とマスタープラン表記の差異**:
   - 初期マスタープラン上には一部「Leaflet」の記述が存在していたが、Hアプリ実コードは **Google Maps JavaScript API**（Apple Styleダークテーマ）で最適化実装されている。
   - 一方で、統括管理用Web（`active/manager/`）は国土地理院タイルやオープンソース地図を活用した **Leaflet** を採用している。

これらを踏まえ、「Leafletへの強制換装」や「不要なゼロベース再構築・リファクタリング」を行わず、現行Hアプリの卓越した現場UXと堅牢なアーキテクチャをPhase 8公式仕様として正式確定する必要がある。

---

## 2. Decision (決定内容)

### (1) 地図エンジンの公式決定（適材適所の併存）
- **Hアプリ（現場配布員UI）の公式地図エンジン**:
  - **Google Maps JavaScript API** を正式採用する。
  - 本決定は「LeafletからGoogle Mapsへ変更した」という仕様変更ではなく、**「現行Hアプリの実装実態を確認した結果、現場モバイル環境での高精度ズーム、スムーズなベクター描画、ピン上部への精密なオフセットパン、ダークテーマ視認性を最適化するため、Google Maps JavaScript APIをHアプリの正式な地図エンジンとして採用する設計決定」** である。
- **Manager Dashboard（統括管理者UI）との併存**:
  - 管理者用Dashboard（`active/manager/`）における Leaflet 実装と、現場配布員用Hアプリ（`active/h-app/`）における Google Maps 実装は、それぞれのユースケースに特化した **「適材適所の併存アーキテクチャ」** として正式に位置づける。

### (2) HアプリCore 6領域の仕様確定

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【1. 起動】                                                                 │
│  index.html (LIFF初期化/認証判定) ──> active/h-app/index.html (safeInitApp)    │
│  Optimistic First Paint (キャッシュ即時描画) ➔ 非同期バックグラウンド同期   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【2. Identity】                                                             │
│  liffToken (生アクセストークン) ──> Backend (verifyLiffToken) ──> staffId SSOT │
│  DOM/URL/Cookieへの露出完全排除 (credentials: 'omit', localStorage内隔離)  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【3. 地域MAP】                                                              │
│  Google Maps JS API (language=ja, appleStyle 暗色テーマ)                    │
│  CustomMarkerOverlay: ピン上部20px中央配置 (translate(-50%, -100%))         │
│  DOM同一性チェック & idle時カメラ状態退避による「API同期時リセット防止」   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【4. 地図loader】                                                           │
│  動的APIキーロード (getMapsApiKey) & AddressMasterService.getAll() (CSV)   │
│  二重ロード・二重生成完全抑止ガード (googleMapsApiLoaded / masterMarkers)    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【5. 活動入口】                                                             │
│  CustomMarkerOverlay 内アクションボタン                                     │
│  1タップ目: 「配布開始」➔「入力操作」ラベル変化 (accidental tap防止ガード) │
│  2タップ目: openPointDetailModal(rowId) 呼出 (Phase 9への引継動線)          │
│  排他制御: 配布済み (🔒) / 作業中 (🔵) ピンの活動開始ロック                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 【6. 状態表示】                                                             │
│  総エリア数: data/address_master.csv (Frontend) がSSOT                      │
│  配布進捗・作業中ピン・認証状態: Backend (1地区専用DB) がSSOT                │
│  通信状態: navigator.onLine & API通信連動 (ONLINE / OFFLINE / SYNCING)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### (3) 非侵襲・0行変更原則の遵守
- 現行コード（`active/h-app/` 配下）はPhase 8要件を完全に満たしており、バグ・不整合も存在しないため、**プロダクションコードの改変は「0行（無変更）」** とする。
- `fetchSystemSummary()` の重複記述についても、`_systemSummaryPromise` キャッシュにより同一実行内の重複通信が安全に抑止されているため、Phase 8 時点ではリファクタリングを行わず現状維持とする（その後 Wave 16 にて `active/h-app/modules/summary.js` `SummaryModule` へ完全カプセル化・移管完了）。

### (4) Phase境界の厳格な分離（Phase 8では扱わないもの）
以下の業務処理・永続化ロジックは **Phase 9以降の専管領域** とし、Phase 8 Coreには一切侵入させない：
- `DistributionRecord`（実装クラス `DistributionEvent`）配布実績の永続化登録処理
- 証跡写真撮影および Google Drive アップロード処理
- GPS位置測位の確定・誤差判定処理
- IndexedDB オフラインキュー / Durable Queue 同期処理
- チラシ在庫・受渡申請・受渡承認処理
- 個人ランキング確定・集計ロジック
- Phase 9 Posting Flow（枚数入力確定以降の処理）

### (5) Universal原則の適合
- `active/h-app/` 配下のスクリプトに特定地区名（KUWANA等）、特定Spreadsheet ID、特定GAS URLのハードコードは一切含めない。
- すべて [data/config.js](../../../data/config.js)（`window.PMS_CLIENT_CONFIG`）および [data/address_master.csv](../../../data/address_master.csv) から動的解決する。

### (6) 物理パス是正 (2026-09-29 追記: Pure Rename)
- H-App の物理配置ディレクトリを旧来の誤認しやすい物理名から `active/h-app/` へ Pure Rename 実施。
- 本是正は H-App の責務変更、UI変更、Runtimeロジック変更ではなく、Manager Dashboard (`active/manager/`) との物理的混同を解消し、確定済みの商品構造（H-App = 現場配布員アプリ）に物理パス名を一致させるための名称整合である。

---

## 3. Consequences (影響と効果)

### 肯定的な結果
1. **最高峰の現場モバイル体験の維持**:
   - Google Maps JS API の卓越した描画パフォーマンス、スムーズなジェスチャー、Apple Styleの洗練されたダークテーマ、および2段階タップによる誤操作防止が公式に保証される。
2. **システム安定性の絶対的担保**:
   - 稼働実績のある完成コードに手を加えない（0行変更）ことで、リグレッションリスクをゼロに抑える。
3. **境界線の明確化**:
   - Phase 8（表示・閲覧・操作入口）と Phase 9（記録・永続化・オフライン同期）の境界が厳密に固定され、次フェーズの実装方針が明瞭化される。

### 留意事項
- Google Maps JavaScript API の利用には API Key（`getMapsApiKey` でBackendから動的配賦）が必要であり、各地区のGoogle CloudプロジェクトでのMaps JavaScript API有効化が前提となる（Universal Engineとしてプロビジョニング済）。

---

## 4. Compliance & Verification (適合性検証)

本決定書の有効性は、以下の総合検証テストスイートによって機械的に検証・証明される：
- [tests/test_h_app_core_verification.mjs](../../../tests/test_h_app_core_verification.mjs)
  - 起動導線、Identity境界、Google Maps設定、Loader二重化抑止、活動入口2段階タップ、状態表示SSOT、Phase境界、Universal原則の8大検証を全数PASSすること。
