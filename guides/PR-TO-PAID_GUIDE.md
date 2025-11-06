# How to Get Paid for Contributing to Z Combinator

Get paid in $ZC tokens for your contributions through our market-based governance system.

**[MARKET GOVERNANCE AND PAYMENT STRUCTURES ARE BEING ITERATED ON - EXPECT FREQUENT CHANGES TO BOTH]**

---

## TL;DR

1. Submit a PR with clear impact description and demos
2. Decision market opens automatically
3. Community trades on your PR increasing $ZC price
4. If market resolves positively, your PR gets merged + you get paid in $ZC tokens
5. Rewards vest over time

---

## Payment Structure

### How Much You Earn

**Reward Amount: 400k $ZC flat**

Where:
- **Final TWAP Pass-Fail Gap** = Time-Weighted Average Price difference between PASS and FAIL markets
- **ZC token supply in circulation** = Total circulating supply at the start of the decision market
- **20%** = Contributor reward percentage
- **Cap**: Maximum 2 million $ZC per PR

### Vesting Schedule

Rewards vest linearly over **[Z days]** to align long-term incentives with the project.

---

## Step-by-Step: From PR to Payment

### 1. Submit Your PR

Follow [ZERO_TO_PR_GUIDE.md](ZERO_TO_PR_GUIDE.md) for complete instructions on setting up and submitting your PR.

**In your PR description, include:**
- Clear description of the change
- Demos, screenshots, whatever to make it easier for traders to audit your work
- How it increases $ZC token value

### 2. Decision Market Opens

- Powered by Percent protocol
- Opens automatically when your PR is submitted (right now, it is manually opened by the Percent team)
- Two markets: PASS (merge) vs FAIL (reject) are spun up
- https://zc.percent.markets to view and trade the PR decision market
- Community members can bid PASS or sell FAIL if they think the PR should get merged (and for you to get paid). Or, they can sell PASS or bid FAIL if they think the PR should not get merged.

### 3. Promote Your PR

**Why this matters:** Illiquid markets make worse decisions. More trading = better price discovery = fairer outcome.

**How to promote:**
- Share in Discord
- Explain your reasoning on the PR
- Engage with questions and concerns
- Build credibility through clear communication

**Pro tip:** The wider the gap between PASS and FAIL markets, the more you get paid!

### 4. Market Resolves

**Resolution criteria:**
- Markets are run for **[24 hours]** currently
- If TWAP of PASS market exceeds TWAP of FAIL market by the threshold, PR passes and you get paid
- If PASS doesn't exceed threshold, PR fails and you do not get paid
- The threshold is currently set to 0%. If the TWAP of PASS market exceeds the TWAP of FAIL market by any margin, then the PR will get merged.

**TWAP = Time-Weighted Average Price** (prevents last-minute manipulation)

### 5. Get Paid

**If your PR passes:**
- PR automatically merges
- $ZC tokens are minted to your wallet
- Rewards begin vesting immediately
- Claim your vested tokens over **[Z days]**

**If your PR fails:**
- You can improve and resubmit
- Learn from market feedback
- Try a different approach

---

### PR Strategies

Both of these approaches can be highly effective:

**One Big Feature PR**
- Submit a single substantial feature that creates significant value
- High risk, high reward
- Example: "Add mobile-responsive design to entire platform"

**Cumulative Small Fixes PR**
- Bundle many small bug fixes or improvements into one PR
- Lower risk, can still create big value through compounding improvements
- Example: "Fix 15 mobile UI bugs that together improve user experience by 30%"

The key is demonstrating clear cumulative value creation, regardless of approach.

---

## Types of Contributions & Expected Rewards

### Feature Additions
**Reward potential:** =%=%=% Highest
**Market scrutiny:** Very high
**Best for:** Experienced contributors with proven track record

### Infrastructure
**Reward potential:** =%=% Medium-High
**Market scrutiny:** High
**Best for:** Bundle with features that showcase the improvement

### Bug Fixes
**Reward potential:** =%=% Medium
**Market scrutiny:** Low (fast-track for critical issues)
**Best for:** New contributors building credibility

### Documentation
**Reward potential:** =% Lower
**Market scrutiny:** Very low
**Best for:** Non-technical contributors, first-time OSS contributors

### Refactoring
**Reward potential:** =% Lower (unless high impact)
**Market scrutiny:** Very high
**Best for:** Experienced contributors who can demonstrate clear value

---

## Clear PR Descriptions Maximize Your Earnings

**Clear impact stories**
- "This reduces latency 40%, enabling real-time features"
- "This adds mobile support, expanding our user base by 30%"

**Data-backed claims**
- Benchmarks and performance numbers
- User demand signals (GitHub issues, Discord requests)
- Competitive analysis

**Minimal risk**
- Well-tested code
- Backwards compatible

**Strong communication**
- Clear PR descriptions
- Responsive to questions
- Professional engagement

---

## Market Mechanics: What You Need to Know

### Self-Trading is Encouraged

Unlike traditional markets, we **highly encourage**:
- Trading on your own PRs
- Promoting your work to create liquidity
- "Manipulating" markets in your favor

### Resolution Process

**If you disagree with the outcome:**
1. Re-open the PR with improvements
2. Address market concerns in your new submission
3. Provide additional data/evidence
4. Markets get a second chance to evaluate

**Maintainer override:**
- Only for security issues, legal concerns, or critical bugs
- Otherwise, markets are final

---

## FAQ

### How do I know if my PR is worth it?

Check these signals:
- Is there a GitHub issue requesting this feature?
- Did community members discuss this in Discord?
- Would you personally use this feature?
- Does it clearly increase token value?

### What if nobody trades on my PR?

Illiquid markets = bad decisions. You need to promote your work:
- Share in Discord
- Explain the impact clearly
- Tag relevant community members
- Create excitement around your contribution

### Can I contribute anonymously?

Yes, but markets may discount anonymous contributors. Reputation matters for earning trust and getting better market prices.

### What if I spend weeks on a PR and it gets rejected?

This is the risk of market-based governance. To minimize this risk:
- Discuss your idea in Discord first
- Start with smaller PRs to test the waters
- Create an RFC (Request for Comments) issue for large changes
- Get early signal from the community

### How long until I get paid?

- Market resolution: **[X hours]** after PR submission
- Vesting period: **[Z days]** linear unlock
- You can claim partial rewards as they vest

### Can I speed up the process?

For critical bug fixes, there's a fast-track process with smaller markets but quicker resolution. Ask about it in the here: https://discord.gg/MQfcX9QM2r.

---

## Disclaimer

**This is experimental.**

By contributing, you acknowledge:
- This is an experimental governance model
- Payment structures are subject to change (never in the middle of a decision market, though)
- You may invest significant effort into PRs that don't merge
- Markets may reject excellent code if impact isn't clear
- Your work is judged by traders, not just maintainers
- You're building in public view
- Reputation and communication matter as much as code quality

**Trade accordingly.**

But remember: if you create genuine value, the market will reward you. Focus on clear impact, strong communication, and building credibility over time.

---

**Ready to get paid for your open source contributions?**

1. Read [ZERO_TO_PR_GUIDE.md](ZERO_TO_PR_GUIDE.md) for setup
2. Join [Discord](discord.gg/MQfcX9QM2r) to discuss your idea
3. Submit your first PR
4. Get paid in $ZC tokens

Welcome to the future of open source compensation.
