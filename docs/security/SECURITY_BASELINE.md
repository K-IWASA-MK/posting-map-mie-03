# Universal Security Baseline Specification

- **Version**: 1.0.0
- **Status**: OFFICIAL SECURITY STANDARD (SSOT)
- **Target**: Universal POSTING MAP Engine v1.0
- **Supreme Authority**: [AGENTS.md](../../AGENTS.md) §8
- **Release Baseline**: [UNIVERSAL_RELEASE_BASELINE.md](../architecture/UNIVERSAL_RELEASE_BASELINE.md)
- **Related ADRs**:
  - [ADR-016: Security Architecture](../architecture/decisions/ADR-016_SECURITY_ARCHITECTURE.md)
  - [ADR-023: Dashboard Shared PIN Session Specification](../architecture/decisions/ADR-023_DASHBOARD_SHARED_PIN_SESSION_SPECIFICATION.md)
  - [ADR-022: Multi-Region Architecture Specification](../architecture/decisions/ADR-022_MULTI_REGION_ARCHITECTURE_SPECIFICATION.md)

---

## 1. 目的と位置づけ

本書は、SEC-001〜SEC-007 の個別監査および実装を経て確立された Universal POSTING MAP のセキュリティ設計・境界（Security Boundary）を集約し、製品ライフサイクル全般（開発・プロビジョニング・運用・保守・破棄）において遵守すべき **恒久的なセキュリティ基準（SSOT）** を定義する。

---

## 2. セキュリティ境界要件 (SEC-001 〜 SEC-007 統合体系)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        外部境界 (External Perimeter)                   │
│                                                                        │
│   [H App (LINE / LIFF)]                  [Dashboard (Browser)]         │
│         │                                        │                     │
│         │ (LINE Access Token)                    │ (Shared PIN / Auth) │
│         ▼                                        ▼                     │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │       Universal 1-District GAS Gateway (`v2_api.js`)           │   │
│   │                                                                │   │
│   │  [SEC-006: Method Boundary]  doGet / doPost 厳格分離           │   │
│   │  [SEC-003: Identity 導出]    LINE User ID → Staff 解決         │   │
│   │  [SEC-001: Session Guard]    District-Bound Session 検証       │   │
│   │  [SEC-005: Info Disclosure]  Manager PIN / 機密マスク          │   │
│   │  [SEC-007: Maps Key Guard]   地区別 API Key 解決               │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                │                                       │
│                                ▼                                       │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Tenant Isolation & Data Layer                  │   │
│   │                                                                │   │
│   │  [SEC-003: DB Resolution]    TARGET_SS / getActiveSpreadsheet  │   │
│   │  [SEC-003: Integrity Guard]  SYSTEM_INFO districtId 照合       │   │
│   │  [SEC-002: Injection Guard]  Formula / CSV Injection 無害化   │   │
│   │  [SEC-004: XSS Guard]        escapeHtml サニタイズ             │   │
│   └────────────────────────────────────────────────────────────────┘   │
│                                │                                       │
│                                ▼                                       │
│             [1-District Dedicated DB (Spreadsheet per District)]       │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 2.1 SEC-001: Dashboard Session & Shared PIN 認証基盤

1. **サーバーサイドセッション管理**:
   - Dashboard の管理者認証は、クライアントに PIN を保持させず、サーバー側（GAS CacheService）で発行・検証されるセッショントークンによって管理する。
   - トークン仕様:
     - プレフィックス: `pms_dash_`
     - エントロピー: `Utilities.getUuid()` + タイムスタンプ + 乱数 + 地区IDの SHA-256 ハッシュ値。
     - キャッシュキー: `DASH_SESSION_` + SHA-256(トークン)。トークン平文はキーとして保存しない。
2. **Session District Binding (地区バインド)**:
   - セッションは必ず特定の `districtId` に厳格に紐付け（Bind）される。
   - トークン検証時、リクエストの `districtId` とトークンにバインドされた `districtId` が一致しない場合は即座に遮断（`HTTP 403 / DISTRICT_MISMATCH`）する。
3. **有効期限と無効化**:
   - セッションの有効期限は最大 **6 時間（21,600秒）** とし（GAS CacheService 最大保持期間仕様に準拠）、明示的ログアウト（`logoutManager`）または有効期限到達で即時破棄する。
4. **localStorage 改ざん耐性と UI 復帰**:
   - `localStorage` の値（例: `pm_auth_xxx=true`）は単なる表示補助に過ぎず、認証の正本（SSOT）としては一切信用しない。
   - セッショントークンが存在しない場合、あるいはサーバーから `401 UNAUTHORIZED` / `DISTRICT_MISMATCH` が返却された場合は、直ちにローカル情報をクリアし、画面にPIN入力モーダル（`#manager-pin-gate`）を強制表示する。
5. **BOLA / IDOR 防御**:
   - 一度認証されたセッションであっても、セッション発行対象外の地区リソース（他地区のスプレッドシート・設定）へのアクセスは完全遮断する。

---

### 2.2 SEC-002: Formula / CSV Injection 防御

スプレッドシートをデータベースとして利用するため、ユーザー入力値が数式として解釈・実行される攻撃（Formula Injection / CSV Injection）を完全に防護する。

1. **危険先頭文字のエスケープ**:
   - 文字列データの先頭が以下のいずれかである場合、先頭にシングルクォート（`'`）を強制付与して格納する：
     - `=`（数式開始）
     - `+`（正数 / 数式評価）
     - `-`（負数 / 数式評価）
     - `@`（暗黙的共通集合 / 関数呼び出し）
     - `\t`（水平タブ）
     - `\r`（キャリッジリターン）
2. **対象項目**:
   - 配布員氏名、メッセージ本文、連絡先（電話番号/メール）、資材保管場所名、メモ等、すべてのフリーテキスト入力。
3. **数値型の保護**:
   - GPS座標（緯度・経度）などの負数を含む数値データは、型チェック（`typeof === 'number'`）を行い、純粋な数値型として扱う（文字列エスケープによる値破損を防止）。

---

### 2.3 SEC-003: Identity 導出 & Tenant Isolation

1. **Identity 導出チェーンの厳格性**:
   - `LINE User ID (verified) → Person / Staff Identity → Branch → Branch Activity Target Regions`
   - クライアントが自己申告する `staffId` や `staffName` を認証・認可の根拠として信用しない。
   - サーバー側で LINE プラットフォームにより検証された `lineUserId` から `staffId` を逆引きし、クライアント送信値を強制上書きする。
2. **1地区専用スプレッドシート解決 (`SpreadsheetResolver`)**:
   - 当該Spreadsheetに付属する1地区専用GASは、`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` の優先順により、自地区専用のスプレッドシート（DB）を1対1で解決する。
   - 複数地区共用親GASによる越境ルーティングは行わない。
3. **SYSTEM_INFO Integrity Guard**:
   - 接続先スプレッドシートを開いた直後、`SYSTEM_INFO` シートの `地区コード` を読み出し、リクエストの `districtId` と一致することを検証する。
   - 万が一不一致の場合は `DISTRICT_MISMATCH` 例外をスローし、即時トランザクションを中断する。
4. **クライアント側 HMAC 共有鍵の完全却下 (REJECT - ADR-006)**:
   - Hアプリはブラウザおよび PWA 環境（HTML/JavaScript）で動作するクライアントアプリケーションである。クライアントに共有鍵（HMAC Secret）を保持させた場合、開発者ツールや逆コンパイルにより即座に鍵が抽出・漏洩し、認証境界が根本から崩壊する。
   - したがって HMAC 主認証案は完全に却下し、「フロントエンドに秘密情報を絶対に配置しない（No Secrets in Frontend）」原則を厳守する。
5. **業務データ直接 Fetch の絶対禁止 (Data Provisioning Security Rule)**:
   - 業務データ（CSV等）は、GitHub Pages 等の静的ホスティングからクライアント側で直接 Fetch してはならない。必ず GAS（`v2_api`）認証境界を経由し、認証・認可を通過した状態で取得すること。
6. **Public Bootstrap API & Dual Auth 境界**:
   - Hアプリ起動用の Public Bootstrap API（`getMapsApiKey`, `getTier1`, `verifyManagerPassword`, `registerOrValidateDevice`, `getDeviceStatus`）は、初期描画最適化（Optimistic Load）または初期ハンドシェイクのため無認証アクセスを許可する。
   - `getSystemSummary` は Dual Auth API であり、LIFF Token または Dashboard Session Token の有無に応じて返却スコープを動的制御する（未認証アクセス時は公開集約サマリのみ返却）。
   - 上記を除くすべての業務 API アクセス（doPost / doGet）は、トークンまたはセッション認証を通過しなければならない。

---

### 2.4 SEC-004: XSS (Cross-Site Scripting) 防護

1. **クライアント側サニタイズ (escapeHtml)**:
   - DOM描画を行うすべての箇所において、ユーザー入力値および外部取得データを `escapeHtml` 処理する。
   - 変換対象: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#039;`
2. **innerHTML 使用の制限**:
   - 原則として `textContent` または安全なテンプレート構文を使用する。
   - リッチテキスト描画が必要な場合は、事前にサニタイズされたDOMノードのみを挿入する。

---

### 2.5 SEC-005: 情報漏洩防止 (getSystemInfo Information Disclosure 防護)

1. **Manager PIN のパブリック露出完全禁止**:
   - 配布員端末（H App）の初期起動時に呼ばれる `getSystemInfo` API 等において、管理者PIN（`manager_pin`）をレスポンスに含めてはならない。
   - サーバー側レスポンス整形時に、機密プロパティをホワイトリスト形式でサニタイズする。
