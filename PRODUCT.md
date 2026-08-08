# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are site owners who run Twikoo on Vercel and need a browser-based place to inspect and manage commenter-style user records. Secondary users are commenters or community members who need to register, sign in for a demo profile flow, and update their public display name or avatar.

## Product Purpose

This project keeps the existing Twikoo Vercel comment backend intact while adding a small visual administration surface for demo user management. Success means an administrator can open a web page, see registered users, change role/status/avatar fields, and remove demo users without touching the Vercel code.

## Positioning

The current repository is a minimal Twikoo Vercel wrapper; the new layer demonstrates how a site owner could pair that backend with a practical user-management console on the same deployment.

## Operating Context

The project deploys to Vercel as serverless functions. Twikoo comment requests continue to be handled by `twikoo-vercel`. Demo user data should use MongoDB when `MONGODB_URI` is configured and should fall back to in-memory storage for local exploration.

## Capabilities and Constraints

Confirmed capabilities for this demo are user registration, login-style credential checking, profile avatar/display-name editing, admin listing, admin editing, and admin deletion. `DEMO_ADMIN_TOKEN` is an optional environment variable for protecting admin operations; without it the demo is intentionally open for local trials. This is not a replacement for Twikoo's own moderation/admin system.

## Brand Commitments

Use the Twikoo name and keep the existing Vercel backend behavior available. Do not break the catch-all comment API provided by `twikoo-vercel`.

## Evidence on Hand

Repository files on hand are `api/index.js`, `package.json`, and `vercel.json`. No existing visual assets, design system, or front-end implementation were present before this demo.

## Product Principles

- Preserve the current Twikoo API path and deployment model.
- Make the admin flow visible and understandable within seconds.
- Keep demo security explicit instead of pretending it is production-ready.
- Store passwords as salted hashes, never plain text.
- Prefer simple serverless-compatible code over a larger framework until the concept is proven.

## Accessibility & Inclusion

The web admin should support keyboard focus, readable contrast, responsive layout, and clear status/error messages.
