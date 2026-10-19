# ADR-021: Production Monitoring Specification (本番運用監視仕様書)

## Status
Accepted (Approved) — Phase 20 本番監視運用契約

## Context
POSTING MAP Universal Engine は、フィールドオペレーション（現場配布員・Hアプリ）、支部分析・管理（ダッシュボード・マネージャー）、およびバックエンド（Google Apps Script / Google Spreadsheet）が有機的に連動する統合システムである。
本番稼働において、現場作業の停止、データ破損、二重登録、不正アクセスを未然に防止し、万一の障害発生時にも迅速に検知・トリアージ・復旧を行うため、マスタープラン Phase 20 が定める 8 つの本番監視領域に対する運用基準を確立する。

### 基本原則と制約事項
1. **既存基盤の最大活用と外部SaaSの排除**:
   - Google Cloud Logging、Google Apps Script 実行ログ/ダッシュボード、ブラウザ標準 Web Performance API、IndexedDB（`DurableQueue`）等の既存機構を最大限に活用する。
   - Datadog、Sentry、New Relic、PagerDuty 等の外部有償SaaSや複雑なインシデント管理基盤、オンコールシステムは導入しない（Universal 設計境界およびコスト・運用最小化の徹底）。
2. **性能契約の SSOT 厳守（Phase 14 / ADR-015）**:
   - 性能指標・SLA目標値は、Phase 14 で確定した [ADR-015: Universal POSTING MAP Performance Contract & SLA Specification](ADR-015_PERFORMANCE_CONTRACT.md) および [docs/api/API_CONTRACT.md](../../api/API_CONTRACT.md) 第20章を唯一の SSOT とする。
   - Phase 20 において勝手に新たな性能SLAを策定・再定義することは厳格に禁止する。
3. **Freeze と DurableQueue の因果関係**:
   - Phase 19（[ADR-020](ADR-020_CUTOVER_ROLLBACK_SPECIFICATION.md)）で定義した Freeze（書き込み停止・業務凍結）を厳格に実施する。
   - `DurableQueue`（IndexedDB）の役割は、Freeze 開始時点で現場端末側に残存する未送信データを保護・保持することであり、DurableQueue の存在を理由に業務停止・Freeze を回避してはならない。
4. **Severity 1〜3 の位置づけ（仕様の上位化禁止）**:
   - Severity 1〜3 は、Phase 20 の運用における現場・管理者のトリアージ（対応優先度判断）のための**最小補助分類**であり、マスタープランにない新規インフラ、SLA、監視基盤を要求するものではない。
5. **Phase 20 の完了境界と本番実績の分離**:
   - 本フェーズ（Phase 20）の責務は「監視対象8項目の定義、検知方法・判定条件・Severity・一次対応の確立、およびUniversalエンジンの監視可能性の自動検証」である。
   - 実際の Cutover 後の実トラフィック下で得られる本番メトリクス（実際のバックログ件数、実測レイテンシ推移、実障害件数等）は、実本番運用への引き継ぎ事項として明確に分離する。

---

## Decision

### 1. 8大監視項目の監視運用マトリクス

マスタープラン Phase 20 が要求する 8 つの監視対象について、以下の「検知対象 → 検知方法 → 判定条件 → Severity → 一次対応」の運用契約を公式に固定する。

