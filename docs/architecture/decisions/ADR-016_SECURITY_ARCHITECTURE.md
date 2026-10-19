# ADR-016: Universal POSTING MAP Security Architecture & Threat Model

## Status
Accepted

## Context
POSTING MAP は配布員・管理者・支部が日常的に利用するフィールドオペレーションシステムであり、配布員個人のプライバシー情報（LINE認証情報・GPSログ・活動履歴）および各地区の機密情報（名簿・在庫・進捗）を取り扱う。
システムは単一の共通ランタイム（Universal Engine）上で動作し、データ交換によって複数地区（テナント）を運用する設計となっている。

最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md`）第5節「Identity / Tenant / Branch境界」および第15節「Phase 15 — Security」、ならびに AGENTS.md 就業規則に基づき、Universal POSTING MAP Engine における公式セキュリティ仕様および脅威モデル（10大要件）を固定・明文化する。

## Decision

### 1. 10大セキュリティ要件 (Security Tenets)

#### ① Identity (操作主体認証の唯一根拠)
- LINE Front-end Framework (LIFF) の `liffToken` を介し、LINE 公式 API（`https://api.line.me/v2/profile`）による Bearer トークン検証を唯一の Identity 根拠とする。
- クライアント申告の `lineUserId`, `staffId`, `staffName` を一切信用（認証）しない。
- 検証済み `lineUserId` から名簿を通じて Staff Identity を解決する。

#### ② Authorization (業務権限の強制解決)
- 業務 Write 系 API（配布実績報告、GPS/写真登録等）は、Backend 側で解決された正規の Staff Identity（`staffId`）を強制適用する。
- クライアントが他人の `staffId` を指定・偽装してリクエストしても、Backend 側で無視・上書きし、操作主体の権限を強制束縛する。
- 名簿未登録のユーザーからの業務操作は `NOT_REGISTERED` で厳格に遮断する。

#### ③ Tenant Isolation (地区・テナント間の物理・論理分離)
- 当該Spreadsheetに付属する1地区専用GASによる1地区1DBの物理分離を採用し、`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` の優先順により自地区専用のスプレッドシート（DB）を解決する。
- 接続先スプレッドシート内の `SYSTEM_INFO` シートに記録された `地区コード` と要求された `districtId` を照合する `verifyIntegrityGuard`（`DISTRICT_MISMATCH`）を義務付け、越境アクセス・クロステナント汚染を物理的・論理的に完全遮断する。
- 管理者セッション（`sessionToken`）にも発行時の `districtId` を拘束し、異地区リクエストへの流用を即時拒絶する。

#### ④ Input Validation (入力検証と型・値境界)
- すべての API エントリーポイント（`doGet`, `doPost`）において、リクエストパラメータの型・必須項目・長さを厳格に検証する。
- 未知のアクション、不正な JSON、空文字トークン、不正な引数は即時エラー（`INVALID_ARGUMENT`, `UNAUTHORIZED`）として処理する。

#### ⑤ XSS (Cross-Site Scripting 防護)
- ユーザー入力値（メッセージ、連絡先等）および外部データ（町丁目名、スタッフ名、日時等）を DOM に描画するすべての箇所で `escapeHtml` (SEC-004) を適用する。
- HTML 特殊文字（`&`, `<`, `>`, `"`, `'`）を無害化し、クライアントサイドでのスクリプト注入を防止する。

#### ⑥ CSRF / Method Boundary (リクエスト偽造・経路保護)
- `doGet` エンドポイント経由での `liffToken` 送信を検知した場合、即座に拒絶する（`Token transmission via GET is prohibited`）。
- 状態を変更する業務更新・認証系処理はすべて POST メソッドに限定し、URL パラメータやリファラからのトークン漏洩を防止する。

#### ⑦ Secret Exposure (機密情報・鍵ファイルの完全保護)
- 秘密鍵、サービスアカウント鍵、APIシークレット、`.env`、`.secrets/`、`deployment.json` 等の機密ファイルを Git 追跡および公開リポジトリから完全に除外する（`.gitignore` 厳格適用）。
- 万一のソースコード閲覧時にも、機密情報がテキスト・ログ・画面上に露出しない最小権限管理を維持する。

#### ⑧ lineUserId Exposure (個人識別子の非露出原則)
- 配布員本人の `lineUserId` は Backend 認証および内部識別キーとしてのみ使用し、API レスポンス（配布実績一覧、名簿、ランキング、掲示板等）には一切含めない。
- 本人特定判定は Backend で行い、フロントエンドには `isMe: true/false` フラグのみを返却する。他者の `lineUserId` がフロントエンドに露出することを恒久的に禁止する。

#### ⑨ API Abuse & Idempotency (二重送信防止・排他ロック)
- クライアント側で `requestId`（UUID v4）を発番し、通信リトライ時も同一 ID を維持することで冪等性を保証する。
- クライアント側で提出中の多重タップを防止する `submitting` ガードを設ける。
- サーバー側では `LockServiceProvider`（`lock_adapter.js` 標準 10 秒）および `GPSService`（`gps_service.js` `waitLock(15000)` 15 秒）による排他スクリプトロック（`LockService.getScriptLock`）を実行し、同一リソースへの同時書き込み・競合破壊を防止する。

#### ⑩ Audit Logging (操作追跡性と監査ログ)
- 配布実績、名簿登録、システム設定変更等の重要操作は、タイムスタンプ（JST）および解決済み `staffId` を台帳に不可逆記録する。
- 追跡不能な匿名操作やサイレントな変更を排除し、完全な監査証跡を保持する。

## Consequences
- 現場配布員および管理者が安心して利用できる最高水準のセキュリティ基盤が確立される。
- Universal Engine がどの地区（テナント）に展開されても、コードの改変なしに堅牢なセキュリティ境界が自動的に維持される。
- 外部 APM や外部 WAF 等の不要な複雑性を排除し、軽量・高速・自己完結型のセキュリティモデルが固定される。
