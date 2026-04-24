# BNAB Ledger — Project Context for Claude

## Project Overview
BNAB Ledger is a personal finance dashboard built as a single-page web application.
It is a solo project (one developer). The app helps the user track their financial life
including budgets, spending, net worth, investments, and transactions.

## Current Status
**Phase: Bug fixing and enhancements.**
The core app is functional. Focus is on finding and fixing bugs, polishing existing
features, and adding enhancements — not rebuilding or restructuring.

## GitHub Repository
- **Repo:** https://github.com/blharmon24/bnab-ledger
- **Branch:** main
- Git is initialized at `C:\ClaudeAI\bnab-ledger`
- Push with: `git add index.html && git commit -m "message" && git push`

## Tech Stack
- **Frontend:** Single HTML file with embedded CSS and JavaScript (no frameworks)
- **Backend/Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (user_id references auth.users)
- **Language:** JavaScript (vanilla)

## File Structure
- Single HTML file — all HTML, CSS, and JavaScript lives in one file
- `supabase/functions/simplefin-proxy/index.ts` — Deno edge function for SimpleFin API proxy
- No separate JS modules, build tools, or bundlers
- Do not split into multiple files unless explicitly asked

## Database Schema (Supabase / PostgreSQL)

### `accounts`
Stores user financial accounts.
- `id` (uuid), `user_id` (uuid, FK auth.users), `name`, `type`, `institution`, `currency` (default USD), `is_active`, `created_at`
- Account types: `checking`, `savings`, `credit_card`, `investment`, `retirement`, `mortgage`, `loan`, `other`

### `categories`
Spending/income categories for transactions.
- `id`, `user_id`, `name`, `group_name`, `color` (default `#6366f1`), `is_income` (boolean), `created_at`

### `transactions`
Log of all financial transactions.
- `id`, `user_id`, `account_id` (FK accounts), `category_id` (FK categories, nullable), `date`, `payee`, `memo`, `amount`, `type`, `cleared` (default true), `import_id`, `created_at`
- Transaction types: `income`, `expense`, `transfer`
- `import_id` used for deduplication on import

### `auto_categorize_rules`
Rules for automatically categorizing transactions by keyword.
- `id`, `user_id`, `keyword`, `category_id` (FK categories), `match_type`, `sort_order`, `created_at`
- Match types: `contains`, `startswith`, `exact`
- Index on `user_id` for performance

### `net_worth_snapshots`
Point-in-time balance snapshots per account for net worth tracking.
- `id`, `user_id`, `account_id` (FK accounts), `snapshot_date`, `balance`, `created_at`
- Unique constraint on `(snapshot_date, account_id)`

### `portfolio_holdings`
Investment portfolio holdings per account.
- `id`, `user_id`, `account_id` (FK accounts), `ticker`, `name`, `shares`, `cost_basis`, `current_price`, `as_of_date`, `price_updated_at`, `price_open`, `created_at`

### `user_settings`
Key-value store for per-user app settings.
- `id`, `user_id`, `key`, `value`, `updated_at`
- Unique constraint on `(user_id, key)`

## Key Features
- Budget tracking and reporting
- Net worth tracking over time
- Spending reports by category
- Transaction log with manual entry
- Transaction import (CSV/QFX) with deduplication via `import_id`
- Auto-categorization of transactions via keyword rules
- Investment/portfolio tracking with price data
- Account balance management
- **SimpleFin bank sync** — pulls transactions directly from financial institutions

## SimpleFin Integration
Live bank/credit union transaction sync via SimpleFin Bridge (bridge.simplefin.org).

### Architecture
- **Edge Function:** `supabase/functions/simplefin-proxy/index.ts` — Deno function deployed with `--no-verify-jwt`. Two actions: `claim` (exchange setup token for access URL) and `fetch` (pull accounts + transactions).
- **Deployed with:** `npx supabase functions deploy simplefin-proxy --no-verify-jwt`
- **Called from browser** with no Authorization header (JWT verification disabled).

### User Settings Keys
- `simplefin_access_url` — permanent access URL (stored after claiming setup token)
- `simplefin_account_map` — JSON object mapping SimpleFin account ID → BNAB account ID
- `simplefin_hidden_accounts` — JSON array of SimpleFin account IDs to hide from map UI
- `simplefin_autosync` — boolean; if true, auto-syncs when Bank Imports page opens
- `simplefin_last_synced` — ISO timestamp of last successful sync

### Key Functions
- `simpleFinInit()` — called when Bank Imports page opens; shows cards, restores toggle, auto-syncs if enabled
- `simpleFinClaim()` — exchanges one-time setup token for access URL via edge function
- `simpleFinLoadAccounts(showHidden)` — fetches SimpleFin accounts (cached in `_sfAccountsCache`), renders mapping UI
- `simpleFinToggleHide(sfId, hide)` — hides/unhides a SimpleFin account; uses in-memory `_sfHiddenIds` Set to avoid race conditions
- `simpleFinSaveMapping()` — saves account mapping to `user_settings`
- `simpleFinSync()` — fetches transactions per mapped account, deduplicates client-side, batch inserts, saves last-synced timestamp

### Deduplication
SimpleFin transactions use `import_id = sf_${tx.id}`. Before inserting, existing `import_id`s are fetched per account and filtered client-side. Batch insert via `sb.post`.

### Sync Defaults
- Since-date defaults to the **first of the current month** (advances automatically each month)

