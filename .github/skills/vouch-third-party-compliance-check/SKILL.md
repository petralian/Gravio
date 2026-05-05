---
name: vouch-third-party-compliance-check
description: Enforce current-platform docs and policy checks before implementing Instagram, TikTok, Shopify API, or extension-surface changes.
---

# Vouch Third-Party Compliance Check

Use this skill before coding any change that touches Shopify, Meta/Instagram, or TikTok integrations.

## Trigger Conditions
- New third-party API endpoint usage
- New OAuth scope, webhook behavior, extension target, or UI component API
- User reports repeated failures or frustration in integration behavior

## Workflow
1. Fetch current docs first (no coding yet):
- Shopify dev docs for the exact surface
- Shopify changelog if behavior might have changed
- Meta/Instagram or TikTok developer docs as relevant

2. Validate against Vouch compliance rules:
- merchant-owned content only
- no media re-hosting
- no download affordance for IG/TikTok content
- required attribution and permalink behavior
- plan-gated extension target constraints

3. Capture implementation implications:
- required env vars
- required schema/TOML declarations
- storefront/admin behavior constraints

4. Return a coding-ready compliance brief:
- allowed approach
- forbidden approach
- required tests/verification checks

## Output Template
- Docs reviewed:
- Compliant implementation path:
- Forbidden patterns to avoid:
- Verification checklist:
