# POSTING MAP — Highest-Level Product Architecture Principle

## District-Agnostic Template Architecture

### 1. Executive Summary
POSTING MAP is **NOT** a district-specific application.

POSTING MAP MUST be implemented and maintained as a **district-agnostic application template** that can be independently deployed to any district by:

1. **Copying the entire application folder.**
2. **Replacing the district Static Master CSV.**
3. **Configuring the destination Runtime Backend / GAS connection.**

The copied application MUST operate as an independent district instance without modifying application logic.

---

### 2. Absolute Rules (最高位絶対禁止事項)

- **Application code MUST NOT depend on a specific district.**
- **Application code MUST NOT hard-code district names.**
- **Application code MUST NOT hard-code municipality names.**
- **Application code MUST NOT hard-code address counts.**
- **Application code MUST NOT hard-code district-specific address masters.**
- **Application code MUST NOT require a district-specific Backend Sheet.**
- `<DISTRICT_ID>`, `<DISTRICT>_ADDRESS_MASTER`, `858`, or any other district-specific value MUST NOT become an application-level dependency.
- District-specific information MUST come from external configuration and/or the Static Master CSV.
- The Static Master CSV is the SSOT for district geography, municipalities, towns, coordinates, and map pin population.
- Runtime Backend MUST expose only the standardized POSTING MAP operational contract (ADR-024 Dual Lifecycle active dataset sheets `<Key>`: `名簿<Key>`, `配布実績<Key>`, `保有チラシ枚数<Key>`, `受渡要請履歴<Key>`, `PinStatus<Key>`, plus `SYSTEM_INFO` and optional `掲示板` / `掲示板連絡履歴`).
- Dashboard and application logic MUST consume district data dynamically.
- Adding `if/else` branches for multiple districts into application logic is strictly prohibited.

---

### 3. Layer Separation of Concerns (責務の分離)

```
┌─────────────────────────────────────────────────────────────┐
│                 Static Master (data/*.csv)                  │
│  - Single Source of Truth (SSOT) for District Geography     │
│  - Municipalities, Towns, Coordinates (lat/lng), Total Units│
└──────────────────────────────┬──────────────────────────────┘
                               │ (Dynamic Parse)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Dashboard / Application Core                │
│  - District-Agnostic Engine                                 │
│  - Dynamic Municipality & Town Discovery                    │
│  - Dynamic Map Pin Population & Bounding Box Auto-fit       │
│  - Dynamic State Merge (Unposted / In-Progress / Completed) │
└──────────────────────────────┬──────────────────────────────┘
                               │ (Standardized GAS API)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│      Runtime Backend (ADR-024 Active Sheets <Key>)          │
│  - 名簿<Key> (Roster)                                       │
│  - 配布実績<Key> (Distribution History & Completed Pins)     │
│  - 保有チラシ枚数<Key> (Stock)                              │
│  - 受渡要請履歴<Key> (Transfer Requests)                    │
│  - PinStatus<Key> (In-Progress Pins)                        │
└─────────────────────────────────────────────────────────────┘
```

---

### 4. Replication Requirement (レプリケーション要件)

The canonical deployment model is:

```
POSTING MAP Template
       │
       │ Copy entire folder
       ▼
New District Folder (e.g. posting-map-aichi-01)
       │
       ├── Replace district CSV (data/*.csv)
       ├── Configure Runtime Backend connection (config.js / Script Properties)
       │
       ▼
Auto-Discovery & Dynamic Construction
       │
       ├── Municipalities (ordered)
       ├── Total unit count (denominator)
       ├── Town names & addresses
       ├── Pin coordinates (lat/lng)
       └── PinStatus runtime merge
       │
       ▼
Independent District Instance Launched
```

A district replication test MUST require:
- **Application code changes: 0**
- **District-specific source-code modifications: 0**
- **Existing district instance: unaffected**

---

### 5. Development Gate (開発ゲート)

Any implementation that introduces a dependency on a specific district, municipality, address master, fixed population, or district-specific Backend structure **MUST be rejected before implementation**.

This principle has higher priority than individual Phase-level implementation convenience.

The objective is not merely to make a single district work.
**The objective is to complete a reusable POSTING MAP product that can be replicated nationwide.**
