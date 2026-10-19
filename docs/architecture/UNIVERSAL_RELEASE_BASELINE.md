# Universal Engine Release Baseline Specification

- **Version**: 1.0.1
- **Status**: RELEASED / FROZEN
- **Baseline Commit**: `7a6fda8846dee9cccf81c60c8ee8119d00285504`
- **Release Date**: 2026-09-27
- **Supreme Authority**: [AGENTS.md](../../AGENTS.md)
- **Master Plan**: [01_DESIGN_CONTRACT.md](01_DESIGN_CONTRACT.md)
- **Related Specifications**:
  - API契約: [API_CONTRACT.md](../api/API_CONTRACT.md)
  - データ辞書: [DATA_DICTIONARY.md](../data/DATA_DICTIONARY.md)
  - セキュリティ基準: [SECURITY_BASELINE.md](../security/SECURITY_BASELINE.md)

---

## 1. 概要と目的

Universal POSTING MAPは、Phase 0〜21（再構築フェーズ）の完了をもって **「Universal Engine v1.0」** として完成・リリースされた。
本書は、再構築後の運用・水平展開（Provisioning）・ライフサイクル管理における **絶対的不変基準（Baseline）** を定義し、コードベースおよび共通仕様の不当な改変を抑止（FREEZE）するための仕様書である。

> [!IMPORTANT]
> **Universal Engine 完成の定義**:
> 「1地区 = 1完成アプリ = 1単独フォルダー = 1単独リポジトリ = 1単独ドメイン = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS = 地区専用外部設定」のアーキテクチャ原則（AGENTS.md §1）のもと、日本全国のいかなる自治体・選挙区・支部であっても、**共通Runtime（`active/`）に一切変更を加えることなくデータ投入（Provisioning）のみで稼働可能である状態**。

---

## 2. Release Baseline Components & Versions

Universal Engine v1.0 における各コンポーネントのベースラインバージョンは以下の通り固定される。

| コンポーネント | バージョン | 概要 / 責務 | 基準ファイル / 定義 |
|:---|:---|:---|:---|
| **Universal Engine Core** | `v1.0.1` | 共通フロントエンド（H App / Dashboard）およびバックエンド（当該Spreadsheetに付属する1地区専用GAS Runtime） | `active/` 全域<br>`index.html` |
| **API Contract** | `v2.0.0` | Web App Gateway / RPC 通信規約（公開・管理アクション、認証ゲート、レスポンス構造） | `docs/api/API_CONTRACT.md`<br>`active/api/v2_api.js` |
| **Data Schema (District DB)** | `v1.0.0` | スプレッドシート ADR-024 Dual Lifecycle 標準スキーマ（SYSTEM_INFO + 実運用5シート<Key> + 現場2オンデマンド生成、DATA_DICTIONARY.md準拠）、カラム定義、数式注入防御 | `docs/data/DATA_DICTIONARY.md`<br>`active/business/` |
| **Provisioning Spec** | `v1.0.0` | 新地区プロビジョニング仕様、マスターデータ構造（住所・境界・自治体）、地区DB・付属1地区専用GASバインド規約 | `docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md` |
| **Security Baseline** | `v1.0.0` | SEC-001〜SEC-007 セキュリティ境界（セッション、サニタイズ、テナント分離、PIN秘匿等） | `docs/security/SECURITY_BASELINE.md` |
| **Deployment Baseline** | `v1.0.0` | 当該Spreadsheetに付属する1地区専用GAS、地区専用Web App公開、単一地区Spreadsheet直接解決 | `docs/operations/DISTRICT_PROVISIONING_RUNBOOK.md` |

---

## 3. Freeze Policy (凍結規程)

### 3.1 凍結対象 (Frozen Scope)
以下の領域は **「FROZEN（凍結）」** とし、新地区プロビジョニングや日常運用を理由とする改変を永久に禁止する。

1. **共通Runtime (`active/**`)**:
   - `active/api/`: APIディスパッチ、認証ゲート、セッション管理
   - `active/business/`: ドメインロジック（ポスティング、在庫、スタッフ、GPS等）
   - `active/infrastructure/`: スプレッドシート、キャッシュ、ロック、ドライブアダプター
   - `active/gas/`: GAS基盤初期化、デプロイゲート
   - `active/h-app/`: H-App / 配布員現場UI、オフラインキュー
   - `active/manager/`: Manager Dashboard / 管理画面UI/UX、セッションハンドラ
2. **API Contract (`docs/api/API_CONTRACT.md`)**:
   - アクション名、リクエスト/レスポンスパラメータ定義、エラーコード
3. **Data Schema & Sheet Structure (`docs/data/DATA_DICTIONARY.md`)**:
   - ADR-024 Dual Lifecycle 標準構造（SYSTEM_INFO + 実運用5シート<Key> + 現場2オンデマンド生成、DATA_DICTIONARY.md準拠）のカラム配列
4. **Identity & Tenant Boundary**:
   - `LINE User ID → Staff Identity → Branch → Target Area` 導出チェーン
   - `TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` 単一地区解決および `SYSTEM_INFO` Integrity Guard
5. **Universal Invariants (INV-001 〜 INV-009)**:
   - 1地区1アプリ/1リポジトリ/1ドメイン/1DB/付属1地区専用GAS原則、共通Runtime（`active/`）改変禁止原則、地域差=データ層吸収原則

### 3.2 凍結解除・変更プロトコル (Universal Gap Protocol)
新地区展開や運用過程において、万が一起動不可・機能不全が発生した場合、以下のプロトコルを厳格に執行する。

```text
[新地区プロビジョニング / 運用障害]
       │
       ▼
【即時 HARD STOP】 地区固有パッチを active/ に当てる行為を完全遮断
       │
       ▼
【原因分析 (Root Cause Analysis)】 地区データ起因か、Universal Engine構造起因かを切り分け
       │
       ├─ [地区データ起因]: データ修正・再プロビジョニング（Runtime不変更）
       │
       └─ [Universal Engine構造起因 (Universal Gap)]:
              │
              ▼
       【ADR立案】 アーキテクチャ変更理由、全国波及影響、代替案の策定
              │
              ▼
       【MASTER承認】 Scope Lock の事前合意
              │
              ▼
       【最小侵襲修正】 厳格な単一PR/コミットでの変更
              │
              ▼
       【全件Regression Test】 `npm test` 全スイート通過（新旧全地区互換性検証）
              │
              ▼
       【Security Audit】 SEC-001〜SEC-007 セキュリティ境界監査
              │
              ▼
       【Universal Version Up】 SemVer に基づくバージョン更新（例: v1.0.0 → v1.1.0）
```

---

## 4. Change Classification (変更区分)

システムの変更は以下の3段階に分類され、要求されるガバナンス手続きが異なる。

| 区分 | 分類名 | 変更対象 | 承認要件 | CI/CD・検証要件 |
|:---:|:---|:---|:---|:---|
| **Tier 1** | **District Provisioning / Config** | `data/`（地区投入時）, `TARGET_SPREADSHEET_ID` 等の Script Properties | 運用担当者 / 監査 | Provisioning Gate チェックリスト, API Smoke Test |
| **Tier 2** | **Governance & Documentation** | `docs/`, `AGENTS.md`, `.agents/` | MASTER レビュー | `git diff --check`, リンク整合性, 文書監査 |
| **Tier 3** | **Universal Engine Release Upgrade** | `active/`, `index.html`, API Contract, Data Schema | MASTER 承認（ADR必須） | 全件回帰テスト, セキュリティテスト, Production Acceptance, SemVer更新 |

---

## 5. Version-up Rules (バージョン管理規程)

Universal Engine のバージョンは **Semantic Versioning 2.0.0 (MAJOR.MINOR.PATCH)** に準拠する。

1. **MAJOR (`X.0.0`)**:
   - 後方互換性のない API Contract 変更、またはスプレッドシートデータスキーマの不可逆な破壊的変更。
   - 既存全地区のデータ移行（Migration Runbook）および全クライアントの強制更新を伴う。
2. **MINOR (`1.X.0`)**:
   - 後方互換性のある新機能追加、非破壊的なAPIパラメータ追加、既存地区への影響のない基盤拡張。
   - 既存地区のコード・データ変更なしでそのまま動作することが検証条件。
3. **PATCH (`1.0.X`)**:
   - 後方互換性のあるバグ修正、パフォーマンス改善、内部リファクタリング。
   - 仕様およびスキーマの変更を一切伴わない。

> [!CAUTION]
> **地区別バージョニングの禁止**:
> 「KUWANA版 v1.2」「AICHI版 v1.0」といった地区ごとのバージョン番号を付与してはならない。バージョンは常に **Universal Engine全体で単一（Single Version）** である。各地区は「どのUniversal Baselineバージョン上で稼働しているか」を追跡する。

---

## 6. Secret & Baseline Integrity

本書および関連するすべてのドキュメントにおいて、以下の機密情報保護原則を絶対とする。

1. **Secret値記載の絶対禁止**:
   - APIキー、トークン、パスワード、サービスアカウント鍵等の実値をドキュメントに記載してはならない。
   - ドキュメント上は常に環境変数名・プロパティ名（例: `GOOGLE_MAPS_API_KEY_<DISTRICT_ID>`）またはマスク表記（`[REDACTED]`）を用いる。
2. **Baseline Commit 保全**:
   - ベースラインコミット `7a6fda8846dee9cccf81c60c8ee8119d00285504` は Git タグ `v1.0.0-universal-baseline` として固定・保護される。
