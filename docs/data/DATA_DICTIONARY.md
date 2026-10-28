# Universal POSTING MAP — データ辞書 (DATA_DICTIONARY.md)
## Gate 2: Data Architecture Specification — Official Deliverable

> 本書は、最高位設計契約（`docs/architecture/01_DESIGN_CONTRACT.md` §22, Gate 2 出口基準）および
> Gate 2 確定指示に基づき、Universal POSTING MAP の全データ項目の定義、所有権、SSOT、型、制約、
> および識別子体系を規定した公式データ辞書である。
>
> **最重要原則**:
> 1. ポスティングは完全に自由。個人担当エリア・活動場所の個人割当・ノルマは存在しない。
> 2. 「支部の活動対象地域」は組織上の管轄・管理対象地域であり、「党員のポスティング可能範囲」ではない。「所属支部」と「ポスティングした場所」は別概念であり、所属支部から活動場所を制限・限定・選択肢化してはならない。
> 3. 「相生町が山田さんの担当」を記録するのではない。「山田さんが相生町で500枚配った」という発生した配布実績（事実）を記録する。
> 4. Hアプリは現場活動（データ送信）、Backendは認証・検証・保存、Databaseは事実の保存、Dashboardは全体観測（データ受信・表示）を担う。
> 5. Hアプリの個人ランキングは管理・監督・評価のための機能ではない。自由に活動する配布員自身のモチベーション・活動意欲（メンタル面の動機付け）を高めるための可視化機能である。

---

## 1. 識別子設計体系 (ID Architecture)

システム内で扱われる各種識別子は厳格に分離されており、相互に混同・代用してはならない。

| 識別子 (ID) | 命名・形式例 | 役割・定義 | 機密性 | 外部・フロントエンド露出 |
|---|---|---|---|---|
| **LINE User ID** | `U` + 32桁hex (`U1234567890abcdef...`) | LINEプラットフォームにおける検証済み本人識別子。内部認証および本人性の唯一の根拠。 | **極秘** (内部限定) | **不可**（フロントエンドSSOTとしての保持・公開を禁止） |
| **Person ID** | `PRS-` + UUID | 自然人（党員個人）のシステム内部識別子。 | 機密 (内部) | 不可 |
| **Staff ID** | `STF-` + 5桁コード + 連番 (`STF-00001-001`) | Hアプリおよび名簿上で党員・配布員を識別するための人間向けID。 | 支部内限定 | 可（本人のみ、または管理画面） |
| **Branch ID** | `BR-` + 地域記号 (`BR-<DISTRICT_ID>`) | 党の組織単位である支部（例: 対象選挙区支部）の識別子。 | 公開 | 可 |
| **Target Region ID** | `rowId` (`1..N`) ※単一A系対応時のみ: `e_stat_code` | 活動対象となる配布エリアの地域行識別子（Layer 4 Final Master Compiler で最後に1回だけ `1..N` 採番）。 | 公開 | 可 |
| **Activity Record ID** | `evt-` + timestamp + random / UUID | 配布実績（「誰が・いつ・どこで・何枚配ったか」）のイベント一意識別子。 | 内部 | 可 |
| **Request ID** | `req_` + UUID v4 | Hアプリ等からの通信における重複防止のための冪等性キー（Idempotency Key）。 | 一時情報 | 可 |

### 識別子分離の不変原則
```text
LINE User ID ≠ Staff ID ≠ Person ID ≠ Branch ID ≠ Activity Record ID ≠ Request ID
```
- クライアントから送信された `staffId` や `staffName` などの平文テキストは、認証・認可の根拠として信頼してはならない（クライアント詐称防止）。
- `localStorage` に保存された `user_info` は「オフライン起動時の先行表示用キャッシュ」に過ぎず、真実の単一情報源（SSOT）ではない。

---

## 2. エンティティ所有権・ガバナンスメタデータ台帳

