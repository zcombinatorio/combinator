# Z Combinator Prompting Guide

A practical guide to help you build features and fix bugs in the Z Combinator codebase using Claude Code.

---

## Summary

This guide provides:
- **Prompt templates** for common tasks (building features, fixing bugs, modifying components, creating scripts)
- **ZC codebase patterns** to reference in your prompts (components, pages, styling, scripts)
- **Real examples** of prompts for actual ZC features and utilities
- **Best practices** for iterative prompting and avoiding common mistakes

Use this guide to structure your Claude Code prompts effectively and get better results faster.

---

## How to Use the Templates

1. **Find the template** that matches your task (new feature, bug fix, component update, new page, new script)
2. **Copy the template** from this guide
3. **Fill in the blanks** with your specific requirements:
   - Replace `[FEATURE NAME]`, `[PAGE NAME]`, etc. with your actual values
   - Add your specific requirements in the bullet points
   - Reference existing ZC components or pages where applicable
4. **Press `Shift+Tab`** in Claude Code to enter planning mode
5. **Paste your prompt** and submit
6. **Review the plan** Claude Code creates
7. **Approve** to proceed with implementation

**Tip:** Start with the template, then look at the real examples section for inspiration on how to make your prompt more detailed.

---

## Before You Start

**Always use Planning Mode:**
- Press `Shift+Tab` before submitting any prompt
- This lets Claude Code create a plan first before executing changes
- Review the plan, then approve to proceed

---

## Prompt Templates

### 1. Building a New UI Feature

```
I want to add [FEATURE NAME] to the [PAGE NAME] page.

Requirements:
- [Specific requirement 1]
- [Specific requirement 2]
- [Specific requirement 3]

This should be similar to [EXISTING FEATURE/COMPONENT] but with [DIFFERENCES].

The feature should be located [WHERE ON THE PAGE].

Make sure it works on mobile and matches the existing ZC design.
```

**Example:**
```
I want to add a search bar to the tokens page.

Requirements:
- Filter tokens by name or ticker symbol
- Real-time filtering (no submit button)
- Clear button to reset search

This should be similar to the view toggle (Verified/All) but with a text input.

The search bar should be located at the top of the page, next to the view toggle.

Make sure it works on mobile and matches the existing ZC design.
```

---

### 2. Fixing a Bug

```
There's a bug on the [PAGE NAME] page where [DESCRIBE THE BUG].

Steps to reproduce:
1. [Step 1]
2. [Step 2]
3. [Step 3]

Expected behavior: [WHAT SHOULD HAPPEN]
Actual behavior: [WHAT ACTUALLY HAPPENS]

Please investigate and fix this issue.
```

**Example:**
```
There's a bug on the swap page where the token balance doesn't update after a successful swap.

Steps to reproduce:
1. Go to /swap
2. Connect wallet
3. Swap SOL for ZC
4. Transaction succeeds but balance still shows old amount

Expected behavior: Balance should refresh automatically after swap
Actual behavior: Balance only updates after page refresh

Please investigate and fix this issue.
```

---

### 3. Modifying an Existing Component

```
Update the [COMPONENT NAME] component to [DESCRIBE CHANGES].

Current location: [FILE PATH]

Changes needed:
- [Change 1]
- [Change 2]
- [Change 3]

Make sure to preserve existing functionality for [WHAT SHOULD STAY THE SAME].
```

**Example:**
```
Update the TokenCard component to show a "Presale" badge if the token is in presale.

Current location: /ui/components/TokenCard.tsx

Changes needed:
- Add a "PRESALE" badge in the top right corner of the card
- Badge should have a distinct color (different from "Designated" badge)
- Only show if token.presale is true

Make sure to preserve existing functionality for verified badges and token info display.
```

---

### 4. Adding a New Page

```
Create a new page and tab at /[ROUTE] for [PURPOSE].

The page should include:
- [Section 1]
- [Section 2]
- [Section 3]

Use [EXISTING PAGE] as a reference for layout and styling.
```

**Example:**
```
Create a new page and tab at /leaderboard for showing top token creators.

The page should include:
- Header with title "Top Creators"
- Table showing: Rank, Creator wallet, Total tokens launched, Total market cap
- Filter to toggle between "All Time" and "This Week"

Use /tokens as a reference for layout and styling.

The page should be accessible from the main navigation tab menu above the main content.
```

---

### 5. Creating a Script

