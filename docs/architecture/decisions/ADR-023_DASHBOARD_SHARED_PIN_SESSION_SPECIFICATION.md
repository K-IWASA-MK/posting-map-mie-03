# ADR-023: Dashboard 共有PIN サーバーサイドセッション認証仕様 (Dashboard Shared PIN Server-Side Session Specification)

- **Status**: ACCEPTED (OFFICIAL SPECIFICATION)
- **Date**: 2026-09-25
- **Deciders**: Universal POSTING MAP Architecture Board / MASTER
- **Consulted**: `AGENTS.md`, `docs/architecture/01_DESIGN_CONTRACT.md`, `docs/api/API_CONTRACT.md`, `active/api/v2_api.js`, `active/manager/manager.js`

---

## 1. Context (背景と課題)

セキュリティ監査（SEC-001）において、以下の重大な認証バイパス（P1）が確認された：
1. **クライアント側UI依存の偽装認証**:
   - 従来の 6桁共有PIN 認証は、フロントエンド（`manager.js`）が `verifyManagerPassword` 成功時に `localStorage.setItem('pm_auth_' + districtCode, 'true')` を書き込み、単に画面のPIN入力モーダルを非表示化しているだけであった。
   - 開発者ツール（DevTools）から `localStorage.setItem('pm_auth_KUWANA', 'true')` を実行するだけで、PINを入力せずにダッシュボード画面を開くことが可能であった。
2. **バックエンド API 認証の欠落**:
   - `active/api/v2_api.js` において、`isDashboardAction`（`getRoster` 等）および `isReadOnlyAction`（`getSystemSummary`, `getRanking` 等）は、未認証（`auth.success === false`）であっても処理を続行していた。
   - Web App URL に対して直接 GET/POST リクエストを送信するだけで、第三者が全配布員の実名名簿・実績・最新GPS配布履歴を無制限に取得可能であった。

### 本プロダクトの固定前提条件
- **Hアプリ（配布員・ボランティア用）**: LINE連携による個人識別（LINE Access Token / LIFF）。
- **Dashboard（支部長・管理者用）**: 6桁共有PINによる管理者認証。
- **両者の完全分離**: Dashboard に LINE認証を導入せず、6桁共有PIN モデルを厳格に維持する。

---

## 2. Decision (決定内容)

### (1) サーバーサイドセッション基盤の確立
- 6桁PIN照合成功時（`verifyManagerPassword`）に、サーバー側（Google Apps Script `CacheService`）で暗号学的に安全なセッショントークン（`dashboardSessionToken`）を発行する。
- トークン仕様:
  - プレフィックス: `pms_dash_`
  - エントロピー: `Utilities.getUuid()` + タイムスタンプ + 乱数 + 地区IDの SHA-256 ハッシュ値。
  - キャッシュキー: `DASH_SESSION_` + SHA-256(トークン)。トークン平文はキーとして保存しない。

### (2) セッション有効期限 (TTL: 21600秒 / 6時間)
- 運用性と安全性のバランスを考慮し、セッションの有効期限は **21600秒（6時間）** とする。
- 根拠:
  - 支部長・管理者の1日の管理業務セッション（半日〜終日業務）を快適にカバーする。
  - Google Apps Script の `CacheService` における最大キャッシュ保持期間（21,600秒）と完全合致し、追加の外部ストレージに依存せず高速かつ安全に管理可能。
  - 期限切れ後は直ちに `UNAUTHORIZED` となり、再度のPIN入力を要求する。

### (3) テナント拘束 (Tenant Binding)
- セッションデータに認証対象地区ID（`districtId`）を永続バインドする。
- 認証された地区（例: `KUWANA`）とリクエスト対象地区（例: `OKAYAMA`）が一致しない場合、`DISTRICT_MISMATCH` で即座にアクセスを遮断する。

### (4) API エンドポイントにおける厳格な認可ゲート
`v2_api.js` の `doGet` および `doPost` において、「read-onlyだから認証不要」というバイパス構造を完全撤廃する。

| 認可区分 | 対象アクション | 認可ルール |
|---|---|---|
| **Public (公開)** | `getMapsApiKey`, `verifyManagerPassword`, `getTier1` | 認証不要 (地図描画・PIN照合入口) |
| **Dashboard 専用** | `getDashboardSnapshot`, `getRoster`, `getTransferRequests`, `getSystemInfo`, `logoutManager` | **有効な `dashboardSessionToken` が必須** (未認証は 401 拒絶) |
| **Dual-Audience (業務読取)** | `getSystemSummary`, `getRanking`, `getFlyerStock`, `getLatestDistribution`, `getDeliveryStats`, `getAreaDetails`, `getBulletinPosts` | **`dashboardSessionToken` または 有効な `liffToken` のいずれかが必須** |
| **Staff 専用書き込み** | `updateRecordWithGPSPhoto`, `updateFlyerStock`, `createBulletinPost`, `sendBulletinContact`, `requestFlyerTransfer`, `resolveTransferRequest`, `submitDistribution` | **有効な `liffToken` ＋ 名簿登録済みIdentity が必須** |

### (5) GET 直接アクセスの完全遮断
- GETリクエストによる `getRoster`, `getDashboardSnapshot`, `getRanking`, `getSystemSummary` 等の未認証アクセスは、すべて `401 UNAUTHORIZED` で即時遮断する。

### (6) localStorage 改ざん耐性と UI 復帰
- `active/manager/manager.js` は、単なるローカルフラグ（`pm_auth_xxx=true`）を一切信用しない。
- セッショントークンが存在しない場合、あるいはサーバーから `UNAUTHORIZED` / `DISTRICT_MISMATCH` が返却された場合は、直ちにローカル情報をクリアし、画面にPIN入力モーダル（`#manager-pin-gate`）を強制表示する。

### (7) 明示的ログアウト機構 (logoutManager)
- 支部長が手動でログアウトできるよう、`logoutManager` API を新設。
- サーバー側の `CacheService` からセッションを即時破棄（`cache.remove`）し、トークンを無効化する。

---

## 3. Consequences (影響と効果)

### 肯定的な結果
1. **P1 脆弱性の完全根絶**:
   - 6桁PINを知らない第三者が、ブラウザ開発者ツールや API 直接アクセス（GET/POST）によって非公開情報（名簿、GPS実績等）を取得することは物理的に不可能となった。
2. **既存 H アプリへの影響ゼロ**:
   - 配布員向け H アプリは既存の `liffToken` による認証を継続し、何ら動作変更なくそのまま稼働する。
3. **支部長の運用体験の維持**:
   - 6桁共有PINの利便性はそのまま維持され、1回ログインすれば6時間は再入力不要で快適に管理画面を利用できる。
4. **明示的なログアウト**:
   - 共有PC等での利用時、ログアウトボタンを押すことで即時にサーバーセッションを無効化できる。

---