| Entity | 論理名 | Owner (所有主体) | SSOT (真実の情報源) | Write Authority (書込権限) | Read Consumers (参照者) | 機密区分 | 保管・履歴ポリシー |
|---|---|---|---|---|---|---|---|
| **DistributionRecord** (`DistributionEvent`) | 配布実績 | 配布実行者 (Person) | Spreadsheet (`配布実績<Key>`) | 認証済み本人のみ (Backend強制) | Hアプリ(自身分・集計), Dashboard | 支部内公開 | 恒久保全 (ELECTION固定 / SUBSCRIPTION月次履歴) |
| **StaffIdentity** | 配布員名簿 | 本人 / 支部管理者 | Spreadsheet (`名簿<Key>`) | 本人 (LINE連携時) / 支部管理者 | Backend, Dashboard (名簿タブ) | 個人機密 | 契約期間中保全 |
| **ActivityTargetRegion** | 支部活動対象地域マスター (※1) | 支部 (Branch) | CSV (`data/address_master.csv`) | 地区管理責任者 (Gate時) | Hアプリ (地図), Dashboard | 公開マスター | 地区運用期間中固定 |
| **Municipality** | 自治体マスター | 支部 (Branch) | CSV (`data/municipality_master.csv`)| 地区管理責任者 (Gate時) | Hアプリ (一覧), Dashboard | 公開マスター | 地区運用期間中固定 |
| **RankingSummary** | 個人ランキング | システム (System) | Backend 動的集計エンジン | Backend バッチ / 動的計算 | Hアプリ (個人順位・全体上位) | 支部内公開 | 月次集計 (随時再計算) |
| **FlyerStock** | 保有チラシ在庫 | チラシ保管者 (Staff) | Spreadsheet (`保有チラシ枚数<Key>`)| 保管者本人 (在庫増減・受渡時) | Hアプリ (在庫一覧), Dashboard | 支部内限定 | 随時更新・データセット保全 |
| **FlyerTransferRequest**| 受渡要請 | 要請者 (Staff) | Spreadsheet (`受渡要請履歴<Key>`)| 要請者本人 (発行) / 保管者 (受諾)| 当事者間, Dashboard (管理タブ)| 支部内限定 | 完了後アーカイブ |
| **PinStatus** | リアルタイム作業中状態 | 配布実行者 (Staff) | Spreadsheet (`PinStatus<Key>`) | 配布開始/終了者 (Hアプリ) | Hアプリ (ピン表示), Dashboard | 支部内公開 | 当日〜当月限定 (短期) |
| **BulletinPost** | 掲示板投稿 (🔵要検証) | 投稿者本人 (Staff) | Spreadsheet (`掲示板`) | 認証済み本人 (投稿・削除) | Hアプリ (掲示板タブ), Dashboard| 支部内公開 | 保持期限満了後削除 |
| **SystemInfo** | システム設定・契約 | 統括管理者 | Spreadsheet (`SYSTEM_INFO`) | 統括管理者のみ | Backend, Hアプリ, Dashboard | システム機密 | 恒久保全 |

※1 **重要**: 「支部の活動対象地域マスター」は、支部組織としての管轄・観測対象地域を定義する地理マスターであり、「党員のポスティング可能範囲」ではない。党員個人に対する活動場所の制限・限定・選択肢化は一切行わない。

### 【Spreadsheet DB 標準構造台帳 (1地区1DB・ADR-024 Dual Lifecycle 準拠)】
ADR-024 および本番運用規程に基づく実シート構成:
1. **システム管理シート (1シート)**:
   - `SYSTEM_INFO`: 2列 (A〜B列: 項目・内容) ＋ 14標準設定キー・値（地区コード、地区名、HアプリURL、Dashboard URL、LIFFアプリ名、LIFF ID、LIFF URL、Endpoint URL、Manager認証パスワード、状態、契約終了日、**運用モード**、**Active Dataset Key**、**契約開始日時**）＋ 16行目拡張 `GOOGLE_MAPS_API_KEY`（`A1:B16` 保護対象）。
2. **実運用データセット (5シート: ELECTION固定 または SUBSCRIPTION月次)**:
   - `配布実績<Key>`: 17列 (A〜Q列: P=`lineUserId`, Q=`requestId` 冪等性 Authority)
   - `名簿<Key>`: 4列 (A〜D列: A=`ID`, B=`名前`, C=`LINE_USER_ID`, D=`登録日時`)
   - `保有チラシ枚数<Key>`: 7列 (A〜G列: A=`ID`, B=`担当者ID`, C=`担当者名`, D=`保管場所`, E=`保有枚数`, F=`最終更新日時`, G=`lineUserId`)
   - `受渡要請履歴<Key>`: 14列 (A〜N列: 8=状態, 9=requestId, 10=LINE状態, 11=LINE HTTP, 12=LINE日時, 13=requesterLineUserId, 14=holderLineUserId)
   - `PinStatus<Key>`: 5列 (A〜E列: A=`rowId`, B=`status`, C=`lineUserId`, D=`lockId`, E=`startedAt`)
   - ※ELECTION モードでは `<Key>` は開始時に確定した固定キー（例: `2026-10`）であり、契約終了日まで同一シートを継続使用（月次リセット禁止）。
   - ※SUBSCRIPTION モードでは `<Key>` は現在年月（`YYYY-MM`）であり、毎月新しい5シートを直接生成し過去月は履歴保持。
   - ※第1世代の原本5種は ADR-024 により完全撤廃され、新規プロビジョニングでは生成されない。
