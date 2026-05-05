---
name: vouch-extension-safety-guard
description: Preflight and postflight checks for Shopify theme/customer-account extension changes to prevent recurring Vouch regressions.
---

# Vouch Extension Safety Guard

Use this skill whenever editing files under extensions/vouch-theme or extensions/vouch-customer-account.

## Trigger Conditions
- Any change to Liquid schema or app block settings.
- Any Polaris Web Components markup or props change.
- Any feed-source rendering change (IG, TikTok, customer fan posts, future sources).

## Preflight Checklist
1. Liquid schema limits:
- max 6 header settings per app block
- range step count <= 100
- ms units max < 10000

2. Polaris WC safety:
- s-select uses s-option, never option
- s-table uses WC row/cell primitives only
- no Form in s-table header rows
- customer account extension avoids known remote DOM crash patterns documented in instructions

3. Feed source uniformity contract:
- data-hashtags present on article cards
- caption split body vs hashtags
- icon placement follows ig_icon_position
- no source-specific icon CSS divergence

4. UX safety:
- destructive actions use two-step inline confirmation
- blocking prerequisites appear before trigger actions
- multi-select where batch action is expected

## Postflight Checks
1. Compare new CSS values against project design tokens in .github/copilot-instructions.md.
2. Validate no rem/em sizing in theme extension widget CSS.
3. Run targeted checks:
- extension build or relevant verification command
- smoke-check key rendered structure in modified block files

## Output Template
- Extension surfaces touched:
- Guard checks passed:
- Risks flagged:
- Required follow-ups before deploy:
