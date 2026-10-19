# Universal POSTING MAP — API契約 (API_CONTRACT.md)
## Gate 3: API Architecture & Failure/Integrity/Governance Contract — Official Deliverable

> **本書の目的と最高位原則**:
> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §22, Gate 3 出口基準）および
> Gate 3 確定指示に基づき、Universal POSTING MAP における API 契約（API Contract）、異常系契約（Failure Contract）、
> データ整合性契約（Data Integrity Contract）、運用契約（Operational Contract）、および
> AI Agent / MCP 実行ガバナンス契約（Governance Contract）を規定した公式設計書である。
>
> **最上位不変原則**:
> 1. **ポスティングは完全に自由**: 個人担当エリア・個人活動可能地域・ノルマ・強制参加モデルは一切存在しない。
> 2. **所属支部と活動場所の完全分離**: 「支部の活動対象地域」は組織上の管理・観測対象地域であり、「党員のポスティング可能範囲」ではない。所属支部から活動場所を制限・限定・選択肢化してはならない。
> 3. **配布実績（事実）の記録**: 「誰が・いつ・どこで・何枚配ったか」という発生した客観的事実のみを記録する。
> 4. **Hアプリのランキングは動機付け機能**: 配布員本人のモチベーション・活動意欲を高めるための機能であり、管理・監督・評価のための機能ではない。評価スコア（`rankingScore` 等）は新設しない。
> 5. **操作単位の冪等性と月次進捗保護**: `rowId`（町丁目識別子）と `requestId`（操作単位の冪等性キー）を厳格に分離し、同一 `requestId` の再送のみを duplicate 扱いとし、当月完了行に対する別 `requestId` は `alreadyCompleted` として既存実績を保護する（同月再配布なし、翌月新月シートで新規開始）。
> 6. **基盤適合性**: Google Apps Script（当該Spreadsheetに付属する1地区専用GAS）および Google Spreadsheet（地区専用DB）の実行環境・制約と整合した、実現可能な契約として定義する（非現実的なRDB前提の一般論を排除）。
> 7. **AI Agent / MCP ガバナンスの確立**: 最小権限、読み書き分離、リポジトリ境界、人間による承認（Human-in-the-Loop）を強制する。

---

## 目次 (Table of Contents)