3. **現場コミュニケーション・履歴シート群 (2シート: 任意)**:
   - `掲示板`: 5列 (A〜E列: A=`日時`, B=`投稿者ID`, C=`投稿者名`, D=`メッセージ`, E=`lineUserId`)
   - `掲示板連絡履歴`: 10列 (A〜J列: A=`日時`, B=`送信者ID`, B=`送信者名`, D=`相手ID`, E=`連絡方法`, F=`連絡先`, G=`requestId`, H=`LINE送信状態`, I=`LINE HTTP status`, J=`LINE送信日時`)

---

## 3. 配布実績（DistributionRecord）中心データ項目定義

POSTING MAP の中核である「誰が・いつ・どこで・何枚配ったか」を記録するデータ項目（実装クラス: `DistributionEvent` / `active/business/distribution/distribution_model.js`）。

### (1) 配布実績エンティティ (`DistributionRecord` / 実装クラス `DistributionEvent`)

| Field (物理名) | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | 生成者 | 利用者 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|---|---|
| `rowId` | 地域行識別子 | Number | 必須 | 対象町丁目の通し番号 (address_master と連動) | Hアプリ | 配布実績シート A列 | address_master | Hアプリ, Dashboard | address_master | 1以上の整数 |
| `cityName` | 市町村名 | String | 必須 | 活動対象町丁目が属する自治体名 | address_master | 配布実績シート B列 | address_master | Hアプリ, Dashboard | address_master | 例: `〇〇市` |
| `townName` | 町域名 | String | 必須 | 活動対象町丁目の正式名称 | address_master | 配布実績シート C列 | address_master | Hアプリ, Dashboard | address_master | 例: `相生町` |
| `completedAt` | 配布完了日時 | String | 必須 | 現場で配布完了が記録された日時 (JST) | Hアプリ (端末時) | 配布実績シート D列 | 配布員 (完了タップ) | Hアプリ, Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `count` | 配布枚数 | Number | 必須 | 実際に配布されたチラシの枚数 | Hアプリ (テンキー)| 配布実績シート E列 | 配布員 (入力) | Hアプリ, Dashboard | 配布実績シート | 0以上の数値。例: `500` |
| `staffId` | 担当者ID | String | 必須 | 配布を実施した党員の公式配布員ID | Backend (強制解決)| 配布実績シート F列 | Backend (`resolveStaffIdentity`)| Dashboard | 名簿<Key> | クライアント送信値を上書き強制 |
| `staffName` | 担当者名 | String | 必須 | 配布を実施した党員の表示名 | Backend (強制解決)| 配布実績シート G列 | Backend (`resolveStaffIdentity`)| Dashboard | 名簿<Key> | クライアント送信値を上書き強制 |
| `gpsStatus` | GPS記録状態 | String | 必須 | 座標記録の有効性フラグ | Hアプリ (端末GPS) | 配布実績シート H列 | `modules/device.js` | Dashboard | 配布実績シート | `OK` または `NO` |
| `photoStatus` | 写真記録状態 | String | 必須 | 完了写真アップロード状態フラグ | Hアプリ (端末カメラ)| 配布実績シート I列 | `modules/device.js` | Dashboard | 配布実績シート | `OK` または `NO` |
| `latitude` | 配布緯度 | Number | 任意 | 配布完了地点のGPS緯度 (世界測地系) | 端末GPS | 配布実績シート J列 | 端末GPS | Dashboard | 配布実績シート | `0` または欠損時は空文字 |
| `longitude` | 配布経度 | Number | 任意 | 配布完了地点のGPS経度 (世界測地系) | 端末GPS | 配布実績シート K列 | 端末GPS | Dashboard | 配布実績シート | `0` または欠損時は空文字 |
| `gpsTimestamp`| GPS取得日時 | String | 任意 | GPS測位が成功した日時 (JST) | 端末GPS | 配布実績シート L列 | 端末GPS | Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `photoFileId` | 写真ファイルID | String | 任意 | Google Drive に保存された写真のファイルID | Backend (Drive保存)| 配布実績シート M列 | Backend (`GPSService`) | Dashboard | Google Drive | Drive File ID |
| `photoUrl` | 写真閲覧URL | String | 任意 | 配布証跡写真のDriveプレビューURL | Backend | 配布実績シート N列 | Backend (`GPSService`) | Dashboard | Google Drive | `https://drive.google.com/...` |
| `photoTimestamp`| 写真撮影日時 | String | 任意 | 証跡写真が撮影・保存された日時 (JST) | Hアプリ | 配布実績シート O列 | Hアプリ | Dashboard | 配布実績シート | フォーマット: `yyyy/MM/dd HH:mm:ss` |
| `resolvedLineUserId`| 認証済みLINE ID | String | 必須 | 活動を実施した本人の検証済みLINE User ID | LINE LIFF トークン | 配布実績シート P列 | Backend (トークン検証) | 内部監査 | LINE Platform | **機密監査項目** (フロントエンド非公開) |
| `requestId` | リクエスト識別子 | String | 必須 | 1回の配布操作を一意に特定する UUID v4 (冪等性キー) | Hアプリ (端末生成) | 配布実績シート Q列 | Hアプリ (`crypto.randomUUID`) | Backend, 内部監査 | 配布実績シート Q列 | **冪等性 Durable SSOT Authority** (ADR-009) |

