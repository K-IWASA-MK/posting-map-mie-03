# REQUIREMENTS TRACEABILITY MATRIX (要件追跡性マトリクス)

- **Version**: 1.0.0 (Gate 4 Formal Deliverable)
- **Date**: 2026-09-22
- **Scope**: Universal POSTING MAP Architecture, Data, API, and Governance Contracts
- **Reference Standards**:
  - `AGENTS.md` (最上位基本就業規則)
  - `docs/architecture/01_DESIGN_CONTRACT.md` (最高位設計契約)
  - `docs/data/DATA_DICTIONARY.md` (データ辞書)
  - `docs/data/DATA_LIFECYCLE.md` (データライフサイクル規程)
  - `docs/api/API_CONTRACT.md` (API・異常系・排他制御・整合性契約)
  - `docs/architecture/decisions/ADR-001.md` 〜 `ADR-008.md`

---

## 1. 凡例とステータス定義

本マトリクスでは、机上の空論や未実装項目の過大評価を完全に排除するため、実態に基づき以下のステータスを厳格に適用する。

| ステータス | 定義 | 判定基準 |
|:---|:---|:---|
| **VERIFIED** | 実装および検証が完了し、契約との整合性が確認されている状態 | 現存するコード、既存テスト、検証ゲートスクリプト、または確定文書により検証可能なもの |
| **GAP** | 設計契約として確定しているが、現行コードへの実装または実機検証が未完了の状態 | 実機環境での負荷測定や専用シート整備が必要な項目 |
| **FUTURE IMPLEMENTATION** | 将来の計画として合意されているが、現フェーズでは未配備・将来検討とする状態 | Gate 8 以降のアーキテクチャ近代化や、機械的自動フック（`hooks.json` 等）の配備 |
| **UNDETERMINED** | 現行の仕様・インフラ環境からは一意に数値を特定できず、未確定である状態 | GAS の同時実行限界や Google インフラ内部の非公開クォータ挙動 |

---

## 2. Requirements Traceability Matrix

### 2.1 Architecture Domain (システム構造・基盤境界)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-ARCH-001** | 4層物理分離 | Client / 当該Spreadsheetに付属する1地区専用GAS / 1地区DB / Master Data の物理的分離 | [ADR-001](../architecture/decisions/ADR-001.md) | `DATA_LIFECYCLE.md` §1<br>`API_CONTRACT.md` §2 | `index.html`<br>`active/h-app/`<br>`active/api/v2_api.js`<br>`data/` | アーキテクチャ・境界検証ゲート（No regional code） | **VERIFIED** |
| **REQ-ARCH-002** | Universal Engine | 1地区=1完成アプリ=1単独フォルダー=1単独リポジトリ=1単独ドメイン。共通Runtime改変禁止、地域差はdata/で吸収 | [ADR-003](../architecture/decisions/ADR-003.md) | `01_DESIGN_CONTRACT.md` §1<br>`DATA_DICTIONARY.md` §0 | Git Root<br>`active/`<br>`data/` | Universal Boundary 検証ゲート（Universal Engine pureness） | **VERIFIED** |
| **REQ-ARCH-003** | `active/` 不可侵境界と共通進化 | 地区特化のための変更は禁止。共通改善・バグ修正はGate統制下で許容 | [ADR-003](../architecture/decisions/ADR-003.md) | `AGENTS.md` §1<br>`01_DESIGN_CONTRACT.md` §1 | `active/` 全域 | 変更前の事前宣言および事後 `git diff` 差分照合 | **VERIFIED** |
| **REQ-ARCH-004** | レガシー互換性・実行環境制約 | IIFE / グローバル Singleton 構造の当面尊重と近代化境界の分離 | [ADR-007](../architecture/decisions/ADR-007.md) | `API_CONTRACT.md` §2 | `active/h-app/app.js`<br>`active/api/v2_api.js`<br>`active/business/` | コード構造監査（既存の即時実行関数および単一インスタンス管理を確認） | **VERIFIED** |
| **REQ-ARCH-005** | シート面 Pure DB 原則 | スプレッドシートのシート面内にカスタム関数、シート編集トリガー、マクロを内包しない | [ADR-001](../architecture/decisions/ADR-001.md) | `01_DESIGN_CONTRACT.md` §2<br>`DATA_LIFECYCLE.md` §1 | Google Spreadsheet DB | 1地区専用GAS / DB 境界検査 | **VERIFIED** |