## Utility Functions (added — use these)
- **`escHtml(str)`** — HTML-escapes user data before inserting into innerHTML. Use on any user-supplied string (payee, memo, tags, category names) rendered via template literals.
- **`getChartTheme()`** — returns `{ textColor, mutedColor, gridColor }` that adapt to dark/light mode. Use instead of hardcoded `#e8e8f0` / `#6b6b85` / `rgba(42,42,58,0.5)` in all Chart.js configs.
- **`getChartDefaults()`** — returns a base Chart.js options object with theme-aware colors. Spread it into chart options: `{ ...getChartDefaults(), ... }`.

## Known Architecture Constraints
- **`#sidebar-overlay` must stay inside `#app`** — `#app` has `position:relative; z-index:1` which creates its own stacking context. If the overlay is outside `#app`, it sits above the sidebar in the root stacking context regardless of z-index values, breaking mobile nav taps. Do not move it outside `#app`.
- **CSV import uses fingerprint dedup** — `import_id` for CSV rows is stored as `date|amount|payee` fingerprint (see `rowFingerprint()`). QFX uses FITID. Both are stored in the `import_id` column.
- **SimpleFin edge function uses `--no-verify-jwt`** — Supabase's ES256 session JWTs are not accepted by the Edge Function runtime. The function is deployed without JWT verification; do not add Authorization headers when calling it.
- **`saveSetting` upsert requires `on_conflict=user_id,key`** — the `user_settings` table's primary key is `id` (not provided on insert), so upserts must specify the conflict target explicitly: `sb.query('user_settings?on_conflict=user_id,key', ...)`.
- **`sb.query` handles empty responses** — returns `null` for 204, no-content-type, or zero-length responses. Do not assume `sb.query` always returns JSON.

## Transaction Review Mode
- **"Needs Review" button** on the Transactions page shows a live count badge of uncategorized transactions
- Clicking it filters to all uncategorized transactions (`needsReview(t)` = `!t.category_id`)
- Rows with `amount >= REVIEW_LARGE_AMOUNT` ($200) and no category show a yellow ⚠ flag next to the payee
- `_reviewModeActive` tracks whether review mode is on; cleared when user changes other filters

## Bugs Fixed (do not re-introduce)
- **CSS `.nav-item` orphaned selector** — fixed; all layout properties are now under `.nav-item {}`
- **Duplicate `--border` / `--border2`** — removed dead first declarations from `[data-theme="light"]`
- **`loadSetting` missing user_id filter** — query now includes `user_id=eq.${uid}&`
- **`editCategory` color swatch** — `buildColorSwatches(editColor)` now called with the current color arg
- **`deleteCategory` undo** — captures exact affected txn IDs before delete; restores category with `withUserId()`
- **`saveTransaction` edit path** — sorts `allTransactions` by date after update
- **`fetchPrice` per-row** — also patches `price_updated_at` and nulls `price_open` on refresh
- **`saveSplit`** — split transactions now posted with `withUserId()`
- **`buildBudgetTrendChart`** — now calls `isCCPaymentCategory()` to exclude CC payments, matching all other spending calculations
- **Mobile hamburger menu** — `#sidebar-overlay` moved inside `#app` to fix stacking context issue (see Architecture Constraints above)
- **`saveSetting` 409 conflict** — fixed by adding `?on_conflict=user_id,key` to the upsert URL; previously fell back to localStorage on second save of same key
- **`sb.query` empty body on non-204** — upserts return 201 with no body; fixed by checking content-type before calling `res.json()`
- **Inline category dropdown clipping** — dropdown now flips upward when near bottom of viewport
- **SimpleFin hidden accounts race condition** — `_sfHiddenIds` is an in-memory Set updated synchronously; `_sfAccountsCache` avoids re-fetching from SimpleFin on every hide/unhide click

## Important Rules
- **Do not restructure the single HTML file** into multiple files unless explicitly asked
- **Always filter by `user_id`** on every Supabase query — this is a multi-user app
- **Preserve existing Supabase table names and column names exactly** — do not rename or alter schema unless asked
- **On delete behaviors matter** — accounts cascade delete to transactions, portfolio_holdings, net_worth_snapshots; categories set null on transactions
- **Do not add new dependencies or libraries** without asking first
- **Mobile responsiveness** should be preserved in any UI changes
- When fixing bugs, make the smallest change possible — do not refactor unrelated code

## Coding Style
- Vanilla JavaScript only (no React, Vue, etc.)
- Keep all code in the single HTML file
- Use consistent Supabase client patterns already established in the file
- Prefer `async/await` over `.then()` chains

## Session Notes
_Cross-computer context. Update this section at the end of each session with what was worked on, what's in progress, and any important decisions made._

### 2026-04-23 (home PC)
- Added Session Notes section to CLAUDE.md for cross-computer context sharing
- Previous session (2026-04-22): 20+ bug fixes across security, logic, data integrity, and modal state — see Bugs Fixed section
- `scheduled-sync` edge function deployed with balance alert emails
- **Added Other Assets feature:** new account types `real_estate`, `crypto`, `precious_metals`; "Other Assets" card on Net Worth page; manual value entry for retirement/home; BTC holdings show SATS + live price via edge function (ticker `BTC-USD`); gold holdings show oz + live price (ticker `GC=F`); historical SATS chart via CoinGecko free API; `calcNetWorthAsOf` updated to use snapshots for manual-type accounts with no transactions
- **Next / in progress:** Nightly cron job for scheduled-sync still TODO; test BTC-USD and GC=F tickers with existing fetch-prices edge function