---

### 【重要不変原則】PinStatus と DistributionRecord の厳格な分離
- **`PinStatus` (リアルタイム作業中状態)**:
  現在誰がどのピン（町丁目）で作業中かを示す「一時的な現在状態」であり、活動員同士が視覚的に重複を避けるための緩やかな協調表示に過ぎない。最新状態により随時上書き更新（Update）される。
- **`DistributionRecord` (配布完了確定実績 / `DistributionEvent`)**:
  「誰が・いつ・どこで・何枚配ったか」という当月の完了実績を記録する「月次進捗台帳（1か月・1 rowId = 1行）」である。当月の初回完了のみ保存し、同月内の再配布は行わず翌月に新しい月次シートで新規開始する（Q列は当月受理requestIdによる二重登録防止キー）。

---

## 4. その他のエンティティ項目定義

### (2) 配布員名簿 (`StaffIdentity`) — `名簿<Key>` (`名簿YYYY-MM`)

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `id` | 配布員ID (Staff ID) | String | 必須 | 支部内で一意の人間向けスタッフID | Backend | A列 | 名簿<Key> | 例: `STF-00001-001` |
| `name` | 配布員名 | String | 必須 | 党員の登録表示名 (ニックネーム可) | Hアプリ入力 / LINE名 | B列 | 名簿<Key> | 本人が登録時に設定 |
| `lineUserId` | LINE User ID | String | 必須 | 検証済みLINE User ID | LIFF トークン | C列 | LINE Platform | **機密項目** (内部照合専用) |
| `registeredAt` | 登録日時 | String | 必須 | 初回名簿登録日時 (JST) | Backend | D列 | 名簿<Key> | `yyyy/MM/dd HH:mm:ss` |

### (3) 支部活動対象地域 (`ActivityTargetRegion`) — `data/address_master.csv`

- **4層生成アーキテクチャ（`docs/architecture/DISTRICT_DATA_ACQUISITION_RULE.md` 準拠）**:
  - **Layer 1（Official Address）**: 公式区割り・国交省位置参照情報（`data_kind=1`）・デジタル庁ABRから正式親町骨格（`city_name, parent_town_name, sort_key`）を確定する（e-Stat非依存、この段階では `rowId` を採番しない）。
  - **Layer 2（Official Statistical Atomic）**: 同一国勢調査年の e-Stat A系（小地域：親統計・保存則基準）および B系（基本単位区：住宅分布・代表点・分割原子）を取得・正規化する。
  - **Layer 3（Distribution Area Builder）**: 適正粒度判定・Rook隣接クラスタ分割・世帯加重メドイド＋PIP検証により最終配布エリアを構築する（分割時は `町名 (1)` .. `(K)` を確定）。
  - **Layer 4（Final Master Compiler）**: 全配布エリアの順序確定後に **`rowId`（`1..N`）を最後に1回だけ採番**し、8列 `address_master.csv`・`boundaries.geojson`・`municipality_master.csv`・`provenance.json` を同時出力する。

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `rowId` | 通し番号 | Number | 必須 | Layer 4 で最終配布エリア順序確定後に1回だけ `1..N` で採番される行番号 | Layer 4 Final Master Compiler | CSV 1列目 | address_master.csv | 1以上の連続整数 (`1..N`) |
| `city_name` | 自治体名 | String | 必須 | 所属する市区町村の公式名称（郡名除去・政令市区/特別区保持） | Layer 1 公式住所データ | CSV 2列目 | address_master.csv | 例: `〇〇市` |
| `town_name` | 配布エリア表示町名 | String | 必須 | POSTING MAP完成表示名（非分割時は正式親町名、Layer 3分割時は `町名 (1)` 等。正式親町名は `provenance.json` の `official_town_name` に保持） | Layer 1 公式住所 + Layer 3 分割連番 | CSV 3列目 | address_master.csv | 例: `△△町一丁目`, `□□町 (1)` |
| `latitude` | 代表緯度 | Number | 必須 | 世帯加重メドイド＋Even-Odd PIP検証済みの代表点緯度 | Layer 3 (B系基本単位区 / Pattern C公式基準点) | CSV 4列目 | address_master.csv | 小数点以下6桁固定 |
| `longitude` | 代表経度 | Number | 必須 | 世帯加重メドイド＋Even-Odd PIP検証済みの代表点経度 | Layer 3 (B系基本単位区 / Pattern C公式基準点) | CSV 5列目 | address_master.csv | 小数点以下6桁固定 |
| `households` | 世帯数 | Number | 任意 | 当該配布エリアを構成する公式単位の世帯数実数合計（1:0未対応町のみ空欄） | Layer 2/3 国勢調査統計実数合計 | CSV 6列目 | address_master.csv | ポスティング参考情報 (※ノルマではない) |
| `population` | 人口 | Number | 任意 | 当該配布エリアを構成する公式単位の人口実数合計（1:0未対応町のみ空欄） | Layer 2/3 国勢調査統計実数合計 | CSV 7列目 | address_master.csv | 参考情報 |
| `e_stat_code` | 国勢調査小地域コード | String | 任意 | 最終配布エリアが公式A系小地域1件と完全1:1対応する場合のみ格納（統合・分割・1:0時は空欄） | Layer 4 (総務省統計局 A系1:1対応時) | CSV 8列目 | address_master.csv | 構成コード全量は `provenance.json` 保持 |

