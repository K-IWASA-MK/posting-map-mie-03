---
name: durable-client-runtime
description: クライアント耐久性・永続化規範。IndexedDB オフラインキュー、楽観的先行描画、ローカルキャッシュ復元性。
---

# Durable Client Runtime Capability Pack

## 1. 概要と適用責務
本 Pack は、ポスティング現場の過酷な通信環境（電波微弱・オフライン・通信瞬断）において、現場配布員の入力データを 1 ビットも消失させず、ストレスのない快適な操作性を提供するためのクライアント実行基盤規格である。

## 2. 正本仕様依存 (Canonical Sources)
- [UNIVERSAL_QUALITY_DOCTRINE.md](../../../docs/architecture/UNIVERSAL_QUALITY_DOCTRINE.md): Universal 品質ドクトリン（第1条, 第5条）

## 3. 遵守すべき絶対規範
1. **IndexedDB 先行永続化 (Offline-First — `active/h-app/db.js`)**:
   - 現場配布完了登録（`updateRecordWithGPSPhoto`）は、ネットワーク通信に先立ってまずローカルの IndexedDB（`PostingMapDB` -> `syncQueue`）に永続保存する（※保管場所の在庫報告 `updateFlyerStock` は `StorageModule.saveHold` による直接オンラインAPI送信）。
   - 通信環境が復旧した時点で、バックグラウンド同期ワーカーが自動的にキューを消費してサーバーへ送信する。
2. **指数バックオフ自動再送**:
   - 一時的な通信障害に対しては、指数バックオフ（10s → 30s → 60s → 60s）を用いた自動リトライを実行し、サーバーに過剰な負荷をかけずに確実に同期を完了させる。
3. **Optimistic First Paint（先行描画）**:
   - アプリ起動時はローカルキャッシュ（`localStorage` の登録情報や直近サマリ）を用いて即座に画面を描画し、ネットワーク通信の完了を待たずに配布員が作業を開始できる状態を作る。