| # | 監視対象項目 | ① 検知対象 | ② 検知方法 | ③ 判定条件（閾値） | ④ Severity | ⑤ 一次対応（SOP） |
|---|---|---|---|---|---|---|
| **1** | **API errors** | Web App API 呼出エラー（HTTP 5xx, 4xx, `{ success: false }`） | Google Cloud Logging / GAS実行ログ、クライアント `fetch` キャッチログ | API エラー率 > 1%（警告）<br>API エラー率 > 5%（重大） | **Severity 2** (警告)<br>**Severity 1** (重大) | 発生エンドポイント特定、パラメータ妥当性確認、必要時直前GASバージョンへのロールバック（ADR-020） |
| **2** | **queue backlog** | 端末側 `DurableQueue`（IndexedDB `syncQueue`）の未送信保留滞留 | Hアプリ `getQueue()`, `isRowInQueue(rowId)`, UI同期バッジ | 未送信滞留件数 > 10件<br>またはリトライ上限（5回）到達 | **Severity 2** (警告) | 現場端末の電波状況確認、機内モードON/OFF、手動再送ボタン操作、アプリ再起動（IndexedDBデータ保持） |
| **3** | **duplicate events** | 同一ピン/行への重複報告、多重キューイング、二重LINE Push | クライアント `Duplicate enqueue avoided` ログ、バックエンド `[IDEMPOTENCY] Cache hit` ログ | 同一 `rowId` / `requestId` の重複送信が短時間に頻発 | **Severity 3** (情報)<br>**Severity 2** (多発時) | べき等性による二重書き込み遮断の確認、クライアント側の連打防止・多重実行フラグ確認 |
| **4** | **latency** | API 往復時間 (RTT) および画面描画遅延 | ブラウザ Performance API (`performance.now()`)、Cloud Monitoring 実行時間 | **ADR-015 SSOT 準拠**：<br>- Warm/Offline $T_2 > 250\text{ ms}$<br>- Cold $T_2 > 1000\text{ ms}$<br>- API P95 > 10,000ms | **Severity 2** (警告) | スプレッドシート行数・セル過多確認、Lock競合確認、通信帯域・ネットワーク環境確認 |
| **5** | **GAS errors** | GAS ランタイム例外、実行時間上限、Quota 枯渇 | Google Cloud Error Reporting、GASダッシュボード「失敗数」 | 実行時間超過（Web App 30秒 / Batch 6分）、Quota 枯渇例外 | **Severity 1** (停止級)<br>**Severity 2** (バッチ失敗) | エラースタックトレース分析、Script Properties（`TARGET_SPREADSHEET_ID`, `MAPS_API_KEY` 等）健全性確認、バッチ手動再実行 |
| **6** | **Spreadsheet lock** | `LockService.getScriptLock()` 排他制御の獲得タイムアウト | GAS実行ログ `Lock Timeout: Failed to acquire lock within 10000ms.` | 発生頻度 > 5回 / 10分 | **Severity 1** (重大混雑) | 同時アクセス負荷の分散、長時間書き込み処理の非同期化・バッチ化 |
| **7** | **map failure** | Google Maps JS API / Leaflet / OSM タイル・GeoJSON障害 | ブラウザ `window.onerror`、地図初期化ガード (`!window.google.maps`) | 地図コンテナ描画不能、タイルロード失敗、ポリゴンパース失敗 | **Severity 2** (UI不全) | APIキー/クォータ確認、ブラウザキャッシュクリア、オフライン案内UI表示 |
| **8** | **authentication failure** | LINE認証拒否、GET経由トークン拒否、`UNAUTHORIZED`, `FORBIDDEN`, `DISTRICT_MISMATCH` | GAS実行ログ (`Authentication Error`), Cloud Logging HTTP 401/403 | 連続認証失敗（ブルートフォース疑い）、他地区アクセス試行 | **Severity 2** (警告) | LINE LIFF設定確認、端末登録用URL再発行、不正アクセスIP特定・遮断 |

---

### 2. Severity（トリアージ最小補助分類）の定義

| Severity レベル | 定義・影響範囲 | 目標対応時間 | 主な対象事象 |
|---|---|---|---|
| **Severity 1 (Critical)** | 全体停止・業務不能・データ書き込み完全停止 | 即時着手（15分以内） | APIエラー率 > 5%、GAS実行タイムアウト多発、Spreadsheet Lock Contention 頻発 |
| **Severity 2 (Warning)** | 機能一部制限・遅延・キュー滞留・特定端末不全 | 1時間以内 | queue backlog > 10件、ADR-015 SLA逸脱、地図描画障害、認証失敗検知、APIエラー率 1〜5% |
| **Severity 3 (Info)** | 正常に吸収・遮断された事象・情報ログ | 日次確認 | 重複イベントの正常遮断（べき等性キャッシュヒット）、軽微な一時リトライ（1〜2回で解消） |

---

### 3. 8大監視項目の詳細運用 SOP (Standard Operating Procedures)

#### (1) API errors 監視運用
- **検知メカニズム**:
  - `active/api/v2_api.js` の統一エラーハンドリングにより、すべての例外は `{ success: false, error: err.toString() }` または `{ success: false, code: "...", message: "..." }` として JSON 出力される。
  - Google Cloud Logging 上で `resource.type="app_script_function"` かつ `textPayload =~ "error"` をフィルタリング。
- **一次対応**:
  1. 発生している API アクション名（`updateRecordWithGPSPhoto`, `getRanking` 等）を特定。
  2. スプレッドシート側の列構造破損やシート名不一致（`DISTRICT_MISMATCH` 等）がないか確認。
  3. 原因が直近デプロイのコード起因である場合、[ADR-020 Level 1 外科的ロールバックまたは直前GASバージョンへのロールバック](ADR-020_CUTOVER_ROLLBACK_SPECIFICATION.md) を発動。

#### (2) queue backlog 監視運用
- **検知メカニズム**:
  - Hアプリ（`active/h-app/db.js`）の `syncQueue`（IndexedDB）において、`getQueue()` で取得される未送信件数を追跡。
  - `updateUISyncStatus()` を通じて、未送信件数が 0 より大きい場合はヘッダー等に同期中バッジを表示。
- **一次対応**:
  1. 現場作業者の通信状態（電波微弱、機内モード、Wi-Fi接続不良）を確認。
  2. 未送信件数が 10 件を超過している場合、作業者に通信安定エリアへの移動を指示。
  3. 最大リトライ（5回）超過により保留となったレコードは、手動再送ボタン（`processQueue()`）またはアプリ再起動により IndexedDB から安全に再送。

