---
name: release-integrity
description: リリース完全性検証規範。V1〜V4検証ゲート執行、Scope Guard照合、原子的コミット完全性保証。
---

# Release Integrity Capability Pack

## 1. 概要と適用責務
本 Pack は、コードの変更から検証、コミット、プッシュ、本番配備に至る全行程において、未検証コードやスコープ外変更の混入を機械的に阻止し、リリースの完全性を保証するための監査・検証規格である。

## 2. 正本仕様依存 (Canonical Sources)
- [verification-gates.md](../../../.agents/rules/verification-gates.md): 検証・検品規程 & HARD STOP条件 (V1〜V4)
- [workflow.md](../../../.agents/workflows/development/workflow.md): 開発・完了報告手順 (9-Stage Protocol)

## 3. 遵守すべき絶対規範
1. **多段階検証ゲートの厳格執行**:
   - **V1 (構文・単体テスト)**: `npm test` による全テストケース 100% PASS。
   - **V2 (スコープ・境界監査)**: `node scripts/check-scope.mjs` によるスコープ外変更ゼロ、Architecture Gate 適合。
   - **V3 (差分照合)**: `git diff` による事前宣言内容と実差分の完全一致。
   - **V4 (独立監査・意味的全文検品)**: Fresh isolated context で内部起動された Independent Auditor による独立検品。
     - **テスト追認禁止 (Anti-Rubber-Stamping)**: `npm test` PASS や `check-scope.mjs` PASS は必要条件に過ぎず、監査合格の代替とならない。
     - **7ステップ意味的監査プロトコル (7-Step Semantic Audit Protocol)**:
       1. 変更ファイル一覧の取得 (`git diff --name-only <BASE>..<TARGET>`)
       2. 変更対象全ファイルの全文閲覧 (`view_file` による Full-File Review)
       3. 正本規程（`SUPREME_PRODUCT_PRINCIPLES.md`, `AGENTS.md`）との照合
       4. 反証分析（「他地区展開時に破壊されないか」「非data/**ファイルに地区固有リテラルが残存していないか」）
       5. 実差分の1行単位精査（意図しない行変更、ゾンビコード、暗黙の固定値の排除）
       6. 独立検証コマンドの客観的再実行 (`git diff`, `npm test`, `check-scope.mjs`)
       7. 意味的検証証跡を含む構造化判定返却 (`[AUDITOR VERDICT]`)
2. **2段階 Scope コミット原則**:
   - Scope 更新（`current-scope.json`）とコード変更は同一コミットにしてはならない。
   - Scope Transaction（`--scope-only`）➔ Implementation Transaction の順序を厳守する。
3. **客観的エビデンス主義**:
   - 推測や自己申告による「動作確認済み」を認めない。必ず実行コマンドのログ、終了コード `0`、客観的証跡をもって検証完了とする。