1. [Purpose (目的)](#1-purpose-目的)
2. [System Boundary / Context Diagram (システム境界・コンテキスト図)](#2-system-boundary--context-diagram-システム境界コンテキスト図)
3. [API Interface (通信方式・プロトコル)](#3-api-interface-通信方式プロトコル)
4. [Authentication (認証アーキテクチャ)](#4-authentication-認証アーキテクチャ)
5. [Identity Resolution (Identity強制解決)](#5-identity-resolution-identity強制解決)
6. [Authorization (認可モデル)](#6-authorization-認可モデル)
   - [6.1 District Integrity Verification & Authorization Boundary (地区整合性検証と認可境界)](#61-district-integrity-verification--authorization-boundary-地区整合性検証と認可境界)
7. [Data Model (データモデル整合性)](#7-data-model-データモデル整合性)
8. [DistributionRecord API (配布実績登録契約 — 実装モデル: `DistributionEvent`)](#8-distributionrecord-api-配布実績登録契約)
9. [Ranking API (個人ランキング契約)](#9-ranking-api-個人ランキング契約)
10. [Dashboard Read API (全体観測契約)](#10-dashboard-read-api-全体観測契約)
11. [Validation / Boundary Conditions (入力検証・境界条件)](#11-validation--boundary-conditions-入力検証境界条件)
12. [State Machine (状態遷移マシン)](#12-state-machine-状態遷移マシン)
13. [Idempotency / Concurrency (冪等性・並行性排他制御・月次進捗保護)](#13-idempotency--concurrency-冪等性並行性排他制御月次進捗保護)
14. [Error Contract (エラー契約・障害分類)](#14-error-contract-エラー契約障害分類)
15. [Timeout / Retry (タイムアウト・リトライ契約 & 状態遷移マトリクス)](#15-timeout--retry-タイムアウトリトライ契約--状態遷移マトリクス)
16. [Offline / Synchronization (オフライン同期・永続化保証)](#16-offline--synchronization-オフライン同期永続化保証)
17. [SSOT / Reconciliation (真実の情報源と不整合調停)](#17-ssot--reconciliation-真実の情報源と不整合調停)
18. [Security (セキュリティ契約)](#18-security-セキュリティ契約)
19. [Structured Logging / Traceability (構造化ログ・追跡性)](#19-structured-logging--traceability-構造化ログ追跡性)
20. [Monitoring / Audit (監視・監査運用設計)](#20-monitoring--audit-監視監査運用設計)
21. [Versioning / Backward Compatibility (バージョニング・後方互換性)](#21-versioning--backward-compatibility-バージョニング後方互換性)
22. [Rollback / Recovery (ロールバック・障害復旧手順)](#22-rollback--recovery-ロールバック障害復旧手順)
23. [RPO / RTO (目標復旧地点・目標復旧時間)](#23-rpo--rto-目標復旧地点目標復旧時間)
24. [AI Agent & MCP Governance (AIエージェント・MCP実行ガバナンス契約)](#24-ai-agent--mcp-governance-aiエージェントmcp実行ガバナンス契約)
25. [未確定事項 (Unconfirmed Items)](#25-未確定事項-unconfirmed-items)
26. [現行実装との対比・GAP分析 (EXISTING / REQUIRED / GAP)](#26-現行実装との対比gap分析-existing--required--gap)
27. [Production Smoke Test & Migration API Contracts (本番スモークテストおよびマイグレーションAPI契約)](#27-production-smoke-test--migration-api-contracts-本番スモークテストおよびマイグレーションapi契約)
   - [27.3 新地区データベース生成管理 API 契約 (createDistrictDatabase)](#273-新地区データベース生成管理-api-契約-createdistrictdatabase)

---

## 1. Purpose (目的)

Universal POSTING MAP において、現場で活動する配布員が利用する「Hアプリ」、組織の観測者が利用する「Dashboard」、業務ロジック・永続化を司る「Backend (当該Spreadsheetに付属する1地区専用GAS / 地区専用Spreadsheet)」、および開発・保守・監査を自律的・半自律的に支援する「AI Agent / MCP ツール群」の間で交換されるすべてのデータ通信契約・運用規範を定義する。

本書は単なるエンドポイント一覧にとどまらず、ネットワーク寸断、端末故障、並行アクセス、認証失効などの異常系（Failure Contract）、データ確定・重複防止（Data Integrity Contract）、障害検知・復旧（Operational Contract）、および AI エージェントの誤動作・権限逸脱を防ぐ統制モデル（Governance Contract）を包括的に規定する。

---

## 2. System Boundary / Context Diagram (システム境界・コンテキスト図)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【現場境界】                                                                │
│  配布員 (Person)                                                            │
│     │ 完全に自由なポスティング活動 (活動場所制限・担当エリアなし)           │
│     ▼                                                                       │
│  Hアプリ (Field Operations UI)                                              │
│     ├─ IndexedDB (PostingMapDB / syncQueue: オフライン永続化)               │
│     ├─ Device API (GPS測位・カメラ撮影・UUID発番)                           │
│     └─ Client API Engine (AbortController, 指数バックオフリトライ)         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS POST/GET (JSON / liffToken)
                                       │ 302 Follow Redirect
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 【API・ロジック境界】                                                       │
│  Backend / API Gateway (当該Spreadsheetに付属する1地区専用GAS: v2_api.js)   │
│     ├─ Auth Gateway: LINE Profile API トークン検証 (CacheService 30分)      │
│     ├─ Identity Resolver: staffId / staffName の強制上書き (クライアント無効化)│
│     ├─ Validation Engine: 型・境界値・Base64・サイズ厳格検証                │
│     ├─ Concurrency Control: LockService 排他ロック (15秒悲観ロック)         │
│     └─ Idempotency Engine: requestId 照合による二重書込防止 (再配布は受容) │
└───────────────────┬─────────────────────────────────────┬───────────────────┘
                    │ 永続化 (Lock下更新)                 │ データ提供 (ReadOnly)
                    ▼                                     ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│ 【永続化境界 (地区専用DB)】          │  │ 【統括観測境界】                  │
│  Google Spreadsheet / Drive          │  │  Dashboard (Manager UI)           │
│   ├─ 配布実績<Key> (事実の正本)      │  │   ├─ 進捗観測 (完了率・総枚数)   │
│   ├─ 名簿<Key> (配布員Identity)      │  │   ├─ 時系列実績観測 (誰がいつどこで)│
│   ├─ 保有チラシ枚数<Key> (在庫記録)  │  │   ├─ GPS/写真監査プレビュー       │
│   ├─ Google Drive (証跡写真保管)     │  │   └─ スタッフ別実績一覧 (観測用)  │
│   └─ 当該Spreadsheet付属GASと1対1結合│  │   ※ Hアプリへ指示を出さない     │
└──────────────────────────────────────┘  └───────────────────────────────────┘
                    ▲
                    │ 監査・検査・制御 (MCP 経由 / 最小権限)
┌───────────────────┴─────────────────────────────────────────────────────────┐
│ 【AI Agent / MCP 実行統制境界】                                             │
│  AI Agents (architect / execution / worker / auditor / deployer)            │
│   ├─ MCP Architecture (Tool Registry, Read/Write Separation)                │
│   ├─ Workspace Boundary (他地区リポジトリ参照の完全遮断【永久原則】)        │
│   ├─ PreToolUse Hard Block (危険コマンド・未承認操作の事前強制停止)         │
│   └─ Human-in-the-Loop (MASTER 承認必須: Commit / Push / Deploy)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. API Interface (通信方式・プロトコル)

### (1) 通信プロトコル仕様
- **プロトコル**: HTTPS (TLS 1.2 / 1.3 必須)
- **エンドポイント**: 当該Spreadsheetに付属する1地区専用 Google Apps Script Web App 公開URL
  - 形式: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`
- **GAS 固有通信仕様 (重要)**:
  - GAS Web App は、リクエスト受信時に Google の認証・プロキシ層を経由し、`302 Moved Temporarily` を返却して `https://script.googleusercontent.com/...` へリダイレクトする。
  - クライアント通信設定として `redirect: 'follow'` が**必須**。
  - クロスオリジン通信のため `mode: 'cors'`, `credentials: 'omit'` を適用。
  - キャッシュ事故防止のため `cache: 'no-store'` および URLパラメータ `_t=${Date.now()}` を付与。

### (2) HTTP メソッドの運用契約
| メソッド | 適用対象 | 特記事項・禁止事項 |
|---|---|---|
| **GET** | 公開マスター読み取り、ヘルスチェック | **禁止**: `liffToken` を GET クエリに含めること（URLログ漏洩防止）。トークンを含むリクエストは即時 `400 Bad Request` 拒絶。 |
| **POST** | 業務データ送信、認証必須API、長大データ送信 | すべての書き込み操作、および認証・個人情報を含む読み出し操作は POST JSON ボディにて送信する。 |

---

## 4. Authentication (認証アーキテクチャ)

### (1) 認証方式
- **認証基盤**: LINE Front-end Framework (LIFF) Access Token（`GET https://api.line.me/v2/profile` 検証）
- **トークン送信方式**: POST JSON ペイロード内の `liffToken` フィールドに格納して送信。
- **検証プロトコル**:
  ```text
  Client (Hアプリ)                Backend (GAS)                 LINE Platform
       │                               │                             │
       │── POST (liffToken: "...") ───►│                             │
       │                               │── CacheService 照合 (SHA256)│
       │                               │   [HIT (有効期限30分以内)]  │
       │                               │   ──► セッション復帰        │
       │                               │                             │
       │                               │   [MISS]                    │
       │                               │── GET /v2/profile ─────────►│
       │                               │   (Authorization: Bearer)   │
       │                               │◄─ 200 OK (userId, name) ────│
       │                               │── CacheService 保存 (1800s) │
       │                               │                             │
  ```

### (2) トークン検証キャッシュ仕様
- **キャッシュキー**: `AUTH_SESSION_` + SHA-256(`liffToken`) (平文トークンをキーにしない)
- **保管場所**: `CacheService.getScriptCache()`
- **TTL (有効期間)**: 1,800秒 (30分)
- **保存データ**: `{ lineUserId, displayName, pictureUrl, createdAt }`

### (3) クライアント側 HMAC 共有鍵の完全却下 (REJECT - ADR-006)
- Hアプリはブラウザおよび PWA 環境（HTML/JavaScript）で動作するクライアントアプリケーションである。クライアントに共有鍵（HMAC Secret）を保持させた場合、開発者ツールや逆コンパイルにより即座に鍵が抽出・漏洩し、認証境界が根本から崩壊する。
- したがって HMAC 主認証案は完全に却下し、LINE LIFF Bearer Token + サーバー側強制解決 + ScriptProperties シークレット隔離を主認証基盤として維持する（「フロントエンドに秘密情報を絶対に配置しない（No Secrets in Frontend）」原則）。

### (4) 業務データ直接 Fetch の絶対禁止 (Data Provisioning Security Rule)
- 業務データ（CSV等）は、GitHub Pages 等の静的ホスティングからクライアント側で直接 Fetch してはならない。必ず GAS（`v2_api`）認証境界を経由し、認証・認可を通過した状態で取得すること。

---

## 5. Identity Resolution (Identity強制解決)

クライアント（ブラウザ・端末）から送信されたユーザー識別情報は**一切信用しない**。

```text
受信ペイロード (改ざん・偽装の可能性あり)
  { "liffToken": "...", "staffId": "STF-99999", "staffName": "詐称名" }
                     │
                     ▼
Backend: authenticateRequest(postData)
  ├─ 検証済み LINE User ID を抽出 ("U1234567890abcdef...")
  ▼
Backend: StaffService.resolveStaffIdentity(lineUserId)
  ├─ 名簿<Key> (SSOT) を照合
  ▼
Backend: ペイロード強制上書き (クライアント送信値を破棄)
  postData.staffId = identity.staffId;         // 例: "STF-00000-001"
  postData.staffName = identity.staffName;     // 例: "山田 太郎"
  postData.resolvedLineUserId = lineUserId;    // 内部監査専用
```

---

## 6. Authorization (認可モデル)

システム内の API アクションは、以下の5つの認可レベルに厳格に分類される。

| 認可レベル | 対象アクション例 | 必要な資格情報 | 拒絶時のレスポンス |
|---|---|---|---|
| **Public (公開)** | `getMapsApiKey`, `verifyManagerPassword`, `getTier1` (および GET `registerOrValidateDevice`, `getDeviceStatus`) | なし (認証不要) | なし |
| **Dashboard Manager (管理者専用)** | `getDashboardSnapshot`, `getRoster`, `getTransferRequests`, `getSystemInfo`, `logoutManager` | 有効な `dashboardSessionToken` (6桁PIN認証済・地区バインド) | `UNAUTHORIZED` (未認証/期限切れ) / `DISTRICT_MISMATCH` |
| **Dual-Audience (業務データ読取)** | `getSystemSummary`, `getRanking`, `getFlyerStock`, `getLatestDistribution`, `getDeliveryStats`, `getAreaDetails`, `getBulletinPosts` | 有効な `dashboardSessionToken` または 有効な `liffToken` | `UNAUTHORIZED` (未認証アクセス) |
| **Unregistered Staff** | `getStaffIdentity`, `registerStaff` (名簿照合・初回登録) | 有効な `liffToken` (LINE検証成功) | `UNAUTHORIZED` (無効/期限切れトークン) |
| **Active Staff (配布員書き込み)** | `submitDistribution`, `updateRecordWithGPSPhoto`, `updateFlyerStock`, `requestFlyerTransfer`, `createBulletinPost`, `sendBulletinContact`, `resolveTransferRequest`, `setPinStatus` | 有効な `liffToken` ＋ 名簿登録済み (`found === true`) | `NOT_REGISTERED` (名簿未登録) / `UNAUTHORIZED` |

### 6.0.1 getMapsApiKey Contract (SEC-007 地区別 Maps API Key 解決契約)

* **認可区分**: `Public` (認証不要で呼び出し可能。Dashboard PIN入力前・H-App LINE認証前の非同期地図初期化を許容)
* **HTTP Method**: `POST` (推奨) / `GET` (後方互換)
* **入力パラメータ**:
  * `action` (string, 必須): `"getMapsApiKey"`
  * `districtId` (string, 推奨): 対象地区コード (例: `"KUWANA"`, `"KAMEYAMA"`)
  * `dashboardSessionToken` (string, 任意): 管理者セッション保持時は自動付与
* **正規化ルール (Normalization)**:
  * Backend側で必ず `cleanDistrictId = String(districtId || '').trim().toUpperCase()` を実施。大文字小文字の差異を吸収。
* **解決フロー (Resolution Chain)**:
  1. `Session Binding`: `dashboardSessionToken` が渡された場合、`verifyDashboardSession(token, cleanDistrictId)` を実行。セッション所属地区と要求地区が不一致の場合は `UNAUTHORIZED` を返却（他地区Key搾取防止）。
  2. `Integrity Guard`: `SpreadsheetResolver`（`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()`）照合時、当該スプレッドシート `SYSTEM_INFO` の `地区コード` と不一致時は `DISTRICT_MISMATCH` を返却。
  3. `Contract Gate`: 対象地区が契約終了状態 (`CONTRACT_EXPIRED`) の場合は即時遮断。
  4. 地区別Key探索: `GOOGLE_MAPS_API_KEY_<DISTRICT_ID>` が存在すれば該当Keyを返却 (`isFallback: false`)。
  5. Phase 1 Legacy Fallback: 地区別Keyが未設定かつ共通Key `GOOGLE_MAPS_API_KEY` が存在する場合のみ当該Keyを返却 (`isFallback: true`)。
  6. Key未設定: 地区別Keyも共通Keyも存在しない場合は `MAPS_KEY_NOT_CONFIGURED` を返却。
* **エラーコード一覧**:
  * `DISTRICT_MISMATCH`: 指定地区コードが当該スプレッドシート `SYSTEM_INFO` の地区コードと不一致
  * `UNAUTHORIZED`: Dashboard Session の所属地区と要求地区が不一致
  * `CONTRACT_EXPIRED`: 契約期間満了によるアクセス遮断
  * `MAPS_KEY_NOT_CONFIGURED`: 該当地区の Maps API Key が未設定
* **レスポンス仕様**:
  ```json
  // 正常 (地区別Key)
  { "success": true, "districtId": "KUWANA", "mapsApiKey": "AIzaSy...", "isFallback": false }
  // 正常 (Phase 1 共通Keyフォールバック)
  { "success": true, "districtId": "KUWANA", "mapsApiKey": "AIzaSy...", "isFallback": true }
  // エラー (地区コード不一致)
  { "success": false, "code": "DISTRICT_MISMATCH", "message": "CRITICAL: Integrity Violation..." }
  // エラー (セッション不一致)
  { "success": false, "code": "UNAUTHORIZED", "message": "Session district mismatch. Cross-district key access denied." }
  ```

---

## 6.1 District Integrity Verification & Authorization Boundary (地区整合性検証と認可境界)

`1地区 = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS` の独立運用において、**地区境界整合性検証（このDBが要求された地区のものか）と認証・認可（誰がアクセスしてよいか）を明確に分離**する。

```text
Request 受信
    ↓
districtId 取得 (地区整合性検証パラメータ)
    ↓
SpreadsheetResolver (TARGET_SPREADSHEET_ID → SPREADSHEET_ID → SpreadsheetApp.getActiveSpreadsheet()) による自地区DBの解決
＋ SYSTEM_INFO (地区コード) との整合性検証 (verifyIntegrityGuard: 不一致時は DISTRICT_MISMATCH 遮断)
    ↓
LINE Access Token 検証 ➔ 認証済み lineUserId 取得 (Identity Proof: 本人性証明)
    ↓
対象DB（名簿シート）との照合 ➔ 地区所属・利用資格確認 (Authorization: 認可判定)
    ↓
認可 PASS ➔ Spreadsheet 業務操作 / 認可 DENY ➔ 処理即時遮断
```

### (1) districtId は「地区境界整合性検証パラメータ」であり認証情報ではない
- クライアントが送信する `districtId`（例: `"KUWANA"`）は、当該スプレッドシートの `SYSTEM_INFO` に記録された地区コードと一致するかを検証するための識別子であり、認証・認可の根拠ではない。
- `districtId` を送信したこと自体を信頼して対象スプレッドシートへの書き込み・読み取り権限を与える構造は絶対に採用しない。

### (2) 認可境界の実装要件
- 認証済み `lineUserId` と対象地区DBの名簿照合を認可境界として実装し、未登録アクセスや地区越境アクセスを拒否する。
- 業務系アクション（配布登録、在庫更新、ランキング取得等）の実行時、対象スプレッドシートの名簿に認証済み `lineUserId` が存在しない場合は、直ちに処理を停止し拒絶レスポンスを返却する。

### (3) 認可検証マトリクス (テスト検証条件)
実機・単体テストにおいて、以下の5大条件をすべて満たすことを実証する。

| テストシナリオ | LINE Token | 本人所属地区 | 指定 districtId | 認可判定 | レスポンスコード | 期待挙動 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **正当アクセス** | 正常 (User A) | District A | District A | **PASS** | `200 OK` | 正常に業務処理を完了・永続化 |
| **他地区ユーザーアクセス** | 正常 (User B) | District B | District A | **DENY** | `NOT_REGISTERED` | 未登録者として拒絶し、DB書き込み遮断 |
| **名簿未登録ユーザー**| 正常 (Unknown) | なし | District A | **DENY** | `NOT_REGISTERED` | 初回登録画面へ誘導 |
| **不正/失効トークン** | 無効/失効 | - | District A | **DENY** | `UNAUTHORIZED` | 認証エラーとして即時拒絶 |
| **地区コード不整合** | 正常 (User A) | District A | Unknown-99 | **DENY** | `DISTRICT_MISMATCH` | `SYSTEM_INFO` 不一致として即時拒絶 |

### (4) 推奨リクエスト構造
```json
{
  "action": "submitDistribution",
  "districtId": "KUWANA",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "liffToken": "eyJhbGciOi...",
  "rowId": 142,
  "count": 120
}
```
※ `districtId` は地区整合性検証パラメータ、`liffToken` は Identity Credential として扱い、Backend 側で分離検証する。


---

## 7. Data Model (データモデル整合性)

Gate 2 (`DATA_DICTIONARY.md`, `DATA_LIFECYCLE.md`) で確定したデータモデル契約を 100% 遵守する。

```text
Person (党員個人)
   ├── 組織所属 ──► Branch (所属支部: 組織上の所属先)
   │
   │ 1. performs (完全に自由なポスティング活動: 活動場所制限・担当エリアなし)
   ▼
DistributionRecord (配布実績事実 — 実装モデルクラス: DistributionEvent [distribution_model.js])
   ├── rowId (町丁目行番号)
   ├── cityName / townName (どこで)
   ├── completedAt (いつ)
   ├── count (何枚)
   ├── staffId / staffName (誰が: Backend強制解決)
   ├── gps (latitude, longitude, accuracy: 空間証跡)
   └── photo (photoFileId, photoUrl: 物理証跡)
```

### 【絶対禁止事項のAPI契約上の担保】
- ❌ API リクエスト/レスポンスに `assignedAreaId`, `assignedStaffId`, `quota`, `targetCount` を含めてはならない。
- ❌ 「支部の活動対象地域」を党員個人の活動可能範囲としてフィルタリング・制限する API パラメータを設けてはならない。
- ❌ ランキング API に `rankingScore`, `motivationPoint`, `performanceGrade` 等の評価値を含めてはならない。

---

## 8. DistributionRecord API (配布実績登録契約)

配布実績の確定記録を行う中核 API（実装モデルクラス: `DistributionEvent` / `active/business/distribution/distribution_model.js`）。

### (1) エンドポイントアクション: `updateRecordWithGPSPhoto`
- **HTTP Method**: POST
- **認証**: 必須 (Active Staff)
- **排他制御**: `LockService.getScriptLock()` による 15秒悲観的ロック必須

#### リクエストボディ仕様 (JSON)
```json
{
  "action": "updateRecordWithGPSPhoto",
  "liffToken": "eyJhbGciOi...",
  "requestId": "req_550e8400-e29b-41d4-a716-446655440000",
  "rowId": 142,
  "count": 350,
  "isDone": true,
  "latitude": 35.0658,
  "longitude": 136.6834,
  "accuracy": 12.5,
  "photoData": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "areaName": "サンプル市中央町1丁目"
}
```

#### レスポンス仕様 (成功時: HTTP 200)
```json
{
  "success": true,
  "rowId": 142,
  "count": 350,
  "gpsStatus": "OK",
  "photoStatus": "OK",
  "photoUrl": "https://drive.google.com/file/d/1AbC.../view",
  "timestamp": "2026/09/22 18:30:00"
}
```

#### レスポンス仕様 (同一操作の重複再送時: Idempotent Hit)
```json
{
  "success": true,
  "rowId": 142,
  "count": 350,
  "gpsStatus": "OK",
  "photoStatus": "OK",
  "message": "already_completed",
  "timestamp": "2026/09/22 18:30:00"
}
```

---

## 9. Ranking API (個人ランキング契約)

配布員本人のモチベーション・活動意欲向上（メンタル面の動機付け）のための API。

### (1) エンドポイントアクション: `getRanking`
- **HTTP Method**: POST
- **認証**: 必須 (Active Staff)

#### リクエストボディ仕様 (JSON)
```json
{
  "action": "getRanking",
  "liffToken": "eyJhbGciOi..."
}
```

#### レスポンス仕様 (HTTP 200)
```json
{
  "success": true,
  "mySummary": {
    "rank": 3,
    "count": 1250
  },
  "ranking": [
    { "rank": 1, "staffId": "STF-00000-008", "name": "STF-00000-008", "count": 2100, "isMe": false },
    { "rank": 2, "staffId": "STF-00000-003", "name": "STF-00000-003", "count": 1800, "isMe": false },
    { "rank": 3, "staffId": "STF-00000-001", "name": "山田 太郎",       "count": 1250, "isMe": true }
  ]
}
```
※ 他人の行は `staffId` を表示名として匿名化し、本人の行のみ `isMe: true` かつ登録名を返却。

---

## 10. Dashboard Read API (全体観測契約)

管理者が全体の進捗・事実を把握・観測するための API。

| アクション名 | 目的・返却データ | 認証 | 備考 |
|---|---|---|---|
| `getSystemSummary` | 全体進捗率、完了町丁目数、総町丁目数、累計配布枚数 | Dual Auth (LIFF / Dashboard Session) | ダッシュボード上部サマリ表示用 |
| `getLatestDistribution` | 直近の配布実績リスト（最大件数指定、最新20件等） | Dual Auth (LIFF / Dashboard Session) | 時系列での活動事実観測、写真プレビュー |
| `getRoster` | 全配布員の名簿、当月累計配布枚数、チラシ在庫合計 | 管理者権限 | 人員・在庫の全体状況把握 |
| `getDashboardSnapshot` / `getAreaDetails` | 全体スナップショットおよびリアルタイム作業中・完了ピン状態（`pinStatus`） | 管理者権限 / Dual Auth | 重複作業の自然防止のための地図表示（※ピン状態更新は `setPinStatus`） |

### (1) Dashboard PIN サーバーサイドセッション契約 (ADR-023)
- **PIN検証 (`verifyManagerPassword`)**: 管理者が入力した6桁の管理者PINをサーバー側で検証。成功時に暗号学的に安全な `dashboardSessionToken`（UUID v4ベース）を発行。
- **セッション保管**: `CacheService.getScriptCache()` にキー `DASH_SESSION_` + SHA-256(`dashboardSessionToken`) として保存。平文トークンをキャッシュキーにしない。
- **TTL (有効期間)**: 21,600秒 (6時間)。業務セッションを維持しつつ、日次跨ぎでの不要なセッション残存を防止。
- **地区バインド (District Binding)**: セッション発行時に要求元 `districtId` と厳格に紐付け。他地区のデータ取得要求時は `DISTRICT_MISMATCH` または `UNAUTHORIZED` で遮断。
- **GET送信の絶対禁止 & 401遮断**:
  - `dashboardSessionToken` および `liffToken` を URL クエリパラメータ（GETリクエスト）に含めて送信することを厳格に禁止する（ブラウザ履歴、アクセスログ、リファラへの漏洩防止）。
  - 認証が必要な API アクションに対する GET リクエストは、サーバー側で直ちに `401 Unauthorized` を返却して遮断する。
- **localStorage 非正本性の原則**:
  - クライアント側（ブラウザ）の `localStorage` は、リロード時の利便性のためのトークン一時退避場所に過ぎず、認証の正本（SSOT）ではない。
  - セッションの有効性は、常にサーバー側 `CacheService` による検証のみをもって確定する。


---

## 11. Validation / Boundary Conditions (入力検証・境界条件)

「例示された一般論」と「Universal POSTING MAP で実際に採用する契約」を明確に分離して定義する。

### 採用する検証・境界条件契約マトリクス

| 項目 | 採用する許容範囲・仕様 | 境界値・異常値の扱い | エラーコード |
|---|---|---|---|
| `rowId` | 1以上の正の整数 (`Number.isInteger(n) && n >= 1`) | 0, 負数, 小数点, 文字列, null, 空文字は REJECT | `INVALID_ROW_ID` |
| `count` | 0以上の整数 (`Number.isInteger(n) && n >= 0 && n <= 10000`) | 負数, NaN, 10,000超過（1町丁目の物理上限）は REJECT | `INVALID_COUNT` |
| `isDone` | 真偽値 (`true` または `false`。文字列 `"true"` / `"false"` も許容) | null, 未定義は `false` と判定 | - |
| `latitude` | 日本国内測地系: `20.0 <= lat <= 46.0` | 範囲外, 0, null は座標なし（`gpsStatus: "NO"`）として受容 | - |
| `longitude`| 日本国内測地系: `122.0 <= lng <= 154.0` | 範囲外, 0, null は座標なし（`gpsStatus: "NO"`）として受容 | - |
| `accuracy` | 0 より大きい数値 (メートル) | 負数, 0 は無効。1,000m 超過時は精度不足フラグ | - |
| `photoData`| `data:image/` で始まる Base64 文字列 (デコード後 5MB 以下) | 形式不正は写真なし（`photoStatus: "NO"`）として受容。5MB超過は REJECT | `PAYLOAD_TOO_LARGE` |
| `requestId`| `req_` で始まる UUID v4 文字列 (36文字以上) | 欠落時はクライアントで生成必須。空文字は REJECT | `MISSING_REQUEST_ID` |
| JSON構文 | 有効な JSON 文字列 | パースエラー（構文異常）時は即座に REJECT | `MALFORMED_JSON` |

---

## 12. State Machine (状態遷移マシン)

Hアプリ端末内における配布実績送信のライフサイクルを有限オートマトン（State Machine）として定義する。

```text
 ┌─────────────┐
 │   UNSENT    │ (現場で入力完了)
 └──────┬──────┘
        │ enqueueSync()
        ▼
 ┌─────────────┐       (ネットワーク接続あり)
 │   QUEUED    ├────────────────────────────────┐
 └──────┬──────┘                                │
        │ (オフライン時: 保留)                  ▼
        │                              ┌─────────────────┐
        │                              │     SENDING     │
        │                              └────────┬────────┘
        │                                       │
        │                        ┌──────────────┴──────────────┐
        │                        │                             │
        │                  (通信成功: 200)             (一時エラー: 503/429/timeout)
        │                        │                             │
        │                        ▼                             ▼
        │               ┌─────────────────┐           ┌─────────────────┐
        │               │    PERSISTED    │           │   RETRY_WAIT    │
        │               │ (キューから削除)│           └────────┬────────┘
        │               └─────────────────┘                    │
        │                                                      │ (指数バックオフ待機)
        │                                                      ▼
        │                                               (再試行実行: オンライン)
        │                                                      │
        │                                                      ▼
        │                                              ┌─────────────────┐
        │                                              │     SENDING     │
        │                                              └─────────────────┘
        │                                                      │
        │                                        (リトライ上限 5回超過)
        │                                                      │
        │                                                      ▼
        │                                             ┌─────────────────┐
        │                                             │ FAILED_PERMANENT│
        │                                             │   (手動再送待機)│
        │                                             └─────────────────┘
        │ (恒久エラー: 400/401/403)                            ▲
        └──────────────────────────────────────────────────────┘
```

### (2) 現場ポスティングフロー 7段階ステートマシン (ADR-011)
現場配布員の端末操作とシステムライフサイクルの状態遷移契約：

```text
Step 1: ピン選択 (Pin Selection) ──► 地図上の町丁目ピンを選択
Step 2: 活動開始 (Pin Claim) ─────► claimPin により作業中宣言 (他者重複着手防止)
Step 3: 現地活動 & 証跡取得 ─────► カメラ撮影 (写真) & GPS位置情報測位
Step 4: ドラフト保存 (READY_TO_SUBMIT) ──► 端末内に未送信 (UNSENT) / キュー (QUEUED) 保持
                                    【絶対不変条件】写真撮影完了だけでCOMPLETEDに先行遷移しない
Step 5: 送信実行 (SENDING) ──────► 完了報告ボタン押下、updateRecordWithGPSPhoto リクエスト送信
Step 6: Backend 排他ロック・永続化 ─► 15秒排他ロック下で検証、Drive保存、実績追記、PinStatus解除
Step 7: 完了確定 (COMPLETED) ────► サーバー success: true かつ accepted !== false の受諾成功を確認して確定 (getRowStatus(rowId) === null によりQueue消滅を検知するが、accepted: false / REJECTED の場合は非COMPLETEDとして未完了へ復帰)
```

---

## 13. Idempotency / Concurrency (冪等性・並行性排他制御・月次進捗保護)

### (1) `rowId` と `requestId` の厳格な責務分離
システムの二重登録防止と正当な活動記録を両立させるため、以下の2つの識別子を厳格に区別する。

```text
┌──────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ 識別子                        │ 責務・定義                                                   │
├──────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **rowId (地域行識別子)**      │ 「どこで配るか」を表す地理的マスターの町丁目識別子。         │
│                              │ ※ 1か月・1 rowId = 1行 の月次進捗台帳の行キー。             │
├──────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ **requestId (冪等性キー)**   │ 「1回の配布完了操作」を一意に特定する暗号学的UUID v4キー。   │
│                              │ ※ 通信寸断や端末リトライによる同一操作の二重書込を防ぐ。    │
└──────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

- **月次進捗台帳における rowId と requestId の連携原則**:
  - `rowId` は町丁目の固定行を特定するインデックスキー。
  - `requestId` は端末の1回の送信操作を特定する冪等性照合キー。
  - 同一 `requestId` による再送のみを `duplicate` として扱い、同一内容を再書込しない（DB書込0、Drive追加0）。

### (2) 月次初回完了固定および既存実績保護モデル
- **原則**: **1か月・1 rowId = 1行。当月の初回完了のみを保存し、既存実績を保護する。**
  - **同一 requestId 再送**:
    * 通信リトライ等による同一操作の再送。
    * `duplicate: true`, `accepted: true`, DB書込0, Drive追加0 で既存完了結果を返却。
  - **別 requestId + 当月完了済み rowId**:
    * 当月既に D列 `completedAt` が記録されている町丁目に対する別の完了リクエスト。
    * `alreadyCompleted: true`, `accepted: true`, DB書込0, 新規追記0, 上書き0 で既存完了結果を返却（同月再配布なし）。
  - **翌月の扱い**:
    * 翌月は新しい月次シート（`配布実績YYYY-MM`）が作成され、全町丁目が「未配布」から新しく開始する。
  - **旧月 Queue の終端**:
    * 月跨ぎにより旧月の送信が遅れて届いた場合、サーバーは `success: true`, `accepted: false`, `code: "STALE_MONTH"` を返却。
    * 当月シートへの書込は0件とし、端末側は Queue からアイテムを削除（終端）するが、Hアプリ側では完了（COMPLETED）扱いにせず未完了状態を維持する。

### (3) 冪等性（Idempotency）照合アーキテクチャ (Q列照合)
- **対象**: 通信タイムアウト、回線切断、UI連打等によって、**「同一の `requestId`（または端末キュー内の同一未完了タスク）」が複数回送信された場合**のみ。
- **Q列・D列による照合手順**:
  1. **Step 1 (timestamp月判定)**: 有効な有限正数 timestamp に対し、当月と一致しない旧月リクエストは DB書込前に `accepted: false`, `code: "STALE_MONTH"` で即時終端（timestamp欠損・無効値はLegacy互換として月判定をスキップ）。
  2. **Step 2 (requestId duplicate判定)**: スプレッドシート `配布実績YYYY-MM` の Q列（`requestId`）を照合。一致すれば DB/Drive 書込0 で `duplicate: true`, `accepted: true` を返却。
  3. **Step 3 (completedAt alreadyCompleted判定)**: D列 `completedAt` が既に存在する場合、別 `requestId` であっても DB書込0 で `alreadyCompleted: true`, `accepted: true` を返却。
  4. **Step 4 (初回通常保存)**: 当月・未完了 rowId の初回操作のみ、D〜Q列の14列（Q列に `requestId`）を一括永続化。

### (4) 並行性排他制御 (GAS Pessimistic Script Lock)
- **排他制御方式**: Google Apps Script の `LockService.getScriptLock()` による悲観的スクリプト排他ロックを採用。
- **ロック獲得待ち時間**: 最大 15,000ms (15秒)。
- **完全解放保証**: `try { lock.waitLock(15000); ... } finally { lock.releaseLock(); }` により例外発生時も確実に解放。
- **競合時の挙動**: 15秒以内にロックを獲得できなかった場合、処理を中断して `LOCK_TIMEOUT` (503相当) を返却。クライアント側は指数バックオフで再送する。
- **1秒未満の短時間ロック却下理由 (REJECT - ADR-004)**:
  - スプレッドシートへの行追記および Google Drive への画像保存・セル書き込み処理には、通常 300ms〜800ms を要する。
  - 1秒未満（例: 500ms等）の極小ロック待機時間では、リクエスト集中時や GAS コールドスタート時にロック取得失敗が頻発し、正常な活動登録が誤って拒絶される。そのため 15秒の十分な待機時間を保証する。

### (5) 配布実績の月内1行固定および既存実績保護モデル
- **無秩序な上書き更新の却下**:
  - 電波寸断やオフライン蓄積が発生する現場環境において、後勝ちタイムスタンプ等によって既存レコードを無秩序に上書き更新するモデルは却下する。
- **配布実績 月内1行固定・既存実績保護原則**:
  - 配布実績シートは「1か月・1 rowId = 1行」として管理し、当月の初回完了のみを永続化する。当月完了済みの町丁目に対する別リクエストは上書きせず `alreadyCompleted: true` として返し、記録された活動事実を確実に保護する（同月再配布なし、翌月に新しい月次シートで未配布から新しく開始する）。

### (6) 外科的局所復旧原則 (Surgical Repair) とスプレッドシート全体ロールバックの禁止
- 誤操作やデータ不整合が発生した場合であっても、**スプレッドシート全体のバージョン復元（Version Rollback）を行ってはならない**。
- 全体ロールバックを実行すると、障害箇所以外の他配布員が記録した正常な配布実績が巻き戻され、不可逆的に消滅する。
- 復旧は必ず対象の不整合行のみを特定し、手動修正または論理削除する外科的・局所的復旧（Surgical Repair）に限定する。


---

## 14. Error Contract (エラー契約・障害分類)

### (1) 統一エラーレスポンスフォーマット
すべてのエラー応答は、以下の JSON スキーマに厳格に準拠する。

```json
{
  "success": false,
  "code": "ERROR_CODE",
  "message": "ユーザーに表示可能な説明文",
  "errorType": "TRANSIENT | PERMANENT",
  "retryable": true
}
```

### (3) 正常系ビジネスレスポンス契約と例外化抑止 (`success: true` 境界契約)
以下の API では、処理が失敗（Error）ではなく正当な業務判定結果として `success: true` と共に `code` を返却する。
クライアント（`active/h-app/modules/api.js`）は `targetResult.success === true` のレスポンスを例外化してはならず、正常な戻り値として呼出元へ返却しなければならない。

1. **`getStaffIdentity` (スタッフ未登録判定)**:
   - レスポンス例:
     ```json
     {
       "success": true,
       "code": "NOT_REGISTERED",
       "lineUserId": "U1234567890abcdef...",
       "message": "スタッフが名簿に登録されていません。"
     }
     ```
   - 責務: 初回ログイン者または未登録者の判定。Hアプリはこれを受領して自動スタッフ登録モーダルまたはフローを起動する。
2. **`submitDistribution` / `updateRecordWithGPSPhoto` (SUBSCRIPTION 旧月終端)**:
   - レスポンス例:
     ```json
     {
       "success": true,
       "accepted": false,
       "code": "STALE_MONTH",
       "message": "旧月の配布操作は当月シートに反映できません。"
     }
     ```
   - 責務: SUBSCRIPTION モードにおいて月跨ぎにより遅れて届いた旧月キューアイテムの安全な終端。
3. **ELECTION モードにおける GPS 送信 (ADR-024)**:
   - ELECTION モードでは月跨ぎ `STALE_MONTH` 判定はバイパスされ、同一 Dataset に対して配布実績が正常に記録される。
   - ただし、リクエストの timestamp が契約終了日を超過している場合は `{ success: false, code: "CONTRACT_EXPIRED" }` として恒久エラー遮断される。

---

## 15. Timeout / Retry (タイムアウト・リトライ契約 & 状態遷移マトリクス)

### (1) 採用するタイムアウト・リトライ確定値
現行実装の実測・制約から導出した確定値を規定する。

| レイヤー | 処理内容 | タイムアウト値 | リトライ上限 | バックオフ間隔・方式 | 根拠・技術的理由 |
|---|---|---|---|---|---|
| **Hアプリ API** | 通常の POST API 呼出 (`modules/api.js`) | **90,000ms (90秒)** | **3回** | **1s → 2s → 4s** (係数 2.0) | GAS のコールドスタート（数秒〜十数秒）および写真アップロード処理を吸収するため。 |
| **Hアプリ キュー** | オフライン同期キュー (`db.js`) | 各送信に準拠 | **5回** | **10s → 30s → 60s → 60s → 60s** | 現場の電波途切れ・トンネル通過からの緩やかな復帰に適合。 |
| **Manager API** | ダッシュボード集計取得 (`manager.js`) | **25,000ms (25秒)** | 0回 (単発) | なし (手動再読込) | 管理者が画面上で即時エラーを把握できるようにするため。 |
| **Manager 認証** | 管理者パスワード検証 | **45,000ms (45秒)** | 0回 (単発) | なし | Script Properties のハッシュ検証処理。 |
| **Backend ロック** | スクリプト悲観ロック (`GPSService.js`) | **15,000ms (15秒)** | - | 即時 503 返却 | GAS の実行時間制限（最大6分）を浪費させずクライアントへ速やかに再試行を促すため。 |

### (2) Error Code / HTTP Status → Retryable → State Transition 対応マトリクス

| エラーコード | HTTP相当 | エラー分類 | retryable | 発生要因・具体例 | 次の状態遷移 (Hアプリ) | クライアントのアクション |
|---|---|---|---|---|---|---|
| `LOCK_TIMEOUT` | 503 | TRANSIENT | **true** | 他端末リクエスト競合で15秒間ロック獲得失敗 | `SENDING` → `RETRY_WAIT` | 指数バックオフ待機後に自動再送（最大5回） |
| `RATE_LIMIT_EXCEEDED`| 429 | TRANSIENT | **true** | Google 基盤クォータ超過 (UrlFetch等) | `SENDING` → `RETRY_WAIT` | 長期バックオフ（60秒〜）後に自動再送 |
| `NETWORK_FAILURE` | 0 / timeout | TRANSIENT | **true** | 端末圏外、DNS失敗、AbortController(90秒)到達 | `SENDING` → `RETRY_WAIT` (オフライン時は `QUEUED`) | オンライン復帰イベント検知で自動再送 |
| `INTERNAL_ERROR` | 500 | TRANSIENT | **true** | GAS 実行時例外、一時的な Google Drive 障害 | `SENDING` → `RETRY_WAIT` | 指数バックオフ待機後に自動再送 |
| `INVALID_ARGUMENT` | 400 | PERMANENT | **false** | `rowId`, `count` 等の型・境界値違反 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。UI警告表示、入力値修正 |
| `MALFORMED_JSON` | 400 | PERMANENT | **false** | リクエストボディの JSON パース失敗 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。通信ペイロード構築不具合 |
| `UNAUTHORIZED` | 401 | PERMANENT | **false** | `liffToken` 欠落、署名不正、有効期限切れ | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。LIFF 再ログイン画面へ誘導 |
| `NOT_REGISTERED` | 403 | PERMANENT | **false** | LINE User ID が名簿の原本に未登録 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。初回名簿登録画面へ誘導 |
| `FORBIDDEN` | 403 | PERMANENT | **false** | 管理者パスワード不一致、禁止APIへの呼出 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。権限エラーモーダル表示 |
| `RESOURCE_NOT_FOUND` | 404 | PERMANENT | **false** | 指定スプレッドシートやフォルダが存在しない | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。システム設定・構成の確認 |
| `CONTRACT_EXPIRED` | 403 | PERMANENT | **false** | システム契約期間満了 | `SENDING` → `FAILED_PERMANENT` | **リトライ禁止**。利用終了画面表示 |

---

## 16. Offline / Synchronization (オフライン同期・永続化保証)

1. **ローカル永続化**:
   - ブラウザ標準の **IndexedDB (`PostingMapDB` / `syncQueue`)** を使用。
   - 電波圏外であっても、完了操作を行った瞬間にローカルキューへ即時永続化され、UI 上は「保存完了（送信待ち）」となる。
2. **写真データの退避**:
   - カメラ撮影した証跡写真（Base64）も `syncQueue` レコード内に直接保持する。
   - ブラウザのリロードや端末再起動が発生しても、未送信データは一切消失しない。
3. **自動同期エンジン**:
   - `window.addEventListener('online', processQueue)` により、ネットワーク復帰を検知してバックグラウンドで自動同期を開始する。

---

## 17. SSOT / Reconciliation (真実の情報源と不整合調停)

### (1) データ別 SSOT (真実の単一情報源) 台帳

| データ種別 | SSOT の所在 | キャッシュ / 一時情報の所在 | 採用ルール |
|---|---|---|---|
| **配布実績 (DistributionRecord / `DistributionEvent`)** | **Spreadsheet (`配布実績<Key>`)** | Hアプリ `in-memory state / IndexedDB` | **Database が絶対SSOT**。「LocalStorageにあるから正しい」という設計を完全排除。 |
| **配布員名簿 (StaffIdentity)** | **Spreadsheet (`名簿<Key>`)** | Hアプリ `localStorage.user_info` | **Database が絶対SSOT**。端末キャッシュは先行表示用の一時情報に過ぎない。 |
| **活動対象地域 (TargetRegion)** | **CSV (`data/address_master.csv`)** | Hアプリ `pinsCache` | **リポジトリ内マスターデータが絶対SSOT**。 |
| **個人ランキング (RankingSummary)**| **Backend 動的集計エンジン** | Hアプリ `RankingModule` | **Backend が絶対SSOT**。配布実績の最新合計から随時計算。 |

### (2) 不整合調停 (Reconciliation) ポリシー
- **クライアント vs サーバーの競合**: 常に **サーバー（Spreadsheet）の確定値を優先（Server Wins）** する。
- **キュー滞留データとサーバーデータの重複**:
  - 同一 `requestId` を持つタスクがサーバー側ですでに保存完了となっている場合、ローカルキューを正常完了として破棄する。

---

## 18. Security (セキュリティ契約)

1. **通信経路保護**:
   - すべての通信を TLS 1.2 以上で暗号化。HTTP 通信は Google Apps Script 基盤により自動遮断される。
2. **トークン露出の完全防止**:
   - `liffToken` を GET クエリ文字列として送信することはアーキテクチャ上禁止。検知した場合は `v2_api.js` により即座にエラー返却。
3. **機密情報の秘匿**:
   - `lineUserId` は API レスポンス（Hアプリ、Dashboard）に一切露出させない。
4. **インジェクション対策**:
   - スプレッドシート追記時、先頭文字が `=`, `+`, `-`, `@` で始まる入力値はエスケープし、数式インジェクション（CSV Formula Injection）を防止。
   - 写真ファイル名および表示名に含まれるファイルシステム不正文字（`\ / : * ? " < > |` および空白）をアンダースコア `_` にサニタイズ。

---

## 19. Structured Logging / Traceability (構造化ログ・追跡性)

すべての API リクエストおよびトランザクション処理は、以下の構造化 JSON 形式でログを出力する。

### (1) ログ出力フォーマット
```json
{
  "timestamp": "2026-09-22T18:30:00.123Z",
  "traceId": "req_550e8400-e29b-41d4-a716-446655440000",
  "action": "updateRecordWithGPSPhoto",
  "authenticatedStaffId": "STF-00000-001",
  "subjectHash": "sha256_7a8b9c...",
  "rowId": 142,
  "count": 350,
  "latencyMs": 1250,
  "result": "SUCCESS",
  "errorCode": null
}
```

### (2) 機密情報マスキング契約
- ❌ `lineUserId`, `liffToken`, 電話番号, パスワード等の個人機密情報は**ログへの平文出力を絶対禁止**。
- 監査追跡が必要な場合は、SHA-256 でハッシュ化した `subjectHash` または解決済み `staffId` を使用する。

---

## 20. Monitoring / Audit (監視・監査運用設計)

### (1) 監視項目および閾値

| 監視対象 | 監視指標 | 警戒閾値 | 確認手段 |
|---|---|---|---|
| **可用性 (Availability)** | API 成功率 (`success: true` の割合) | < 99.0% | Google Cloud Logging |
| **排他混雑** | `LOCK_TIMEOUT` 発生頻度 | > 5回 / 10分 | GAS 実行ログ |
| **遅延 (Latency)** | API 応答時間 (P95) | > 10,000ms | Cloud Monitoring / デバッグログ |
| **端末同期待ち** | `syncQueue` 滞留件数 (端末側) | > 10件 | Hアプリ デバッグパネル |
| **クォータ消費** | `UrlFetchApp` 呼出回数 | > 15,000回 / 日 | Google Workspace 管理コンソール |

### (2) 障害検知・確認体制
- **一次検知**: Hアプリ利用者の画面アラート、およびデバッグパネルの同期待ち警告。
- **ログ確認先**: Google Apps Script ダッシュボードの「実行ログ」および Google Cloud Logging。
- **確認担当**: 支部システム管理者。

---

## 21. Versioning / Backward Compatibility (バージョニング・後方互換性)

1. **URL 不変原則**:
   - Universal POSTING MAP では、エンドポイント URL を頻繁に変更せず、単一の Web App URL を継続利用する。
2. **後方互換性契約**:
   - 新規フィールドの追加時は、必ずデフォルト値を設定し、旧バージョンの Hアプリからの送信（フィールド欠落）でもエラーとしない。
   - レガシーな列構成のスプレッドシート（P列が存在しない等）を受信した場合でも、フォールバック処理により安全に動作を継続する。

---

## 22. Rollback / Recovery (ロールバック・障害復旧手順)

### (1) API / GAS デプロイ障害時のロールバック
1. Google Apps Script エディタの「デプロイ」→「デプロイを管理」を開く。
2. 障害の発生したアクティブデプロイの編集を選択。
3. バージョン選択ドロップダウンにて「正常稼働していた直前のバージョン番号」を選択して保存。
4. これにより、**コード変更なしに数分以内で直前安定版へロールバック**が完了する。

### (2) スプレッドシート データ破損時のリカバリ
1. Google Spreadsheet の「ファイル」→「変更履歴」→「版の履歴を表示」を開く。
2. 誤操作またはデータ破損が発生する直前の版を選択し、「この版を復元」を実行。
3. 必要に応じて、前月データまたは Google Drive バックアップからアクティブデータセット（`名簿<Key>`, `保有チラシ枚数<Key>` 等）を復元する。

---

## 23. RPO / RTO (目標復旧地点・目標復旧時間)

根拠のない数値を独断で設定することを禁止し、現行の Google Cloud / Google Workspace インフラ構成に基づく客観的評価として規定する。

| 指標 | 判定・目標値 | 根拠・制約事項 |
|---|---|---|
| **RPO (Recovery Point Objective)** | **【未決定 (要運用合意)】**<br>※基盤実力値: 直前数分以内 | Google Spreadsheet の自動版履歴機能により通常は直前の変更まで保持される。ただし、広域障害時の復元保証は Google Workspace SLA (99.9%) に準拠。 |
| **RTO (Recovery Time Objective)** | **【未決定 (要運用合意)】**<br>※基盤実力値: 15分〜2時間 | GAS バージョンロールバックは 5分以内で可能。スプレッドシートの手動過去版復元および整合性チェックは 1〜2時間程度を想定。 |

---

## 24. AI Agent & MCP Governance (AIエージェント・MCP実行ガバナンス契約)

Universal POSTING MAP の開発・保守・監査・運用において稼働する AI Agent および Model Context Protocol (MCP) ツールの実行統制モデルを規定する。

> **注記**: 本章はガバナンス設計契約を規定するものであり、現行の 5役職 AI Employee OS の正本仕様は `docs/ai-foundation.md` に統合されている。

### (1) MCP Architecture & System Topology
- **クライアント**: Antigravity IDE / CLI / Subagent Engine
- **プロトコル**: Model Context Protocol (MCP) JSON-RPC 2.0
- **アーキテクチャ分離**: Tool Client ↔ MCP Gateway / Proxy ↔ Workspace Tools / External API

### (2) Agent Roles & 役割分離 (Role Separation — 正本: `docs/ai-foundation.md`)
AI エージェントは単一の全能権限を持たず、責務に応じた以下の厳格な5役職ロールに分離される。

| エージェントロール | 主な責務 | 許可ツール権限 | 禁止操作 |
|---|---|---|---|
| **`architect`** | Stage 0 Entrance Gatekeeper（`[GATEKEEPER VERDICT]`）、全体構造設計、アーキテクチャレビュー | **常時 READ ONLY** (`view_file`, `grep_search`) | すべてのファイル編集・コマンド実行・Git操作・再委任 |
| **`execution`** | Chief Orchestrator。調査、計画、Scope Lock、内部ディスパッチ、自己検証、Mechanical Gates、Commit/Push執行 | **Workspace WRITE & Orchestration** (`invoke_subagent`, `run_command`) | Stage 0 未通過着手、承認Scope外変更、自己検品、他地区探索 |
| **`worker`** | 排他単一ファイル実装（Implementation Profile）または Stage 9 確定差分・規程残滓監査（Cleanup Profile） | **Assigned File WRITE / Cleanup READ ONLY** | 割当外編集、Git操作、再委任（Strict Depth = 1） |
| **`auditor`** | Fresh isolated child context による独立再検証、全文査読・反証分析、`[AUDITOR VERDICT]` 返却 | **Policy-Level ZERO WRITE** (READ ONLY allowlist) | すべてのファイル編集・生成・Git操作・再委任 |
| **`deployer`** | 新地区プロビジョニング、マスターデータ生成、地区DB/GAS設定バインド、`[DEPLOYER REPORT]` 返却 | **Data & Config WRITE** (`data/**` 等) | `active/**` / `tests/**` 改変、Code Deploy、Git操作、再委任 |

### (3) Tool Registry & Versioning
- 全 MCP ツールは一元的な Tool Registry に登録され、ツール名、引数スキーマ、権限レベル、セマンティックバージョンが固定される。
- 未登録ツールの動的呼出は禁止。

### (4) Least Privilege & READ / WRITE Separation
- **最小権限の原則 (Least Privilege)**: タスクの目的に必要な最小限のツールのみをエージェントに公開する。
- **読み書きのフェーズ分離**: 探索・調査・監査フェーズでは WRITE ツールを一切提供せず、READ ツールのみで実行する。

### (5) Workspace Boundary (リポジトリ境界・他地区参照禁止【永久原則】)
- リポジトリの Git root を操作・探索の絶対境界とする。
- SSD 上に存在する他地区（OKAYAMA-02, KUWANA 等）のリポジトリやフォルダーへの参照・探索・実行は、MCP レベルで強制遮断される。

### (6) Secret Isolation & Masking
- `lineUserId`, `liffId`, `gasWebAppUrl`, デプロイトークン等の秘密情報は、MCP ツールの入出力および実行ログから自動的にマスキングされる。

### (7) PreToolUse Hard Block & Destructive Operation Protection
- MCP ツール実行直前のフックにおいて、以下の危険操作を検知した場合は即時 **HARD BLOCK (実行停止)** とする：
  1. `rm -rf`, `git reset --hard`, `git clean -fd` などの破壊的コマンド。
  2. `git push --force` などの履歴破壊コマンド。
  3. リポジトリ境界外（`../` 等）を対象とするファイル読み書き。
  4. 計画未承認状態での `active/` や `data/` 配下のファイル編集。

### (8) Human-in-the-Loop & Auto Approval Policy
- **自動承認 (Auto Approval)**: 読み取り系ツール（ファイル閲覧、検索、ディレクトリ一覧）および安全なサンドボックス内テストコマンドのみに限定。
- **人間による承認必須 (Human-in-the-Loop)**:
  - ファイル変更（コード編集）
  - Git Commit / Push
  - 本番リソースアクセス / デプロイ
  これらは必ず MASTER（人間）の明示的承認をブロックモーダルで要求する。

### (9) Production Access Control
- 本番 Google Apps Script、本番 Google Spreadsheet、LINE Official Account 本番設定に対する AI エージェントの直接的な書き込み・変更権限は原則付与しない。

### (10) Tool Timeout & Concurrency Limit
- **ツールタイムアウト**: MCP ツール呼び出しごとに最大タイムアウトを設定（コマンド実行: 30秒、ファイル操作: 10秒）。応答なき場合は強制切断。
- **並行度制限 (Concurrency Limit)**: 同一ワークスペースに対する並行編集ツール呼び出しを 1 に制限し、レースコンディションを排除。

### (11) MCP Failure & Fail-safe Policy
- MCP 接続切断、プロキシタイムアウト、またはツール実行失敗が発生した場合、AI エージェントは「推測による作業続行」を禁止し、**即座に作業を中断して MASTER へ報告（Fail-safe STOP）** する。

### (12) Structured Audit Log & Traceability
- すべての MCP ツール呼び出しは、`timestamp`, `agentRole`, `toolName`, `sanitizedArgs`, `durationMs`, `result` を含めて JSON 形式で監査ログに記録され、完全な追跡可能性を担保する。

### (13) Agent Session Isolation
- エージェントのセッション状態はメモリ上に隔離され、別セッションや過去タスクの不要な状態（ゾンビ変数）を引き継がない。

### (14) Commit / Push / Deploy Governance (9-Stage Protocol 連動)
- Commit, Push, Deploy は必ず「9-Stage Protocol（Stage 0 入口検問 → 計画 → `gate:entrance` & Scope Lock → 実装 → 自己検証 → 実装コミット & Independent Auditor & `gate:auditor` → Push → Deploy/実機確認 → Stage 9 Cleanup Gate）」に従い、MASTER の Proceed（Authorization Envelope）を得た場合のみ実行を許可する。

---

## 25. 未確定事項 (Unconfirmed Items)

以下の項目は、運用方針、通信費用、またはプライバシー保護方針が現在確定していないため、勝手に仕様化・実装せず「未確定事項」として明記する。

1. **他党員の個別配布実績のHアプリ一般公開**:
   - プライバシー保護および自律的活動の観点から、Gate 3 時点では「非公開」を維持。
2. **掲示板（Bulletin）の自動削除期間（TTL）の運用値**:
   - 30日または90日等の具体的アーカイブ期間は未決定。
3. **チラシ受渡要請における LINE Push 通知のクォータ上限運用**:
   - Messaging API の月間無償送信枠（200通/月）と有償枠の運用合意は未決定。
4. **GeoJSON 境界データのモバイル向け Simplify 許容誤差**:
   - 回線細い現場での描画速度向上に向けた具体的頂点間引き率は未決定。

---

## 26. 現行実装との対比・GAP分析 (EXISTING / REQUIRED / GAP)

Gate 3 で策定した設計契約と、現行コードベース（`active/`）の実装状況を厳密に対比し、差異（GAP）を分類する。**なお、Gate 3 では実装を行わない（READ / AUDIT / DESIGN / DOC ONLY）。**

| 分類 | 項目名 | 現行コードベース (`active/`) の実態 | Gate 3 設計契約の要求 | GAP 分析と今後の対応 |
|---|---|---|---|---|
| **EXISTING** | GAS 排他ロック制御 | `GPSService.js` にて `LockService.getScriptLock().waitLock(15000)` 実装済。 | 15秒悲観ロックの維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | LINE Token 認証 | `auth.js` にて LINE Profile API 照合および 30分キャッシュ実装済。 | トークン検証とキャッシュの維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | オフライン同期キュー | `db.js` にて IndexedDB (`PostingMapDB`) と指数バックオフ (10s〜60s) 実装済。 | 端末内ローカル退避と自動同期の維持。 | **完全整合 (GAPなし)** |
| **EXISTING** | ADR-024 Dual Lifecycle シート運用 | `MonthlySheetResolver` により `配布実績<Key>`（ELECTION固定 / SUBSCRIPTION月次）を動的解決して更新。 | アクティブデータセット分割の継承。 | **完全整合 (GAPなし)** |
| **EXISTING** | 操作単位の `requestId` 冪等性保証 | `gps_service.js` および `gps_repository.js` にて Q列 `requestId` 重複排除と当月 `completedAt` 照合 (`alreadyCompleted`) 実装済。 | `requestId` による同一操作の重複排除と当月進捗保護。 | **完全整合 (GAPなし・Phase ②-B 実装済)** |
| **REQUIRED** | 構造化ログ出力 | 現在は `console.log` によるテキストログ出力が中心。 | JSON 形式による構造化ログ（`traceId`, `latencyMs` 等）。 | **【GAPあり】**: 将来のロギング強化フェーズにて JSON 出力ラッパーの導入が必要。 |
| **REQUIRED** | 厳格な境界値チェック | 現在は `rowIdNum < 1` 判定のみ。極端な枚数（> 10,000）のバリデーションは未実装。 | `INVALID_COUNT` 等の厳格な業務バリデーション。 | **【GAPあり】**: 将来のバリデーション層強化フェーズにて実装を検討。 |
| **REQUIRED** | AI Agent / MCP ガバナンス | 現時点ではリポジトリ共通ルール（`AGENTS.md`）のみ存在。 | MCP レベルでの最小権限・READ/WRITE分離・PreToolUse遮断の設計契約。 | **【GAPあり】**: 将来の MCP エージェント基盤導入フェーズにおいて、本契約に沿ったサーバー・プロキシ構成を適用。 |

---

## 27. Production Smoke Test & Migration API Contracts (本番スモークテストおよびマイグレーションAPI契約)

### 27.1 本番スモークテスト対象 API 契約 (Production Smoke Test Endpoints Contract)

本番デプロイ直後および切替（Cutover）直後において、システムの健全性・疎通性を機械検証するための必須エンドポイント群を規定する：

1. **公開 API (Public Gateway & Device Validation)**:
   - `GET /exec?action=registerOrValidateDevice`
     - 応答: HTTP 200 `{ success: true, authorized: true }` または `{ success: true, authorized: false }`
   - `GET /exec?action=getDeviceStatus`
     - 応答: HTTP 200 `{ success: true, exists: false, rows: [] }`
2. **業務閲覧 API (Reading APIs)**:
   - `POST /exec { "action": "getDashboardSnapshot" }`
     - 応答: HTTP 200 正常ダッシュボードスナップショット返却
   - `POST /exec { "action": "getRanking" }`
     - 応答: HTTP 200 正常個人ランキング返却
   - `POST /exec { "action": "getFlyerStock" }`
     - 応答: HTTP 200 正常チラシ在庫サマリー返却
3. **セキュリティ & 整合性ガード (Integrity & Safety Guard)**:
   - **整合性ガード・地区コード不一致 (`SYSTEM_INFO district-code mismatch`)**:
     - 条件: リクエストの `districtId` が当該スプレッドシート `SYSTEM_INFO` の `地区コード` と不一致、またはセッション所属地区と不一致
     - リクエスト例: `POST /exec { "action": "getDashboardSnapshot", "districtId": "UNKNOWN" }`
     - 応答: HTTP 200 `{ success: false, code: "DISTRICT_MISMATCH", message: "..." }`
   - **契約満了地区 (`expired district`)**:
     - 条件: 対象地区の契約期間終了 (`contract.isExpired`)
     - 応答: HTTP 200 `{ success: false, code: "CONTRACT_EXPIRED", message: "契約期間が終了しているため利用できません。" }` による安全側遮断 (Fail-Closed)
   - **契約情報検証失敗 (`SYSTEM_INFO / contract verification failure`)**:
     - 条件: `SYSTEM_INFO` 読み込み例外等による検証失敗
     - 応答: HTTP 200 `{ success: false, code: "CONTRACT_CHECK_FAILED", message: "契約情報の検証に失敗したため安全のためアクセスを遮断しました。" }`

### 27.2 マイグレーション API 契約 (Migration Execution API Contract)
- **エンドポイント**: `POST /exec`
- **アクション**: `action: "runIdentityMigration"`
- **認可**: `verifyProvisioningToken` によるトークン認証必須
- **リクエストパラメータ**:
  ```json
  {
    "action": "runIdentityMigration",
    "provisioningToken": "<SECRET_TOKEN>",
    "isDryRun": true
  }
  ```
- **安全制約**:
  - **Dry-Run 必須化**: `isDryRun` はデフォルト `true` とし、事前検証レポート（追加ヘッダー、更新予定行、スキップ行）の確認なしに実マイグレーションを実行してはならない。
  - **Additive Schema Evolution（非破壊的列追加）**: 既存列を変更せず、末尾に P列（`lineUserId`）、Q列（`requestId`）、G列（在庫 `lineUserId`）、M-N列（受渡 `lineUserIds`）を追加。
  - **名簿完全一致と矛盾行保全**: `staffId` および氏名の双方が名簿と完全一致する場合のみ解決し、`ST001` 等の矛盾行は空欄のまま保全する。
- **レスポンス形式**:
  ```json
  {
    "success": true,
    "isDryRun": true,
    "summary": {
      "updatedRows": 0,
      "skippedRows": 0,
      "headersAdded": 0
    },
    "report": []
  }
  ```
- **関連規程・相互参照 (Canonical References)**:
  - アーキテクチャ受入基準・不変条件: [01_DESIGN_CONTRACT.md](../architecture/01_DESIGN_CONTRACT.md) §19
  - 本番切替・ロールバック運用SOP: [BACKUP_RESTORE_RUNBOOK.md](../operations/BACKUP_RESTORE_RUNBOOK.md) §5.2

### 27.3 新地区データベース生成管理 API 契約 (createDistrictDatabase)
- **エンドポイント**: `POST /exec` (GET は `METHOD_NOT_ALLOWED` で即時遮断)
- **アクション**: `action: "createDistrictDatabase"`
- **認可**: `verifyProvisioningToken` によるトークン認証必須（欠損・不正時は `UNAUTHORIZED` で遮断、mutation 0）
- **目的**: 新規地区のデータベース生成において、Google Drive 上の物理資産を正規階層へ自動配置する安全管理Action。呼び出し元（Caller）による配置先やファイル名の任意指定権限を剥奪し、サーバー側決定論的導出を一元執行する。
- **物理配置契約 (Canonical Drive Physical Layout Contract)**:
  ```text
  FIELD_OPERATIONS_PLATFORM/
  └── 03_BRANCH/
      └── {districtId}/
          ├── {districtId}
          ├── {districtId} 支部_STORAGE/
          └── SOURCE_ARCHIVE/
  ```
  - **Human Navigation Contract**: 人間管理者は `03_BRANCH -> {districtId}` だけを辿れば、当該地区の全運用資産（DB、写真ストレージ、原本アーカイブ）を迷うことなく発見できる物理構造を永久保証する。
- **Server-side 決定論的導出チェーン**:
  ```text
  districtId
     ↓
  BRANCH_ROOT_FOLDER_ID (Script Properties)
     ↓
  districtFolderId (03_BRANCH/{districtId}/)
     ↓
  storageFolderId ({districtId} 支部_STORAGE/)
     ↓
  sourceArchiveFolderId (SOURCE_ARCHIVE/)
     ↓
  canonicalDbName ({districtId})
     ↓
  canonicalSpreadsheetId
  ```
- **入力契約 (Request Payload)**:
  - `createDistrictDatabase`:
    ```json
    {
      "action": "createDistrictDatabase",
      "provisioningToken": "<SECRET_TOKEN>",
      "districtId": "NEW_DISTRICT",
      "templateSpreadsheetId": "1_TEMPLATE_EMPTY_DB_ID"
    }
    ```
    ※後方互換用オプショナル引数: `targetFolderId`, `targetDistrictName`
- **安全制約 & 絶対遵守事項 (Safety Constraints & Prohibitions)**:
  1. **Caller Authority の剥奪**: Caller が配置先フォルダ ID や任意の DB 名を決定することは永久に禁止される。DB 名は `{cleanDistrictId}` に強制固定される。
  2. **Legacy 引数の Assertion-Only 運用**: 旧引数（`targetFolderId`, `targetDistrictName`）が渡された場合、それらは配置・指定の Authority としては使用されず、サーバー側導出値との一致検証専用（Assertion Only）として扱われる。不一致時は直ちに Fail-Closed 遮断（`FOLDER_MISMATCH`, `INVALID_DISTRICT_NAME`）。
  3. **ドライブショートカットの厳格拒絶**: ドライブショートカット（MIMEタイプ `application/vnd.google-apps.shortcut`）は実体 DB として認可せず、検知時は直ちに `SHORTCUT_REJECTED` で遮断（mutation 0）。
  4. **自動破壊（Auto-Trash）の完全禁止**: 既存同名 DB が既に存在する場合、過去の自動ゴミ箱送り（`setTrashed(true)`）は永久に禁止される。1件存在時は `DISTRICT_DB_ALREADY_EXISTS`、2件以上存在時は `AMBIGUOUS_DISTRICT_DB` で直ちに Fail-Closed 停止する。
  5. **Environment Authority の分離**: `BRANCH_ROOT_FOLDER_ID` は Script Properties を SSOT とし、ソースコード（`active/**`）への物理 Drive ID ハードコードを永久に禁止する。未設定時は `DRIVE_RESOLUTION_FAILED` で Fail-Closed。
- **管理エラーコード一覧 (Failure Codes)**:
  - `UNAUTHORIZED`: プロビジョニングトークン欠損・不正
  - `INVALID_ARGUMENT`: 必須パラメータ（`districtId` 等）の欠損
  - `DRIVE_RESOLUTION_FAILED`: `BRANCH_ROOT_FOLDER_ID` 未設定または DriveApp 解決失敗
  - `RESOURCE_NOT_FOUND`: 指定フォルダ・スプレッドシートが存在しない・アクセス不可
  - `AMBIGUOUS_DISTRICT_FOLDER`: `03_BRANCH` 配下に同名地区フォルダが重複存在
  - `AMBIGUOUS_STORAGE_FOLDER`: 地区フォルダ配下に同名ストレージフォルダが重複存在
  - `AMBIGUOUS_SOURCE_ARCHIVE`: 地区フォルダ配下に同名アーカイブフォルダが重複存在
  - `AMBIGUOUS_DISTRICT_DB`: 地区フォルダ配下に同名 DB が重複存在
  - `DISTRICT_DB_ALREADY_EXISTS`: 地区フォルダ配下に既に DB が存在（自動上書き禁止）
  - `SHORTCUT_REJECTED`: スプレッドシートがショートカットである
  - `FOLDER_MISMATCH`: Caller 指定 `targetFolderId` がサーバー導出フォルダと不一致
  - `INVALID_DISTRICT_NAME`: Caller 指定 `targetDistrictName` が正式 DB 名と不一致
  - `DISTRICT_MISMATCH`: スプレッドシート名が正式 DB 名または地区コードと不一致
- **レスポンス形式 (Response)**:
  ```json
  {
    "success": true,
    "districtId": "NEW_DISTRICT",
    "spreadsheetId": "1_CANONICAL_SPREADSHEET_ID",
    "storageFolderId": "1_CANONICAL_STORAGE_FOLDER_ID",
    "message": "District database created successfully for \"NEW_DISTRICT\"."
  }
  ```

---
**Gate 3 API設計書 策定完了**
