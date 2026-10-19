# ADR-018: Universal Production Deployment & Verification Specification

- **Status**: ACCEPTED
- **Date**: 2026-09-25
- **Deciders**: Universal Engine Architecture Team
- **Consulted**: Master Plan Phase 17 Requirements, ADR-015, ADR-016, ADR-017

---

## 1. Context & Background

マスタープラン Phase 17 では「Production Deploy」として以下の必須パイプラインが定義されている：

```text
Code → Git → clasp push → GAS deployment → Production WebApp → API verification → Production reflection verification
```

本システム（Universal POSTING MAP）では、「Git push で完了としない」「本番Runtimeでのエビデンスを完了条件とする」という鉄則を定めている。
また、Phase 17 当時のデプロイ台帳（`DEPLOYMENT_REGISTRY.md`、現在は `SYSTEM_INFO`・`data/config.js`・`district-app-deployment` スキルへ統合廃止）にて以下の最高位原則が規定された：
> **Production の Web App URL はシステム資産である。**
> 更新対象は URL ではなく、Deployment のコードのみとする。
> URL を変更してはならない。

Phase 17 の実施にあたり、本番インフラの固定化、デプロイ方式、および本番検証仕様を正式に決定する。

---

## 2. Decisions & Architecture Contracts

### 2.1 既存 Deployment ID の恒久固定と URL 資産化
1. **新規 Deployment ID の作成禁止**:
   - `clasp deploy` を単独実行して新規 Deployment ID を作成することを厳禁とする。
2. **既存 Deployment ID の維持と新バージョン紐付け**:
   - 本番 Deployment ID: `AKfycbyjeoNc8CeTT6AyNdTSBTqLFGHs23vUaQiavSlsPKjVmMBZ5hE_KlJqN8RI12cgb7S-`
   - Web App URL: `https://script.google.com/macros/s/AKfycbyjeoNc8CeTT6AyNdTSBTqLFGHs23vUaQiavSlsPKjVmMBZ5hE_KlJqN8RI12cgb7S-/exec`
   - コマンド `clasp deploy -i <Deployment ID> -d "..."` により、既存の Deployment ID に対して新バージョン（`@7`）を直接紐付ける。
   - これにより、外部クライアントやLINE Webhookの設定変更をゼロとする。

### 2.2 clasp push の位置付け
- Phase 7〜16 において、GAS バックエンドの Tracked files（`active/api/`, `active/business/`, `active/gas/`, `active/infrastructure/`, `active/appsscript.json`）に変更差分は生じておらず、ローカルとリモートは完全一致している。
- したがって `clasp push` は「コード変更のため」ではなく、「ローカル Tracked files と GAS 側 HEAD の完全一致（差分ゼロ）を客観確認・同期する工程」として位置付ける。

### 2.3 SSOT ファイルと秘密情報保護規程
1. **`deployment.json`**:
   - ローカル実行用として最小限の非機密情報（Script ID, Deployment ID, Web App URL、およびローカルツール・LIFFプロビジョニング検証用の District ID, Production LIFF URL）を保持する。
   - Secret, Token, OAuth credential は絶対に格納しない。
   - **`.gitignore` による除外を絶対維持**し、Git管理対象外とする。
2. **`deployment.template.json`**:
   - Universal リポジトリの純粋テンプレートとしてコミット管理する。
3. **本番 Deployment 資産 SSOT（旧 `DEPLOYMENT_REGISTRY.md`）**:
   - Phase 17 時点では `DEPLOYMENT_REGISTRY.md` に記録し、現行運用では地区専用スプレッドシート `SYSTEM_INFO`、`data/config.js`、および `.agents/skills/district-app-deployment/SKILL.md` を正本として管理する。

### 2.4 本番 Web App 実機検証ゲート（Production Verification Gates）
デプロイ完了後、実際に本番 Web App エンドポイントに対して通信を行い、以下の 5 大ゲートでランタイム反映を自動検証する：

1. **Gate 1: SSOT & Deployment Configuration Integrity**
   - `deployment.json` および `data/config.js` / `SYSTEM_INFO`（Phase 17 時点は旧 `DEPLOYMENT_REGISTRY.md`）の整合性
2. **Gate 2: Active Deployment Version Gate**
   - `clasp deployments` の結果、本番デプロイIDのアクティブバージョンが新バージョン（`@7`）であること
3. **Gate 3: Production WebApp Public API Reachability & Health**
   - `registerOrValidateDevice` ➔ HTTP 200 `{ success: true, authorized: true }`
   - `getDeviceStatus` ➔ HTTP 200 `{ success: true, exists: false, rows: [] }`
4. **Gate 4: Protocol & Routing Safety Gates (Live Verification)**
   - POST専用API（`bootstrapEnvironment`）への GET 拒絶（`METHOD_NOT_ALLOWED`）
   - 未知地区ルーティング遮断（`DISTRICT_MISMATCH`）
   - 契約満了時の安全側遮断（`CONTRACT_EXPIRED` Fail-Closed 動作）
5. **Gate 5: ADR-018 Architecture Compliance**
   - 本仕様書との整合性

---

## 3. Consequences & Benefits

- **無停止・無設定変更の安全デプロイ**: Web App URL が不変であるため、本番運用中のクライアントに一切影響を与えない。
- **完全な再現性と監査性**: デプロイされたコードのコミットハッシュ（`1832b15`）、バージョン番号（`@7`）、エンドポイントの応答がすべて自動テストで担保される。
- **秘密情報ゼロコミット**: `deployment.json` は Git 除外され、リポジトリ内へのシークレット漏洩リスクが恒久的に排除される。