```
Create a new TypeScript script at /ui/scripts/[SCRIPT-NAME].ts for [PURPOSE].

The script should:
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

Type: [DATABASE | BLOCKCHAIN | DATA_ANALYSIS | UTILITY]

Reference [EXISTING_SCRIPT] for similar patterns.

Requirements:
- Use dotenv for environment variables
- Add proper error handling with try-catch
- Include cleanup code (close database pools, etc.)
- Add clear logging with emoji status indicators
- Exit with appropriate status codes (0 = success, 1 = error)
- Include usage instructions in a comment at the top
```

**Example:**
```
Create a new TypeScript script at /ui/scripts/export-token-holders.ts for exporting all holders of a token to a CSV file.

The script should:
- Accept a token address as a command-line argument
- Query the database for all holders and their balances
- Format the data as CSV (columns: wallet_address, balance, percentage)
- Write the CSV to a file named [token-address]-holders.csv
- Show progress while fetching and processing data

Type: DATABASE

Reference debug-transactions.ts for command-line argument handling and backfill-verified-wallets.ts for database patterns.

Requirements:
- Use dotenv for environment variables
- Add proper error handling with try-catch
- Include cleanup code (close database pools, etc.)
- Add clear logging with emoji status indicators
- Exit with appropriate status codes (0 = success, 1 = error)
- Include usage instructions in a comment at the top

Usage example should be: npx tsx scripts/export-token-holders.ts <token_address>
```

---

## ZC Codebase Quick Reference

### File Structure

**Pages** (Next.js App Router):
- `/ui/app/[route]/page.tsx` - Main page component
- `/ui/app/layout.tsx` - Root layout with providers
- `/ui/app/api/[route]/route.ts` - API endpoints

**Components**:
- `/ui/components/` - Reusable UI components
- Common components: `Navigation.tsx`, `TokenCard.tsx`, `WalletButton.tsx`
- Modals: `TransferModal.tsx`, `BurnModal.tsx`, `PresaleBuyModal.tsx`

**Services**:
- `/ui/lib/db.ts` - Database queries
- `/ui/lib/launchService.ts` - Token launch logic
- `/ui/app/swap/services/swapService.ts` - Swap execution

**Scripts**:
- `/ui/scripts/` - Utility scripts directory
- All scripts use TypeScript and run with `npx tsx`
- Common types: Database scripts, blockchain scripts, data analysis
- Existing scripts: `burn-tokens.ts`, `debug-transactions.ts`, `fetch-signatures.ts`, `backfill-verified-wallets.ts`

**Styling**:
- Uses Tailwind CSS v4
- Responsive breakpoints: `sm:`, `md:`, `lg:`
- Common colors: `text-perc-white`, `bg-perc-black`, `text-perc-orange`

---

### Common Patterns to Reference

When prompting, mention these existing patterns:

**Navigation:**
- "Similar to how the navigation menu slides in from the right"
- "Add it to the Navigation component in /ui/components/Navigation.tsx"

**Token Cards:**
- "Use the TokenCard component to display this"
- "Similar to how tokens are shown on /tokens page"

**Modals:**
- "Create a modal similar to TransferModal"
- "Should open when user clicks the button, like the BurnModal"

**Forms:**
- "Similar to the form on /launch page"
- "Use the same input styling as the launch form"

**Authentication:**
- "Should only show if user is connected (check wallet context)"
- "Require external wallet like the launch page does"

**Data Fetching:**
- "Fetch from API route like /tokens page does"
- "Create a new API route in /ui/app/api/"

**Scripts:**
- "Similar to how burn-tokens.ts handles blockchain transactions"
- "Use the same database connection pattern as backfill-verified-wallets.ts"
- "Reference debug-transactions.ts for command-line argument handling"
- "Follow the logging style from existing scripts (emoji + formatting)"

---

## Real ZC Examples (not necessarily endorsing any of these ideas)

### Example 1: Add Filter Dropdown to Tokens Page

```
Add a sort dropdown to the tokens page (/tokens) that lets users sort by:
- Market Cap (high to low)
- Market Cap (low to high)
- Launch Time (newest first)
- Launch Time (oldest first)

Location: Next to the "Verified/All" toggle at the top of the page

The dropdown should:
- Use the same styling as the view toggle buttons
- Update the token list immediately when selection changes
- Persist selection when navigating between pages
- Default to "Market Cap (high to low)"

This is similar to the Verified/All toggle but with a dropdown instead of buttons.
```

---

### Example 2: Fix Mobile Menu Overlap Bug

```
There's a bug where the hamburger menu overlaps with the wallet button on mobile screens (below 640px).

Steps to reproduce:
1. Open ZC on mobile or resize browser to mobile width
2. Notice the hamburger icon and wallet button are too close together
3. They overlap when wallet address is long

Expected: Hamburger and wallet button should have proper spacing
Actual: They overlap and look broken

Please fix this in the Navigation component (/ui/components/Navigation.tsx) by:
- Adding more space between the elements
- Potentially stacking them vertically on very small screens
- Ensuring the menu still works properly after the fix
```

---

### Example 3: Create "Quick Actions" Section in Portfolio

```
Add a "Quick Actions" section to the portfolio page (/manage) that shows common actions at the top:
- "Launch New Token" button (links to /launch)
- "Swap Tokens" button (links to /swap)
- "View Presales" button (links to presales section on same page)

Location: Right below the wallet display, above the token list

Styling:
- Three buttons in a row on desktop
- Stack vertically on mobile
- Same button style as the "Claim" buttons
- Add icons to each button (rocket, swap arrows, clock)

This should help users quickly access common features without using the nav menu.
```

---

### Example 4: Add Loading State to Token History

```
The token history page (/history/[tokenAddress]) shows nothing while data is loading.

Add a loading state that:
- Shows skeleton loaders for the token card and transaction list
- Appears immediately when page loads
- Disappears when data finishes loading
- Uses the same styling as other loading states in the app

Similar to how the tokens page shows loading cards while fetching data.

Files to update:
- /ui/app/history/[tokenAddress]/page.tsx
```

---

### Example 5: Create Database Analysis Script

```
Create a new TypeScript script at /ui/scripts/analyze-presales.ts that generates a report on all presale activity.

The script should:
- Query the database for all presales (pending, launched, completed)
- Calculate statistics:
  - Total number of presales
  - Total ZC raised across all presales
  - Average contribution per presale
  - Top 5 presales by total raised
- Display results in a formatted table in the console
- Export data to a JSON file (presale-report.json)

Type: DATABASE

Reference:
- backfill-verified-wallets.ts for database connection and query patterns
- debug-transactions.ts for data formatting and display

Requirements:
- Use dotenv for DB_URL environment variable
- Add try-catch-finally with proper pool cleanup
- Use emoji for section headers (📊 for stats, 🏆 for top presales)
- Show progress while fetching data
- Exit with status code 0 on success, 1 on error
- Add usage comment at top: npx tsx scripts/analyze-presales.ts

Make the output easy to read with proper spacing and alignment.
```

---

## Iterative Prompting Tips

### Start Broad, Then Refine

**First prompt:**
```
Add a favorites feature to the tokens page where users can star tokens
```

**Follow-up prompts:**
```
Make the star icon larger and more visible
```
```
Add a "Favorites Only" filter toggle next to "Verified/All"
```
```
Store favorites in localStorage so they persist across sessions
```

### Request Testing

```
After implementing, test this on:
- Desktop Chrome
- Mobile Safari
- With wallet connected and disconnected
- With empty state (no favorites)
```

### Ask for Explanations

```
Explain what changes you made and why
```
```
Show me where in the code you added this functionality
```

---

## Common Mistakes to Avoid

### Bad: Too Vague
```
Make the tokens page better
```

### Good: Specific
```
Add a search bar to the tokens page that filters by name or ticker in real-time
```

---

### Bad: Missing Context
```
Add a button
```

### Good: With Context
```
Add a "Claim All" button to the portfolio page (/manage) that claims daily mints for all tokens at once. Place it above the token list, similar to the individual claim buttons.
```

---

### Bad: No Reference to Existing Code
```
Create a modal for confirming actions
```

### Good: References Existing Patterns
```
Create a confirmation modal similar to BurnModal that asks users to confirm before claiming all tokens. Should match the existing modal styling.
```

---

### Bad: Forgetting Mobile
```
Add a sidebar navigation
```

### Good: Considers Mobile
```
Add a sidebar navigation that's always visible on desktop (>1024px) but converts to a hamburger menu on mobile, similar to how our current navigation works.
```

---

## Quick Checklist

Before submitting your prompt, make sure you've:

- [ ] Pressed `Shift+Tab` to enter planning mode
- [ ] Clearly described what you want to build/fix
- [ ] Specified which page/component to modify
- [ ] Referenced similar existing features if applicable
- [ ] Mentioned mobile considerations if it's UI work
- [ ] Included any specific requirements or constraints

---

## Need Help?

If you're stuck or not getting good results:

1. **Ask Claude Code to explore first:**
   ```
   Show me how the tokens page currently works and where I should add the search feature
   ```

2. **Request a breakdown:**
   ```
   Break this feature into smaller steps and let's implement them one at a time
   ```

3. **Ask for alternatives:**
   ```
   What are different ways we could implement this feature in the ZC codebase?
   ```

---

**Remember:** The more specific and contextual your prompts, the better your results. Use planning mode, reference existing patterns, and iterate as needed!