### (4) 個人ランキング (`RankingSummary`) — Backend 動的集計
> **目的と位置付け**:
> Hアプリにおける個人ランキングは、管理・監督・人事評価のための機能ではない。
> 自由にポスティングする配布員が自身の活動実績を確認し、「自分もやろう」という**モチベーション・活動意欲（メンタル面の動機付け）を高めるための可視化機能**である。活動を強制するものではない。
>
> **データ関係**:
> ```text
> DistributionRecord (配布実績事実)
>         ↓
> 実際の配布枚数 (count)
>         ↓
> 単純集計 (合計計算 & 降順ソート)
>         ↓
> 個人ランキング (RankingSummary)
>         ↓
> Hアプリ: モチベーション可視化 / Dashboard: 全体観測
> ```

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `rank` | 順位 | Number | 必須 | 支部内の月間配布実績順位 (1位〜) | 配布実績集計 | メモリ / キャッシュ | 配布実績シート | 同枚数の場合は同順位 |
| `staffId` | 配布員ID | String | 必須 | 表示用スタッフID | 配布実績集計 | メモリ / キャッシュ | 名簿<Key> | 他人にはIDのみ表示 (匿名性保護) |
| `count` | 合計配布枚数 | Number | 必須 | 当月内に完了登録したチラシの合計枚数 | 配布実績集計 | メモリ / キャッシュ | 配布実績シート | 0以上の整数（純粋な配布枚数のみ） |
| `isMe` | 本人判定フラグ | Boolean | 必須 | リクエスト送信者本人であるかどうかの判定 | Backend | APIレスポンス | Backend認証 | 本人行のみハイライト表示用 |

※ **現物確認結果**: 既存Backend実装（`distribution_repository.js`）において、ランキング計算は純粋に配布実績の `count` 列のみを集計しており、専用の評価値・ポイント等は一切存在しない。Universal POSTING MAP でもこのシンプルな実績集計を完全継承する。

### (5) 保有チラシ在庫 (`FlyerStock`) — `保有チラシ枚数<Key>` (`保有チラシ枚数YYYY-MM`)

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `id` | 在庫ID | Number | 必須 | チラシ保管レコードの連番 | Backend | A列 | 保有チラシ枚数<Key> | 1以上の整数 |
| `staffId` | 保管者スタッフID | String | 必須 | チラシを保管している党員のStaff ID | Backend | B列 | 名簿<Key> | 例: `STF-00001-001` |
| `staffName` | 保管者名 | String | 必須 | チラシを保管している党員の表示名 | Backend | C列 | 名簿<Key> | 表示用 |
| `location` | 保管場所 | String | 必須 | 保管場所の自治体名 | Hアプリ選択 | D列 | 保有チラシ枚数<Key> | `storage_locations.json` と連動 |
| `count` | 保有枚数 | Number | 必須 | 現在保管しているチラシの残数 | Hアプリ入力 | E列 | 保有チラシ枚数<Key> | 配布や受渡により増減 |
| `updatedAt` | 最終更新日時 | String | 必須 | 在庫数が最後に更新された日時 (JST) | Backend | F列 | 保有チラシ枚数<Key> | `MM/dd HH:mm` |
| `lineUserId` | 保管者LINE ID | String | 必須 | 保管者の検証済みLINE User ID | Backend | G列 | LINE Platform | **機密項目** (isMe判定専用) |

