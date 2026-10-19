# Backup & Restore Runbook (バックアップおよび障害復旧手順書)

- **Version**: 1.0.0
- **Status**: OFFICIAL STANDARD (SSOT)
- **Target**: Universal POSTING MAP Engine v1.0
- **Supreme Authority**: [AGENTS.md](../../AGENTS.md)
- **Security Baseline**: [SECURITY_BASELINE.md](../security/SECURITY_BASELINE.md)
- **Data Lifecycle**: [DATA_LIFECYCLE.md](../data/DATA_LIFECYCLE.md)

---

## 1. 目的と基本方針

本書は、Universal POSTING MAP におけるデータ損失、スプレッドシート破損、誤操作、インフラ障害等のインシデントから迅速・確実にデータを復旧するための **バックアップおよびリストア運用手順（SSOT）** を規定する。

### 基本方針
1. **1地区専用スプレッドシートDBの定期保全**:
   - 各地区の業務データ（配布実績、スタッフ名簿、在庫等）が蓄積される Google スプレッドシートを主要バックアップ対象とする。
2. **Secret の平文保存絶対禁止**:
   - Google Maps API Key、LINE Channel Secret、管理者PIN 等の機密情報は、**いかなるバックアップアーカイブにも平文で保存してはならない**。
3. **4層物理分離による復元安全性**:
   - スプレッドシート（DB）の復元・差し替え作業を行っても、Universal Runtime コード（`active/`）および Git 管理下の Master Data（`data/`）には一切影響を与えず、プログラム破壊リスクがゼロであること（ADR-001 4層物理分離の恩恵）。
4. **客観的指標の明記 (RPO / RTO)**:
   - 根拠のない目標復旧値は設定せず、現行インフラ（Google Drive / GAS）の制約を踏まえた現実的な指標を定義する（未確定事項は Decision Required と明記）。

---

## 2. 目標復旧指標 (RPO / RTO)

| 指標 | 定義 | 現行ステータス | 決定要件 / 備考 |
|:---|:---|:---:|:---|
| **RPO** (目標復旧時点) | 障害発生時に許容されるデータ消失期間 | **TBD / Decision Required** | Google Drive / GAS クォータ、自動スナップショット頻度、外部ストレージ連携方式の実測および業務要件に基づき正式決定 |
| **RTO** (目標復旧時間) | 障害発生からサービス再開までに要する時間 | **TBD / Decision Required** | 単一地区復旧手順の実測所要時間、および全地区同時障害時の自動化レベルに基づき正式決定 |

> [!NOTE]
> RPO / RTO の目標値は、机上の想定ではなく、実測データおよび運用体制の合意形成を経て確定させる（**Decision Required**）。

---

## 3. バックアップ対象と取得頻度

| 対象区分 | 対象リソース | バックアップ手法 | 取得頻度 | 保持期間 (Retention) | 保存先 |
|:---|:---|:---|:---:|:---:|:---|
| **業務データ (1地区DB)** | 当該地区 Google スプレッドシート | Google Drive 版履歴 + 自動スナップショット複製 | 日次 (定期バッチ) | **TBD / Decision Required**<br>(組織規程・業務合意に基づき決定) | バックアップ専用 Drive フォルダ (隔離) |
| **構成メタデータ** | 1地区専用GAS Script Properties キー定義（`TARGET_SPREADSHEET_ID` 等） | 設定エクスポートスクリプト (Secret値はマスク) | 変更時随時 | **TBD / Decision Required**<br>(監査要件に基づき決定) | Git (暗号化) または保護リポジトリ |
| **マスターデータ** | `data/` (住所・境界GeoJSON・自治体) | Git コミット履歴 | 変更時随時 | 永続 (Git) | GitHub リポジトリ |
| **監査証跡 (Audit)** | 配布完了タイムスタンプ、操作ログ | スプレッドシート内 `配布実績<Key>`（`配布実績YYYY-MM` 等） | リアルタイム | **TBD / Decision Required**<br>(法的要件・規約に基づき決定) | スプレッドシート DB |

> [!CAUTION]
> **Secret の除外原則**:
> `TARGET_SPREADSHEET_ID` 等の非機密接続識別子はバックアップ対象とするが、`GOOGLE_MAPS_API_KEY_<DISTRICT_ID>` や `MAPS_API_KEY` 等の鍵実値はバックアップ対象外とする。鍵情報は GCP Console およびマスター機密保管庫（KMS / 1Password等）にて独立管理する。

---

## 4. バックアップ取得手順 (Daily Backup Procedure)

