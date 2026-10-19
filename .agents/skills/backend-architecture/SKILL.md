---
name: backend-architecture
description: 1地区専用GASバックエンド規範。地区専用スプレッドシートDB直接接続、並行性制御、地区境界整合性と認可の分離。
---

# Backend Architecture Capability Pack

## 1. 概要と適用責務
本 Pack は、バックエンド API（`active/api/v2_api.js`、`active/business/`、`active/gas/`）の開発・改修において、当該Spreadsheetに付属する1地区専用GASとしての自律閉塞性を保ち、地区専用スプレッドシートDB原則および並行性制御を厳守するための専門能力規格である。

## 2. 正本仕様依存 (Canonical Sources)
- [API_CONTRACT.md](../../../docs/api/API_CONTRACT.md): API仕様書
- [v2_api.js](../../../active/api/v2_api.js): バックエンドエントリポイント

## 3. 遵守すべき絶対規範
1. **1地区専用スプレッドシートDB & 付属1地区専用GAS原則**:
   - 各地区は `1地区 = 1単独スプレッドシート（DB） = 当該Spreadsheetに付属する1地区専用GAS` として物理的に自己完結する。
   - スプレッドシートの解決は `TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()` の優先順で行う。複数地区を1本の親GAS（`DISTRICT_REGISTRY`）で束ねる構造は採用しない。
2. **Universal Engine 純粋性の維持**:
   - バックエンドコード（`active/api/v2_api.js` 等）は全地区共通の Universal Engine であり、地区固有のIDや名称をコード内にハードコードしてはならない。
3. **並行性・競合排他制御 (LockService)**:
   - スプレッドシートへの書き込みを伴うミューテーション API（`submitDistribution`, `updateRecordWithGPSPhoto`, `updateFlyerStock`, `createBulletinPost`, `sendBulletinContact` 等）は、必ず `LockService.getScriptLock()` による排他ロックを取得して実行する。
4. **地区境界整合性検証と認可の分離**:
   - クライアントからの `districtId` は対象スプレッドシート内の `SYSTEM_INFO`（`地区コード`）との整合性検証（`DISTRICT_MISMATCH` 遮断）に使用し、アクセス権限の根拠として信頼してはならない。
   - 認可は必ず検証済み `lineUserId`（または管理者セッション）と当該地区DBの名簿照合によって判定する。