### (6) 受渡要請 (`FlyerTransferRequest`) — `受渡要請履歴<Key>` (`受渡要請履歴YYYY-MM`)

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `requestTime` | 要請日時 | String | 必須 | 受渡要請が発行された日時 (JST) | Backend | A列 (1) | 受渡要請履歴<Key> | `yyyy/MM/dd HH:mm:ss` |
| `requestUserName` | 要請者名 | String | 必須 | 要請を発行した党員の表示名 | Backend | B列 (2) | 名簿<Key> | 表示用 |
| `requestUserId` | 要請者スタッフID | String | 必須 | 要請を発行した党員のStaff ID | Backend | C列 (3) | 名簿<Key> | 例: `STF-00001-001` |
| `holderName` | 保管者名 | String | 必須 | チラシを保管している対象党員の表示名 | Backend | D列 (4) | 名簿<Key> | 表示用 |
| `holderUserId` | 保管者スタッフID | String | 必須 | チラシを保管している対象党員のStaff ID | Backend | E列 (5) | 名簿<Key> | 例: `STF-00001-002` |
| `contactMethod` | 連絡方法 | String | 必須 | 希望連絡手段 (LINE, 電話等) | Hアプリ選択 | F列 (6) | 受渡要請履歴<Key> | デフォルト: `LINE` |
| `contactValue` | 連絡先 | String | 必須 | 連絡先の詳細（電話番号等） | Hアプリ入力 | G列 (7) | 受渡要請履歴<Key> | |
| `status` | 状態 | String | 必須 | 要請ステータス (`要請中` 等) | Backend | H列 (8) | 受渡要請履歴<Key> | |
| `requestId` | 冪等性キー | String | 必須 | 1回の要請を一意に特定する UUID v4 | Hアプリ (端末生成) | I列 (9) | 受渡要請履歴<Key> | 重複防止キー |
| `lineStatus` | LINE送信状態 | String | 必須 | LINE Push 通知送信状態 (`SENT`, `PROCESSING` 等) | Backend | J列 (10) | 受渡要請履歴<Key> | |
| `lineHttpStatus` | LINE HTTPステータス | String | 任意 | LINE API のレスポンスコード (`200` 等) | Backend | K列 (11) | 受渡要請履歴<Key> | |
| `lineTime` | LINE送信日時 | String | 任意 | LINE通知が送信された日時 (JST) | Backend | L列 (12) | 受渡要請履歴<Key> | `yyyy/MM/dd HH:mm:ss` |
| `requesterLineUserId` | 要請者LINE ID | String | 任意 | 要請者の検証済みLINE User ID | Backend | M列 (13) | LINE Platform | **機密項目** (内部照合専用) |
| `holderLineUserId` | 保管者LINE ID | String | 任意 | 保管者の検証済みLINE User ID | Backend | N列 (14) | LINE Platform | **機密項目** (通知送信専用) |

### (7) リアルタイム作業中状態 (`PinStatus`) — `PinStatus<Key>` (`PinStatusYYYY-MM`)

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `rowId` | 地域行識別子 | Number | 必須 | 対象町丁目の通し番号 | Hアプリ | A列 (1) | PinStatus<Key> | address_master と連動 |
| `status` | 作業状態 | String | 必須 | 現在の作業中状態 (`IN_PROGRESS` のみ保存) | Backend (`PinStatusService`) | B列 (2) | PinStatus<Key> | 完了時は行削除（完了SSOTは配布実績シート D列 `completedAt`） |
| `lineUserId` | ロック保持者LINE ID | String | 必須 | 配布開始ロックを取得した本人の検証済み LINE User ID | Backend (`reqLineUserId`) | C列 (3) | LINE Platform | **機密項目**（フロントエンドへは生値を返さず `myInProgress` 判定のみに使用） |
| `lockId` | ロック操作世代ID | String | 必須 | 1回の「配布開始」操作世代を一意に識別するロックID | Hアプリ生成 / Backend確定 | D列 (4) | PinStatus<Key> | 旧セッションの遅延 `remove` が新ロックを誤削除することを防ぐ世代キー |
| `startedAt` | 配布開始日時 | String | 必須 | 配布開始ロックを取得した日時 (ISO 8601 / JST) | Backend (`PinStatusService`) | E列 (5) | PinStatus<Key> | 監査および日次0時クリーンアップ参照用 |