#### (3) duplicate events 監視運用
- **検知メカニズム**:
  - クライアント側（`db.js`）: `enqueueSync` 内の単一トランザクションで同一 `rowId` を検査し、重複時は `[Queue] Duplicate enqueue avoided for rowId=...` を記録。
  - バックエンド側（`bulletin_service.js`, `transfer_service.js`）: `requestId` を用いた CacheService 突合により、重複時は `[IDEMPOTENCY] Cache hit SENT for requestId: ...` を記録し多重処理を阻止。
- **一次対応**:
  1. 重複が正常にブロックされていることをログで確認（Severity 3）。
  2. 同一端末から短時間に数十件の重複リクエストが届いている場合、端末側のダブルタップ防止（UIロック）が機能しているかを調査。

#### (4) latency 監視運用
- **検知メカニズム**:
  - クライアント側: ブラウザ標準 Web Performance API による $T_0 \sim T_5$ シーケンス計測。
  - バックエンド側: Google Cloud Monitoring における API 実行時間メトリクス。
- **一次対応**:
  1. **ADR-015 基準値との照合**:
     - Warm/Offline Start ($T_2$): 中央値 $\le 200\text{ ms}$（許容上限 $\le 250\text{ ms}$）
     - Cold Start ($T_2$): 中央値 $\le 800\text{ ms}$（許容上限 $\le 1000\text{ ms}$）
     - バックエンド API P95: $\le 10,000\text{ ms}$（`API_CONTRACT.md` 第20章）
  2. 許容上限を超過した場合、スプレッドシートの不要な空行・空セル（数千行の空白セル）が存在しないか、`SYSTEM_INFO` や当月シートのセル走査範囲を点検。

#### (5) GAS errors 監視運用
- **検知メカニズム**:
  - Google Cloud Error Reporting および Apps Script ダッシュボードの「失敗」タブ。
- **一次対応**:
  1. Web App タイムアウト（30秒）またはバッチタイムアウト（6分）の有無を確認。
  2. `UrlFetchApp` 日次クォータ（20,000回/日）の消費状況を Google Workspace 管理コンソールで確認。
  3. `ScriptProperties`（`TARGET_SPREADSHEET_ID`, `MAPS_API_KEY` 等）の破損が疑われる場合は、[ADR-018](ADR-018_PRODUCTION_DEPLOYMENT_SPECIFICATION.md) に基づきプロパティを再設定。

#### (6) Spreadsheet lock 監視運用
- **検知メカニズム**:
  - `active/infrastructure/lock/lock_adapter.js` の `LockServiceProvider`:
    `lock.tryLock(timeoutMs)` が 10,000ms 以内に獲得できない場合、`Lock Timeout: Failed to acquire lock within 10000ms.` 例外をスロー。
- **一次対応**:
  1. 10分間に 5 回以上の Lock Timeout が発生した場合（Severity 1）、一括同期や重厚なバッチ処理が稼働していないか確認。
  2. 同時書き込みが集中している場合、現場作業者の報告間隔の平準化、またはバッチ処理へのオフロードを検討。

#### (7) map failure 監視運用
- **検知メカニズム**:
  - Hアプリ（`render.js`, `app.js`）: `if (!mapEl || !window.google || !window.google.maps) return;` による初期化ガード。
  - Manager（`manager.js`）: Leaflet / OSM タイルおよび GeoJSON ロード処理の例外ハンドリング。
- **一次対応**:
  1. Google Cloud Console にて Google Maps JavaScript API の有効化状態、API キーのドメイン制限、クォータ上限を確認。
  2. ブラウザのキャッシュ破損が原因の場合は、シークレットウィンドウでの起動またはキャッシュクリアを作業者に案内。
  3. 地図が読み込めない場合でも、未送信キューのデータは保護されることを作業者に通知。

#### (8) authentication failure 監視運用
- **検知メカニズム**:
  - `active/api/auth/auth.js`, `v2_api.js`:
    - GET 経由トークン送信の拒否: `{ success: false, error: "Token transmission via GET is prohibited." }`
    - 自治体コード不一致: `{ success: false, error: "DISTRICT_MISMATCH: ..." }`
    - 未認可・契約期限切れ: `CONTRACT_EXPIRED`, `UNAUTHORIZED`, `FORBIDDEN`
- **一次対応**:
  1. 単発の拒否はクライアント側のセッション失効・パラメータ誤りとして処理（端末再認証案内）。
  2. 同一IPまたは同一識別子から短時間に連続する未認可アクセス（ブルートフォース疑い）を検知した場合、Cloud Armor またはアクセス元遮断を実施。

---

## Consequences
- マスタープラン Phase 20 が要求する 8 つの監視領域に対する運用責任・検知基準・トリアージ手順が公式に固定される。
- ADR-015 性能契約および Phase 19 Freeze 契約との整合性が完全に維持され、設計の矛盾や過剰設計が排除される。
- 外部有償ツールに依存することなく、標準の Google Cloud / Apps Script / ブラウザ基盤のみで完結する堅牢な自律運用体制が確立される。
