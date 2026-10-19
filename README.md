# POSTING MAP Product Repository

## Current Release
v1.0.1

This repository is the official standalone product repository.

The repository is completely separated from the former AIOS monorepo.

All future development starts from this release.

---

## 🏛️ Repository Architecture

This repository strictly enforces the **5 Top-Level Directory Freeze Rules (Rule-1)**:

- **`active/`**: Production code base (GAS, UI, Business Domain Services, Runtime)
- **`data/`**: SSOT Master Data (Address Master, Spatial Boundaries)
- **`docs/`**: Product Specifications, Audits, Architectural Governance
- **`scripts/`**: Development, Validation, and Deployment Automation Scripts
- **`tests/`**: Automated Unit & Integration Tests

---

## 🛡️ Governance & Rules

Refer to [AGENTS.md](AGENTS.md) for detailed repository governance rules and GAS deployment Standard Operating Procedures (SOP).