### 自動バックアップ（標準運用）
1. スケジュール実行スクリプト（当該地区専用GAS タイムトリガーまたは管理バッチ）が起動。
2. 当該地区のスプレッドシート（`TARGET_SPREADSHEET_ID` → `SPREADSHEET_ID` → `SpreadsheetApp.getActiveSpreadsheet()`）を取得。
3. 当該スプレッドシートを、指定のバックアップ専用 Drive フォルダ（一般配布員・外部権限完全遮断）へ複製コピー。
4. ファイル名規則: `BACKUP_<districtId>_YYYYMMDD_HHmmss`
5. コピー完了後、正式合意された保持期間ポリシー（TBD / Decision Required）に基づき古いバックアップファイルをパージ。

### 手動バックアップ（計画メンテナンス・大規模更新前）
```text
# 計画変更前のスナップショット取得（Google Drive makeCopy またはシートエクスポート）
# 1. バックアップ専用 Drive フォルダへ BACKUP_<districtId>_YYYYMMDD_HHmmss として複製を作成
# 2. 複製したスプレッドシートを開き、シート一覧（SYSTEM_INFO およびアクティブ <Key> シート群）とレコード件数が元ファイルと一致していることを事前確認
```
- **確認事項**: 複製されたスプレッドシートが正常に開き、レコード数が元ファイルと一致していること。

---

## 5. リストア（復旧）詳細手順 (Restore Procedure)

### 【最重要原則】Spreadsheet全体Version Rollbackの絶対禁止と局所修正原則 (Surgical Repair Doctrine)
- **全体ロールバックの原則禁止**:
  スプレッドシート全体の過去版復元（Google Drive 版履歴による一括ロールバック）は、障害発生後に他の町丁目や他配布員から登録された正常な配布実績を不可逆的に巻き戻し・消失させる重大なデータ消失リスクを孕むため、**原則として絶対禁止**とする。
- **局所的修正（Surgical Repair）の徹底**:
  障害復旧は、影響を受けた対象レコード・町丁目のみを特定して差分修復する「外科的・局所修正（Surgical Repair）」を基本とする。
- **全体復元が必要な場合の独立承認ゲート**:
  スプレッドシート全体破損等の不可抗力により全体復元を行う場合は、作業着手前に「現行スプレッドシート全シートのCSVバックアップ取得」と「MASTER による明示的承認」を必須条件とする。

障害発生（スプレッドシート破損、行データの誤削除、Integrity Guard エラー等）時の標準復旧手順は以下の通り。

```text
[障害検知 & 地区一時停止 (SUSPENDED)]
       ↓
[復旧用バックアップファイルの選定]
       ↓
[スプレッドシート複製 & 整合性検証]
       ↓
[SYSTEM_INFO 及び シート構造（DATA_DICTIONARY.md 準拠）の確認]
       ↓
[1地区専用GASバインド / TARGET_SPREADSHEET_ID の差替え]
       ↓
[API Smoke Test & 導通確認]
       ↓
[サービス再開 (ACTIVE)]
```

### 5.1 スプレッドシート復旧ステップ詳細

1. **地区の一時停止 (Safety Suspension)**:
   - 二重書き込みや不整合拡大を防ぐため、当該地区のスプレッドシート `SYSTEM_INFO` の `状態` を `SUSPENDED` に変更（または1地区専用GAS Web Appを一時停止）する。
2. **バックアップファイルの特定と検証**:
   - 障害発生直前の健全なバックアップスプレッドシート（`BACKUP_<districtId>_YYYYMMDD_HHmmss`）をバックアップフォルダから特定。
3. **本番用スプレッドシートの再配備**:
   - バックアップファイルを本番フォルダ（`03_BRANCH/<districtId>/`）へ複製し、ファイル名を `<districtId>` に設定。
   - 新しいスプレッドシートID（`RESTORED_SPREADSHEET_ID`）を取得。
4. **Integrity Guard の確認**:
   - 複製したシートの `SYSTEM_INFO` を開き、`地区コード` が対象地区と完全一致していることを確認。
   - シート面内に不要なカスタム関数や `onEdit` トリガーが混入していないことを確認。
5. **1地区専用GASの参照先更新**:
   - 当該地区専用GASの Script Properties `TARGET_SPREADSHEET_ID` を `RESTORED_SPREADSHEET_ID` に更新（または付属GASを再配備）する。
6. **復旧検証 (Restore Verification)**:
   - 管理者権限で Dashboard にログインし、直近の実績データが正しく表示されるか確認。
   - API Smoke Test を実行し、データ取得・登録が正常に行われることを確認。
7. **サービス再開 (Re-activation)**:
   - `SYSTEM_INFO` の `状態` を `ACTIVE` に戻す。
   - 関係者へ復旧完了を通知。

### 5.2 Cutover & Rollback 標準運用手順 (Cutover & Rollback Standard Operating Procedure)

計画メンテナンスやスキーマ拡張（マイグレーション）を伴う本番切替および障害時の原状復帰手順（SOP）を規定する。
（アーキテクチャ受入基準・不変条件: [01_DESIGN_CONTRACT.md](../architecture/01_DESIGN_CONTRACT.md) §19 / API仕様契約: [API_CONTRACT.md](../api/API_CONTRACT.md) §27 参照）