- **所有権・世代管理ルール**:
  - ピンをタップして吹き出しを開いた段階では Backend 書き込みを行わない（Write 0）。「配布開始」押下時にのみ `setPinInProgress` (`pinAction: "add"`) でロックを取得する。
  - **1人1ピン原則**: 同一 `lineUserId` が別 `rowId` で新規に配布開始した場合（当該 `rowId` が未完了かつ他者ロックでないことを確認した後）、その本人が保持していた旧 `rowId` の `IN_PROGRESS` 行を自動削除して新 `rowId` へ乗り換える。
  - **Pre-Deploy Cutover Gate（既存地区の2列→5列移行手順）**: Runtime (`PinStatusService`) は5列未満のシートに対してスキーマ自動変更を行わず `SCHEMA_NOT_READY` で Fail-Closed する。本番切替時は必ず **① 旧 `PinStatus` 2列データ行 = 0件確認 ➔ ② `healSchemaHeaders` 実行 ➔ ③ `A1:E1` 5列ヘッダー確認 ➔ ④ コード切替** の順序を厳守する。

### (8) 掲示板投稿 (`BulletinPost`) — `掲示板`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `createdAt` | 投稿日時 | String | 必須 | 掲示板メッセージが投稿された日時 (JST) | Backend | A列 (1) | 掲示板 | `yyyy/MM/dd HH:mm:ss` |
| `staffId` | 投稿者スタッフID | String | 必須 | 投稿した党員のStaff ID | Backend | B列 (2) | 名簿<Key> | 例: `STF-00001-001` |
| `staffName` | 投稿者名 | String | 必須 | 投稿した党員の表示名 | Backend | C列 (3) | 名簿<Key> | 表示用 |
| `message` | メッセージ本文 | String | 必須 | 投稿内容テキスト | Hアプリ入力 | D列 (4) | 掲示板 | |
| `lineUserId` | 投稿者LINE ID | String | 必須 | 投稿者の検証済みLINE User ID | Backend | E列 (5) | LINE Platform | **機密項目** (isMe判定専用) |

### (9) 掲示板連絡履歴 (`BulletinContactLog`) — `掲示板連絡履歴`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `createdAt` | 連絡日時 | String | 必須 | 掲示板から連絡が送信された日時 (JST) | Backend | A列 (1) | 掲示板連絡履歴 | `yyyy/MM/dd HH:mm:ss` |
| `senderStaffId` | 送信者スタッフID | String | 必須 | 連絡を送信した党員のStaff ID | Backend | B列 (2) | 名簿<Key> | 例: `STF-00001-001` |
| `senderStaffName`| 送信者名 | String | 必須 | 連絡を送信した党員の表示名 | Backend | C列 (3) | 名簿<Key> | 表示用 |
| `targetStaffId` | 相手スタッフID | String | 必須 | 連絡先となる対象党員のStaff ID | Backend | D列 (4) | 名簿<Key> | 例: `STF-00001-002` |
| `contactMethod` | 連絡方法 | String | 必須 | 連絡手段 (LINE, 電話等) | Hアプリ選択 | E列 (5) | 掲示板連絡履歴 | |
| `contactValue` | 連絡先 | String | 必須 | 連絡先の詳細 | Hアプリ入力 | F列 (6) | 掲示板連絡履歴 | |
| `requestId` | 冪等性キー | String | 必須 | 重複防止キー | Hアプリ (端末生成) | G列 (7) | 掲示板連絡履歴 | UUID v4 |
| `lineStatus` | LINE送信状態 | String | 必須 | LINE Push 通知送信状態 | Backend | H列 (8) | 掲示板連絡履歴 | |
| `lineHttpStatus` | LINE HTTPステータス | String | 任意 | LINE API レスポンスコード | Backend | I列 (9) | 掲示板連絡履歴 | |
| `lineTime` | LINE送信日時 | String | 任意 | LINE通知送信日時 (JST) | Backend | J列 (10) | 掲示板連絡履歴 | `yyyy/MM/dd HH:mm:ss` |

### (10) システム情報 (`SystemInfo`) — `SYSTEM_INFO`

| Field | 論理名 | 型 | 必須/任意 | 意味・定義 | Source | 保存先 | SSOT | 備考 |
|---|---|---|---|---|---|---|---|---|
| `key` | 設定項目名 | String | 必須 | システム設定キー | システム定義 | A列 (1) | SYSTEM_INFO | A1ヘッダー: `項目` |
| `value` | 設定内容 | String | 任意 | 設定値 | システム設定 | B列 (2) | SYSTEM_INFO | B1ヘッダー: `内容` |