2. **lineUserId の秘匿**:
   - ランキング取得（`getRanking`）や最新実績取得（`getLatestRecords`）、名簿取得（`getRoster`）において、他者の `lineUserId` をレスポンスに含めない。
   - 自分自身のレコード判定には論理フラグ（`isMe: true/false`）のみを使用する。

---

### 2.6 SEC-006: Method Boundary & CSRF 防護

1. **HTTP メソッド境界の遵守**:
   - データ更新・登録・削除を伴うすべてのアクションは **HTTP POST** に限定する。
   - HTTP GET（`doGet`）での状態変更アクションは禁止する。
2. **GET 通信における認証情報送信の禁止**:
   - `doGet` のクエリパラメータに `liffToken` やセッショントークンを含めて送信することを禁止する。
   - 認証トークンは常に POST 本文（JSON Payload）にて送信する。

---

### 2.7 SEC-007: Google Maps API Key 地区別分離運用

1. **地区別環境変数命名規則**:
   - `GOOGLE_MAPS_API_KEY_<DISTRICT_ID>`（例: `GOOGLE_MAPS_API_KEY_KUWANA`）
2. **1地区専用GASでの解決**:
   - `getMapsApiKey` アクション時、リクエストされた `districtId` に対応するキー（または当該地区専用プロパティ）を Script Properties から取得して返却する。
3. **Legacy Fallback の廃止方針**:
   - 無印 `GOOGLE_MAPS_API_KEY` へのフォールバックは移行期間中のみ許容され、新設地区での利用は禁止する。全地区の移行完了後に完全廃止する。
4. **GCP 側の二重制限**:
   - **API制限**: Maps JavaScript API, Places API, Geocoding API に限定。
   - **アプリケーション制限**: 該当地区の運用ドメイン（Web App URL, LINE LIFF URL）に HTTP リファラー制限を適用。

---

## 3. Secret Lifecycle (機密情報ライフサイクル規程)

機密情報（API Key, Tokens, PIN）のライフサイクル管理は以下の原則に従う。

```text
[Local / CI Provisioning Host (.env)]  ※Gitコミット絶対禁止 (.gitignore)
       │
       ▼ (Provisioning Script / Admin Manual Setup)
[GAS Script Properties]                ※暗号化保存 / Web非公開
       │
       ▼ (Server-side Runtime Resolution)
[Universal Runtime (`active/`)]        ※ログ出力禁止 / クライアント露出制限
```

| フェーズ | 運用ルール / 制約 |
|:---|:---|
| **発行 (Creation)** | 最小権限原則。API制限およびHTTPリファラー制限を必ず付与して作成。 |
| **登録 (Storage)** | 当該1地区専用GASの Script Properties に格納。`.env` やソースコード、ドキュメントに実値を残さない。 |
| **利用 (Usage)** | メモリ内でのみ一時参照。監査ログやエラーログに平文を出力しない。 |
| **ローテーション (Rotation)** | 年1回または鍵漏洩疑惑時に実施。旧キーと新キーの並行運用期間（Grace Period）を設けず即時入替。 |
| **破棄 (Revocation)** | 地区廃止時（Deprovisioning）または漏洩時に、GCP Console から即時キーを失効（Delete）。 |

### 3.1 LINE Developers プラットフォーム統合構成
現場活動員の本人認証（LIFF）およびプッシュ通信を安全に維持するため、LINE Developers コンソール上の構造を以下のように管理する：
1. **Provider**: `Civic Tech Inc.` (最上位組織コンテナ)
2. **LINE Login Channel**: `POSTING MAP Login` (App type: Web app、Callback URL: `https://<district-domain>/`)
3. **Messaging API Channel**: `POSTING MAP Official` (Auto-reply: OFF, Greeting: ON, Webhook: ON)
4. **LIFF Application**: `POSTING MAP Field` (Size: `Full`, Endpoint: `https://<district-domain>/`, Scopes: `profile`, `openid`, Bot Prompt: `Aggressive`)
5. **シークレット隔離**: 長期チャネルアクセストークン等の機密情報は、リポジトリやフロントエンドへ配置せず、当該1地区専用GASの `ScriptProperties` に隔離保管する。

---

## 4. 監査可能性と不正利用対策 (Auditability & Abuse Protection)

1. **改ざん不可能な監査ログ (Audit Trail)**:
   - 全更新アクションにおいて、サーバー側で確定された `staffId`、JSTタイムスタンプ（`completedAt`）、リクエストID（`requestId`）をスプレッドシートへ記録する。
2. **同時実行・二重送信防止**:
   - `LockServiceProvider`（GAS `LockService.getScriptLock()`）によるトランザクション排他制御を適用（タイムアウト: 30,000ms）。
   - クライアント生成の `requestId` による同一操作の重複登録防止（冪等性保証）。