---

### 2.2 Data Model & Business Invariants Domain (業務不変条件・データ契約)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-DATA-001** | 自由配布・非事前割当モデル | 個人への担当エリア・活動可能地域割当の完全排除 (`Person → AssignedArea` 不存在) | [ADR-002](../architecture/decisions/ADR-002.md) | `01_DESIGN_CONTRACT.md` §3<br>`DATA_DICTIONARY.md` §0, §5 | `active/h-app/app.js`<br>`active/api/v2_api.js` | データスキーマ監査および `grep` 照合（担当割当ロジック不在を確認） | **VERIFIED** |
| **REQ-DATA-002** | 支部活動制限の排除 | 支部による党員の活動地域制限モデルの排除 (`Branch → AllowedRegion → Person` 不存在) | [ADR-002](../architecture/decisions/ADR-002.md) | `AGENTS.md` §2<br>`DATA_DICTIONARY.md` §5 | `active/h-app/app.js`<br>`active/business/` | コード監査（支部外活動拒否ロジックが存在しないことを確認） | **VERIFIED** |
| **REQ-DATA-003** | ノルマ・強制管理の排除 | 個人ノルマ、出勤・参加管理、未達ペナルティの完全排除 | [ADR-002](../architecture/decisions/ADR-002.md) | `DATA_DICTIONARY.md` §0, §5 | `active/h-app/`<br>`active/business/` | UIおよびバックエンドロジック監査 | **VERIFIED** |
| **REQ-DATA-004** | 客観的事実の記録 | 配布実績は「誰が・いつ・どこで・何枚」という確定事実のみを記録 (1か月・1 rowId = 1行) | [ADR-002](../architecture/decisions/ADR-002.md)<br>[ADR-005](../architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`DATA_LIFECYCLE.md` §2 | `配布実績<Key>` シート<br>`active/business/gps/` | スキーマ定義および初回完了記録・既存実績保護監査 | **VERIFIED** |
| **REQ-DATA-005** | 状態と事実の厳格分離 | PinStatus (一時状態) と DistributionRecord (`DistributionEvent` 確定事実) の責務分離 | [ADR-002](../architecture/decisions/ADR-002.md)<br>[ADR-005](../architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1, §3<br>`DATA_LIFECYCLE.md` §2 | `active/business/pin/`<br>`active/business/distribution/` | 状態更新と実績追記の独立分離コード監査 | **VERIFIED** |
| **REQ-DATA-006** | 個人ランキングの動機付け純化 | ランキングは自発的活動促進のための機能であり、管理・評価に使用しない | [ADR-002](../architecture/decisions/ADR-002.md) | `DATA_DICTIONARY.md` §4<br>`DATA_LIFECYCLE.md` §4 | `active/h-app/`<br>`active/business/distribution/` | UI表示・集計ロジック監査 | **VERIFIED** |
| **REQ-DATA-007** | Spreadsheet DB 正本 (SSOT) | 確定データは Spreadsheet DB にのみ存在し、端末キャッシュは一時ミラー | [ADR-005](../architecture/decisions/ADR-005.md) | `DATA_DICTIONARY.md` §1<br>`DATA_LIFECYCLE.md` §1 | Google Spreadsheet DB | アーキテクチャ設計監査 | **VERIFIED** |
| **REQ-DATA-008** | rowId と requestId の分離 | rowId (町丁目地理ID) と requestId (完了操作UUID v4) の概念・判定分離 | [ADR-005](../architecture/decisions/ADR-005.md)<br>[ADR-009](../architecture/decisions/ADR-009.md) | `DATA_DICTIONARY.md` §1<br>`API_CONTRACT.md` §4, §17 | `active/h-app/app.js`<br>`active/business/gps/` | バックエンドでの requestId 受領・照合・重複排除実装確認 | **VERIFIED** |
| **REQ-DATA-009** | 正当な配布実績の保護 | 同一 rowId の当月完了存在時は Already Completed として既存実績保護、timestamp winner 上書き禁止 | [ADR-005](../architecture/decisions/ADR-005.md)<br>[ADR-009](../architecture/decisions/ADR-009.md) | `DATA_DICTIONARY.md` §1<br>`API_CONTRACT.md` §4, §17 | `active/business/gps/gps_service.js` | 月内1行固定・既存実績保護処理の監査（上書き・二重書込0確認） | **VERIFIED** |
| **REQ-DATA-010** | Server Wins の厳格定義 | 競合時の確定正本優先原則であり、既存実績を上書き消去する権限ではない | [ADR-005](../architecture/decisions/ADR-005.md) | `API_CONTRACT.md` §17<br>`DATA_LIFECYCLE.md` §2 | `active/h-app/app.js`<br>`active/business/` | 整合性解決ロジック監査 | **VERIFIED** |

---

### 2.3 API & Offline Sync Domain (通信・排他制御・セキュリティ)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-API-001** | オフラインキュー | IndexedDB (`PostingMapDB` / `syncQueue`) によるオフライン時データ保護とFIFO送信 | [ADR-004](../architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §10 | `active/h-app/db.js` (L14-15)<br>`active/h-app/app.js` | IndexedDB 実装コード監査 (`PostingMapDB`, `syncQueue`) | **VERIFIED** |
| **REQ-API-002** | クライアント多重送信防止 | `isProcessing` フラグによる排他制御 | [ADR-004](../architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §14 | `active/h-app/db.js` | キュー送出処理排他制御コード監査 | **VERIFIED** |
| **REQ-API-003** | バックオフリトライ | 通信障害・混雑時の段階的バックオフ (10s, 30s, 60s, 60s; 最大5回) | [ADR-004](../architecture/decisions/ADR-004.md)<br>[ADR-012](../architecture/decisions/ADR-012_DURABLE_QUEUE_SPECIFICATION.md) | `API_CONTRACT.md` §3, §10 | `active/h-app/db.js` | リトライ遅延計算コード監査 (`RETRY_DELAYS_MS`) | **VERIFIED** |
| **REQ-API-004** | バックエンド排他制御 | GAS `LockService.getScriptLock()` による保護（`gps_service.js` `waitLock(15000)` / `lock_adapter.js` 10000ms） | [ADR-004](../architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §11, §13 | `active/business/gps/gps_service.js`<br>`active/infrastructure/lock/lock_adapter.js` | スクリプトロック待機コード監査 (`lock.waitLock(15000)`) | **VERIFIED** |
| **REQ-API-005** | 非現実的ロック制約の排除 | 「ロック保持時間1秒未満」の不採用（Drive/SS I/O 実態を反映） | [ADR-004](../architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §11 | `active/business/distribution/` | 設計決定確定（無理なタイマー制限の排除を確認） | **VERIFIED** |
| **REQ-API-006** | requestId 冪等性保証 | 同一 UUID v4 の再送検知時に二重書き込みをスキップし duplicate 返却 | [ADR-005](../architecture/decisions/ADR-005.md)<br>[ADR-009](../architecture/decisions/ADR-009.md) | `API_CONTRACT.md` §13<br>`DATA_LIFECYCLE.md` §2 | `active/business/gps/gps_service.js`<br>`active/business/gps/gps_repository.js` | Q列 requestId 照合による duplicate 判定・DB書込0確認 (`test_durable_queue_verification.mjs`) | **VERIFIED** |
| **REQ-API-007** | Hアプリ主認証 | LINE LIFF Bearer Token + LINE Profile API 直接検証 | [ADR-006](../architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `index.html`<br>`active/api/v2_api.js`<br>`active/api/auth/` | LIFF 初期化・API 検証コード監査 | **VERIFIED** |
| **REQ-API-008** | 認証キャッシュ | GAS `CacheService` による検証済みユーザー情報の 30分間 (1800s) キャッシュ | [ADR-006](../architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `active/api/v2_api.js` | キャッシュ参照・保存コード監査 | **VERIFIED** |
| **REQ-API-009** | HMAC 主認証の完全排除 | フロントエンドゼロシークレット原則の遵守（HMAC 共有鍵の埋め込み禁止） | [ADR-006](../architecture/decisions/ADR-006.md) | `API_CONTRACT.md` §2, §6 | `active/h-app/`<br>`index.html` | フロントエンドソースコード全数 `grep`（秘密鍵不在を確認） | **VERIFIED** |
| **REQ-API-010** | Identity 強制解決チェーン | `lineUserId` から Staff Master を引いて `staffId` / `branchId` をサーバー解決 | [ADR-006](../architecture/decisions/ADR-006.md) | `AGENTS.md` §2<br>`DATA_DICTIONARY.md` §2<br>`API_CONTRACT.md` §7 | `active/api/v2_api.js`<br>`active/business/staff/` | クライアント送信パラメータ無視およびサーバー強制解決コード監査 | **VERIFIED** |
| **REQ-API-011** | シークレット隔離境界 | スプレッドシートID等の機密情報は `ScriptProperties` に隔離しコード露出ゼロ | [ADR-006](../architecture/decisions/ADR-006.md) | `01_DESIGN_CONTRACT.md` §2<br>`API_CONTRACT.md` §2, §6 | `active/api/v2_api.js` (L440)<br>Google Apps Script プロパティ | `PropertiesService.getScriptProperties()` 参照確認・平文不在確認 | **VERIFIED** |
| **REQ-API-012** | 高負荷時耐性・同時実行挙動 | GAS 同時実行集中時の挙動特定、適切な 429/503 返却とエラーハンドリング | [ADR-004](../architecture/decisions/ADR-004.md) | `API_CONTRACT.md` §3, §10, §13 | `active/api/v2_api.js`<br>`active/infrastructure/lock/` | 実機環境での負荷テスト未実施（GAS同時実行クォータ限界はGoogle依存） | **GAP**<br>(一部 **UNDETERMINED**) |
| **REQ-API-013** | 構造化監査ログ基盤 | 操作・エラー・セキュリティイベントを構造化 JSON で永続化 | [ADR-008](../architecture/decisions/ADR-008.md) | `API_CONTRACT.md` §16 | `active/api/v2_api.js`<br>`AuditLog` シート | 専用 AuditLog シートおよびフォーマット統一未配備（`console.log` のみ） | **GAP** |

---

### 2.4 Governance & AI Agent Domain (変更統制・運用原則)

| REQ-ID | 要件 | 不変条件 / Design Contract | ADR | Data / API Contract | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-GOV-001** | リポジトリ境界 (永久原則) | 作業対象 Git root を絶対境界とし、SSD 上の他地区リポジトリ参照を永久禁止 | [ADR-003](../architecture/decisions/ADR-003.md)<br>[ADR-008](../architecture/decisions/ADR-008.md) | `AGENTS.md` §3 | AI Agent 探索・作業環境 | リポジトリ境界・Universal Cleanliness 検証ゲート（No reference to other districts） | **VERIFIED** |
| **REQ-GOV-002** | 9-Stage Protocol 変更統制 | Gatekeeper → Plan → Scope Lock → Impl → Verify → Commit → Audit/Gate → Push/Deploy → Runtime → Cleanup Gate の厳守 | [ADR-008](../architecture/decisions/ADR-008.md) | `AGENTS.md` §6, §7<br>`01_DESIGN_CONTRACT.md` §1 | `.agents/workflows/development/workflow.md` | Gate 0〜9 の進捗・コミット履歴・機械検証ゲート証跡 | **VERIFIED** |
| **REQ-GOV-003** | 最小権限・実行モード分離 | READ / AUDIT / DESIGN / DOC ONLY 等、フェーズに応じた権限の厳格制限 | [ADR-008](../architecture/decisions/ADR-008.md) | `.agents/rules/agent-authority.md` | AI Agent プロンプト・就業規則 | Gate指示ごとのモード遵守確認 | **VERIFIED** |
| **REQ-GOV-004** | 事前宣言と事後差分照合 | ファイル変更前の日本語事前宣言と、完了後の `git diff` 1行単位照合 | [ADR-008](../architecture/decisions/ADR-008.md) | `AGENTS.md` §4 | Git 差分管理 | 未宣言変更ゼロの確認（No Silent Changes） | **VERIFIED** |
| **REQ-GOV-005** | Human-in-the-Loop | コミット、プッシュ、デプロイ、破壊的変更における人間監督者（MASTER）承認 | [ADR-008](../architecture/decisions/ADR-008.md) | `AGENTS.md` §4, §6 | 変更承認ワークフロー | MASTER の明示的承認履歴 | **VERIFIED** |
| **REQ-GOV-006** | 予期せぬ状態での即時停止 | 不整合・テスト失敗・宣言外変更検知時の自己判断修正禁止と HARD STOP | [ADR-008](../architecture/decisions/ADR-008.md) | `AGENTS.md` §4 | AI Agent 行動原則 | 異常検知時の停止・エスカレーション実績 | **VERIFIED** |
| **REQ-GOV-007** | 機械的 PreToolUse ガバナンス | AST 静的解析・MCP PreToolUse による未承認コマンド・コードの機械的ブロック | [ADR-008](../architecture/decisions/ADR-008.md) | `API_CONTRACT.md` §18 | `hooks.json`<br>`mcp_config.json`<br>静的解析ツール群 | 現時点では未配備（運用規則による統制のみ有効） | **FUTURE IMPLEMENTATION** |

---

### 2.5 Product Lifecycle Domain (製品ライフサイクル・展開運用境界)

| REQ-ID | 要件 | 不変条件 / Design Contract | 仕様書 / Runbook | ADR / Standard | Implementation Target | Verification | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **REQ-LIFE-001** | Release Baseline & Freeze Policy | Universal Engine v1.0 完成後の共通Runtime・API・Schemaの凍結とUniversal Gap管理 | `01_DESIGN_CONTRACT.md` §26.2<br>`UNIVERSAL_RELEASE_BASELINE.md` | [ADR-022](../architecture/decisions/ADR-022_MULTI_REGION_ARCHITECTURE_SPECIFICATION.md) | `active/**`<br>`index.html` | Git Baseline Commit固定、回帰テスト通過 | **VERIFIED** |
| **REQ-LIFE-002** | District Provisioning & Acceptance Gate | 共通コード変更ゼロによる新地区投入、1地区専用GAS配備、および受入検査によるACTIVE昇格判定 | `01_DESIGN_CONTRACT.md` §26.3, §26.9<br>`DISTRICT_PROVISIONING_RUNBOOK.md` | [ADR-010](../architecture/decisions/ADR-010.md)<br>[ADR-022](../architecture/decisions/ADR-022_MULTI_REGION_ARCHITECTURE_SPECIFICATION.md) | `TARGET_SPREADSHEET_ID`<br>`SYSTEM_INFO`<br>`data/` | Acceptance Gate 21項目全件合格証跡 | **VERIFIED** |
| **REQ-LIFE-003** | Security Baseline (SEC-001〜007) | サーバーセッション、数式注入防御、テナント分離、PIN秘匿、地区別MapsKeyの恒久境界 | `01_DESIGN_CONTRACT.md` §26.11<br>`SECURITY_BASELINE.md` | [ADR-016](../architecture/decisions/ADR-016_SECURITY_ARCHITECTURE.md)<br>[ADR-023](../architecture/decisions/ADR-023_DASHBOARD_SHARED_PIN_SESSION_SPECIFICATION.md) | `active/api/`<br>`active/business/`<br>`active/h-app/` | SEC-001〜007 専用回帰テストスイート通過 | **VERIFIED** |
| **REQ-LIFE-004** | Backup & Restore Architecture | 1地区DB・メタデータの日次保全、秘密情報の平文除外、リストア手順および定期訓練 | `01_DESIGN_CONTRACT.md` §26.5<br>`BACKUP_RESTORE_RUNBOOK.md` | `DATA_LIFECYCLE.md` | Google Drive / Backup Folder | リストア手順・整合性検証チェックリスト | **VERIFIED** |
| **REQ-LIFE-005** | District Deprovisioning & Privacy | 一時停止と完全廃止の分離、API Key即時Revoke、個人情報消去、1地区専用GAS停止 | `01_DESIGN_CONTRACT.md` §26.4, §26.10<br>`DISTRICT_DEPROVISIONING_RUNBOOK.md` | `DATA_LIFECYCLE.md` | 1地区専用GAS Properties<br>GCP Console<br>Spreadsheet | 廃止完了検証チェックリスト通過 | **VERIFIED** |
| **REQ-LIFE-006** | Continuous Monitoring & Incident SLO | APIエラー、レイテンシ、排他ロック、障害Severity定義、復旧エスカレーション | `01_DESIGN_CONTRACT.md` §26.6, §26.7<br>`UNIVERSAL_RELEASE_BASELINE.md` | [ADR-021](../architecture/decisions/ADR-021_PRODUCTION_MONITORING_SPECIFICATION.md) | Cloud Logging<br>GAS Executions | 暫定SLO定義、インシデントフロー確立 | **VERIFIED** |

---

## 3. ステータス集計と分析

### 3.1 ステータス内訳

| ステータス | 件数 | 割合 | 主な対象項目 |
|:---|:---:|:---:|:---|
| **VERIFIED** | **38** | 92.7% | 4層分離、Universal Engine、自由配布モデル、SSOT、`requestId` 冪等性照合、ScriptLock、LINE認証、Git境界、9-Stage Protocol、製品ライフサイクル全般 等 |
| **GAP** | **2** | 4.9% | GAS高負荷耐性実測 (REQ-API-012)、構造化監査ログ基盤 (REQ-API-013) |
| **FUTURE IMPLEMENTATION** | **1** | 2.4% | 機械的 PreToolUse 自動フック (`hooks.json` / MCP ガバナンス設定: REQ-GOV-007) |
| **合計** | **41** | 100.0% | 全要件追跡項目 |

※ REQ-API-012 の一部（GAS 同時実行集中時の Google インフラ内部クォータ挙動）は「UNDETERMINED（外部依存のため未確定）」として内包・取り扱います。

### 3.2 解決済み事項および残存GAP分析

1. **`requestId` 冪等性照合機構の実装完了 (REQ-DATA-008, REQ-API-006 — VERIFIED)**:
   - Phase 10（Durable Queue）において、`GPSService.updateRecordWithGPSPhoto` および `GPSRepository`（Q列 `requestId` 照合）ならびに `DistributionService.submitDistribution`（`CacheService` 照合）による冪等性保証が実装・検証完了済み（`test_durable_queue_verification.mjs`）。
2. **高負荷耐性・同時実行性能の実測 (REQ-API-012 — GAP)**:
   - GAS の `LockService.waitLock(15000)` が同時多発アクセス時にどのように競合を解消するか、429/503 が返却された際にクライアントの段階的バックオフが正常にリトライを吸収するかを実機テスト環境で継続監視する。
3. **構造化監査ログ基盤の整備 (REQ-API-013 — GAP)**:
   - 現状の `console.log` 出力から、API リクエスト ID、検証結果、所要時間、IP/User-Agent 等を記録する専用 `AuditLog` シート出力ユーティリティの整備は将来課題とする。