**標準14キー構成（＋B16拡張行 `A1:B16`）**:
1. `地区コード`: 地区の一意識別コード (例: `<DISTRICT_ID>`)
2. `地区名`: 地区の表示名 (例: `対象選挙区`)
3. `HアプリURL`: 現場用HアプリのルートURL (`B4`: MASTER直接入力)
4. `Dashboard URL`: 支部統括ダッシュボードのルートURL
5. `LIFFアプリ名`: LINE LIFF アプリケーション名
6. `LIFF ID`: LINE Developers にて発行された LIFF ID
7. `LIFF URL`: LINE LIFF の直接アクセスURL
8. `Endpoint URL`: APIエンドポイントURL
9. `Manager認証パスワード`: 支部ダッシュボード用認証PIN
10. `状態`: 地区の稼働ステータス (`ACTIVE` 等)
11. `契約終了日`: 地区契約有効期限日 (`yyyy-MM-dd`)
12. `運用モード`: `ELECTION`（期間固定）または `SUBSCRIPTION`（月次更新）
13. `Active Dataset Key`: 現在アクティブなデータセットキー（例: `2026-10`）
14. `契約開始日時`: 契約または選挙モード開始日時
- 16行目拡張 (`A16:B16`): `GOOGLE_MAPS_API_KEY`（`B16`: MASTER直接入力・生値非露出・保護対象）

### (11) 保管場所候補マスター (`data/storage_locations.json`)
- **役割**: Hアプリ「保有チラシ」における保管場所候補ドロップダウンの選択肢マスター。
- **生成規則**: 独立した手入力SSOTではなく、Canonical `data/municipality_master.csv` の `city_name` 列（公式読み仮名五十音順）を唯一の正本（SSOT）とし、`node scripts/generate-storage-locations.mjs`（RFC 4180 準拠・`"city_name"` ヘッダー解決型ジェネレータ）により Canonical 行順のまま機械抽出した文字列配列形式 `["〇〇市", "△△市", ...]` で配置する（`set(storage_locations) = set(municipality_master.city_name)` かつ `order(storage_locations) = order(municipality_master.city_name)`）。
- **制約**: 他地区からの流用・推測・静的コピー・手作業による自治体配列作成・独自順序変更は永久禁止。`active/` 内への自治体名ハードコードは禁止。

### (12) エリア実績マッピングメタデータ (`data/area_mapping.json`)
- **役割**: 旧マスターから新小地域マスターへの実績ステータス継承メタデータ。
- **生成規則**:
  - 新規立ち上げ地区（旧実績が存在しない地区）では、誤ったステータス継承・データ汚染を防止するため、**必ず空配列 `[]` に初期化**する。旧地区のマッピングを残存させることは重大事故（別地区エリアの誤爆完了扱い）となるため絶対禁止。
  - 過去バージョン等からの旧実績データを新小地域マスターへ引き継ぐ必要がある地区に限り、その地区専用の新旧対応表を新規生成して配置する。

---

## 5. 絶対禁止項目の不存在証明 (Non-Existence of Forbidden Items)

本データ辞書において、以下の概念・フィールドは**意図的に排除されており、いかなるエンティティにも存在しない**。

1. **個人担当エリア (`person → assignedArea`)**:
   - `assignedAreaId`、`assignedTown`、`targetStaffId` 等の「エリアに対して担当者を固定する項目」は存在しない。
   - 配布実績シートの `staffId` は、「その町で配った事実」を記録するものであり、「その町の担当者」を指すものではない。
2. **活動場所の個人割当モデル (`person → activityArea`)**:
   - 党員ごとに活動場所を事前割当・指示するフィールドは存在しない。
3. **支部による個人の活動場所制限・限定・選択肢化モデル (`branch → allowedActivityRegions → person`)**:
   - 「支部対象地域から選択する」「支部の活動対象地域内で活動する」「支部が活動可能地域を定義する」「党員の活動可能地域」「支部による活動場所制限」等のモデル・フィールドは一切存在しない。
   - 「支部の活動対象地域」は組織上の管理対象地域であり、「党員のポスティング可能範囲」ではない。「所属支部」と「ポスティングした場所」は完全に独立した別概念であり、所属支部から活動場所を制限・限定・選択肢化してはならない。
4. **ノルマ・目標枚数 (`person → quota`)**:
   - `targetCount`、`quota`、`requiredCount` 等の強制・ノルマ項目は存在しない。
   - `address_master.csv` の `households`（世帯数）は国勢調査の客観統計情報であり、個人への目標値ではない。
5. **出勤管理・強制参加フラグ**:
   - `attendanceStatus`、`checkInTime`、`isMandatory` 等の労務管理・強制参加項目は存在しない。
6. **ランキングの管理・評価機能化および評価値項目**:
   - ランキングを管理・監督・評価のためのツールにしてはならない。ノルマ未達管理、人事評価、指示、参加制限、ペナルティ等と連動するフィールドは一切存在しない。
   - `rankingScore`、`motivationPoint`、`performanceGrade`、`evaluationScore` 等の評価値・ポイント新設は禁止であり、モデルに存在しない。実際の配布枚数（`count`）の集計のみを扱う。
