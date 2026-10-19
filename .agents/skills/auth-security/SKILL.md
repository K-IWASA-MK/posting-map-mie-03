---
name: auth-security
description: 認証セキュリティ規範。Public / Dual Auth / 認可必須 API 境界の厳格維持、LINE LIFF 検証、管理者セッション管理。
---

# Auth Security Capability Pack

## 1. 概要と適用責務
本 Pack は、POSTING MAP システム全体の認証境界、トークン検証、セッション管理、認可判定において、不正アクセスやなりすまし、認証バイパスを物理的に遮断するためのセキュリティ規格である。

## 2. 正本仕様依存 (Canonical Sources)
- [API_CONTRACT.md](../../../docs/api/API_CONTRACT.md): API仕様書（§6, §10 認証契約）
- [SECURITY_BASELINE.md](../../../docs/security/SECURITY_BASELINE.md): セキュリティベースライン（SEC-001〜SEC-007）

## 3. 遵守すべき絶対規範
1. **厳格な 5 層認証・認可境界 (`active/api/v2_api.js`)**:
   - **Public Bootstrap / Health API**: 初期起動・ハンドシェイク用（POST: `getMapsApiKey`, `verifyManagerPassword`, `getTier1` / GET: `registerOrValidateDevice`, `getDeviceStatus`）。
   - **Dashboard Manager Auth API**: 管理者セッション（`sessionToken`）必須（`getDashboardSnapshot`, `getRoster`, `getTransferRequests`, `getSystemInfo`, `logoutManager`）。
   - **Dual-Audience Read API**: 登録済みアクティブスタッフ（LIFF Access Token）または管理者セッションのいずれかを要求（`getSystemSummary`, `getRanking`, `getFlyerStock`, `getLatestDistribution`, `getDeliveryStats`, `getAreaDetails`, `getBulletinPosts`）。
   - **Unregistered Staff Bootstrap API**: 検証済み LINE LIFF Access Token（未登録スタッフ可）を要求（`getStaffIdentity`, `registerStaff`）。
   - **Active Staff Mutation API**: 検証済み LINE LIFF Access Token かつ名簿登録済みアクティブスタッフを要求（`submitDistribution`, `updateRecordWithGPSPhoto`, `updateFlyerStock`, `requestFlyerTransfer`, `resolveTransferRequest`, `createBulletinPost`, `sendBulletinContact`, `setPinStatus`）。
2. **LINE LIFF Access Token のサーバー検証 (`active/api/auth/auth.js`)**:
   - クライアントから送信された `liffToken`（Access Token）は、当該Spreadsheetに付属する1地区専用GASバックエンド側で必ず LINE 公式エンドポイント（`GET https://api.line.me/v2/profile`）を呼び出して真正性を検証し、サーバー側で `userId` を解決する。
   - クライアント側から渡される `lineUserId` や `staffId` を信用してはならない。
3. **機密情報のフロントエンド配置禁止**:
   - フロントエンド（HTML/JS）に管理者パスワード、APIシークレット、秘密鍵を埋め込んではならない（No Secrets in Frontend）。
   - セッショントークンを GET クエリパラメータで送信してはならない。