#### 1. 事前スナップショット確立 (Pre-migration Snapshot)
- 計画変更・マイグレーション着手直前に、対象スプレッドシートを Google Drive 上で複製（`makeCopy`）し、タイムスタンプ付き退避バックアップ（`BACKUP_${ssName}_${timestamp}`）を確実に確立・アクセス検証する。

#### 2. Freeze（業務凍結・書き込み停止）プロトコル
1. **現場端末データの消失ゼロ保証**:
   - 現場党員の Hアプリは `DurableQueue`（IndexedDB）を搭載している。
   - サーバー側がメンテナンス中・一時遮断時でも、現場での配布入力データは端末内で暗号学的 UUID と共に安全に保留される。
2. **書き込み停止の実施**:
   - 管理者による事前アナウンスを実施。
   - スプレッドシート `SYSTEM_INFO` の状態変更または GAS `LockService` を用いて、業務更新 API への書き込みを一時的に遮断・保留する。
3. **インフライトリクエストのドレイン**:
   - 停止宣言後、30 秒間待機して通信中のリクエストが完全に完了（ドレイン）したことを確認する。

#### 3. 4大 Rollback 発動トリガー (Rollback Triggers)
以下の事象が **1 件でも発生した場合、即座にマイグレーション・切替を中止し、ロールバックを発動** する：
1. **API 致命的エラー**:
   - スモークテストにおいて、HTTP 500、GAS 実行時間超過（タイムアウト）、または破損レスポンスが返却された場合。
2. **データ行の消失・破損**:
   - 総行数が移行前より減少した場合、または既存 A〜O列のデータが破損・改変された場合。
3. **異常スキップの多発**:
   - 本来一致すべき配布員が想定外の理由で大量に未解決（スキップ）となった場合。
4. **現場通信障害の多発**:
   - 凍結解除後、現場端末からのキューフラッシュ（`DurableQueue` 送信）で永続的失敗が多発した場合。

#### 4. ロールバック手順 (Rollback Procedure)
障害発生時は、以下の優先順位で安全に原状復帰を実施する：

##### Level 1: 外科的列ロールバック (Surgical Column Rollback — 第一推奨)
- **概要**: 追加された新設列（P列、Q列、G列、M-N列）のみをクリアまたは列削除する。
- **安全性**: **極めて高い**。他の町丁目の正当な配布実績を一切巻き戻すことなく、数秒で旧スキーマ状態へ原状復帰できる。
- **手順**:
  1. スプレッドシート `配布実績` の 16 列目以降（P列 `lineUserId`、Q列 `requestId`）をクリア。
  2. `保有チラシ枚数` の 7 列目（G列 `lineUserId`）をクリア。
  3. `受渡要請履歴` の 13〜14 列目（M-N列 `requesterLineUserId`, `holderLineUserId`）をクリア。
  4. 現場書き込みを再開。

##### Level 2: 事前スナップショット復元 (Snapshot Restore — 緊急時)
- **概要**: マイグレーション直前に複製退避したバックアップスプレッドシート（`BACKUP_${ssName}_${timestamp}`）をアクティブ DB として再バインドする。
- **適用条件**: スプレッドシートの構造や既存データが不可逆的に破損した場合。
- **厳格な禁止事項**:
  - **Google Spreadsheet の「版の履歴」からの全体一括復元は永久禁止**とする（障害発生後に現場で登録された正当な配布実績まで不可逆的に消失するため）。

---

## 6. リストア検証と定期訓練 (Restore Drill)

バックアップが確実に機能することを担保するため、以下の訓練・検証を定期実施する。

1. **リストア訓練頻度**:
   - 運用体制およびSLA方針の確定に伴い決定（**TBD / Decision Required**。定期実施を前提とする）。
2. **訓練内容**:
   - バックアップスプレッドシートからテスト用地区（`TEST-DISTRICT`）を復旧し、H App および Dashboard からの疎通確認を完了させる。
3. **エビデンス記録**:
   - 訓練実施日、所要時間（実測RTO）、復旧データ件数、成否判定を記録・保管する。

---

## 7. 責任体制とエスカレーション (Escalation Path)

| ロール | 担当者 / 組織 | 責務 |
|:---|:---|:---|
| **Primary Owner** | システム運用責任者 (Site Reliability Engineer) | 日次バックアップ監視、障害検知、一次リストア作業の執行 |
| **Secondary Owner** | バックエンド開発リード | 整合性検証、1地区専用GAS設定（`TARGET_SPREADSHEET_ID` 等）の安全な更新、トラブルシューティング |
| **Escalation Point** | プロジェクト最高責任者 (MASTER) | サービス停止判断、長期データ欠損時の意思決定、関係先への障害報告 |

- **エスカレーション基準**:
  - 障害検知から30分以内に原因特定または復旧手順に着手できない場合、直ちに MASTER へエスカレーションする。
