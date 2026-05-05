---
name: vouch-migration-safety
description: Safe workflow for Prisma schema and migration changes, with additive vs destructive classification and deploy readiness checks.
---

# Vouch Migration Safety

Use this skill before and after any change to prisma/schema.prisma or prisma/migrations.

## Trigger Conditions
- schema.prisma edited
- new migration created or modified
- migration-related deployment requested

## Workflow
1. Classify migration:
- Additive: add table/column/index with safe defaults
- Destructive: drop/rename/reshape data or constraints

2. Drift-control workflow:
- run prisma migrate diff before prisma migrate dev
- inspect generated SQL for unintended index/constraint churn
- if SQL contains unrelated churn, regenerate or write migration manually

3. Backup policy:
- destructive production migration requires DB backup prior to deploy
- additive-only migrations may use documented Windows exception from instructions

4. Release readiness checks:
- identify deploy target (server only unless extension files also changed)
- ensure lock workflow is ready (pre-deploy-check then release-deploy-lock)

5. Report:
- classification
- SQL risk notes
- exact deploy preconditions

## Output Template
- Migration type:
- SQL review outcome:
- Backup requirement:
- Deploy gate status:
- Safe to proceed: Yes/No
