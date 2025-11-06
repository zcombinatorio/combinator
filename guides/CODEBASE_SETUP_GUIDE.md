# Codebase Setup Guide

Get the Z Combinator UI running locally in under 2 minutes. No database or API keys required.

## Setup with Claude Code

Copy and paste these prompts into Claude Code in order:

### 1. Basic Setup (Required)

```
Set up the Z Combinator development environment. Navigate to the ui directory, install dependencies with pnpm, and give me the command to start the dev server. Tell me exactly how to navigate to the ui directory and what command i should type in. The app should run in mock mode without requiring any API keys or database setup.
```

**That's it!** Open http://localhost:3000 when Claude says it's ready. You'll see a yellow "🔧 Demo Mode" banner—this means mock data is active.

### 2. Add Wallet Auth (Optional but Recommended)

If you want wallet connection to work:

```
Create a .env.local file in the ui/ directory with this line: NEXT_PUBLIC_PRIVY_APP_ID=cmfx0xezu003ik30bi91hhwbk
```

Then restart your dev server.

### 3. Add Real Services (Optional)

If you want real blockchain data, market data, or database:

```
Add these optional services to my .env.local file in the ui/ directory and tell me where to get API keys:
- Helius (blockchain data)
- Birdeye (market data)
- Pinata (IPFS storage)
- PostgreSQL database

Explain what each service does and include signup links.
```

---

## How It Works

### Mock Mode

The app automatically detects when API keys/database are missing and uses mock data instead.

**What gets mocked:**
- **Database** → In-memory mock with sample tokens, holders, presales
- **Helius** → Mock transaction history and blockchain data
- **Birdeye** → Mock prices, market cap, liquidity
- **Pinata** → Mock IPFS metadata storage
- **Privy** → Mock wallet connections (unless you add the app ID above)

**What you can do in mock mode:**
- Browse sample tokens with market data
- View transaction history
- See holder lists and stats
- Test presale functionality
- Navigate all pages and features
- Build UI components without backend setup

### Adding Real Services

We provide the Privy app ID for free. For other services, you need to sign up yourself:

| Service | What it does | Signup Link | Env Variable |
|---------|--------------|-------------|--------------|
| **Privy** | Wallet authentication | ✅ Provided | `NEXT_PUBLIC_PRIVY_APP_ID=cmfx0xezu003ik30bi91hhwbk` |
| **Helius** | Blockchain data (transactions, balances) | https://www.helius.dev/ | `HELIUS_API_KEY=your_key` |
| **Birdeye** | Market data (price, market cap, liquidity) | https://birdeye.so/ | `BIRDEYE_API_KEY=your_key` |
| **Pinata** | IPFS storage for token metadata | https://www.pinata.cloud/ | `PINATA_JWT=your_jwt` |
| **PostgreSQL** | Database for storing tokens/holders/presales | Self-hosted or provider | `DB_URL=postgresql://...` |

**You can mix and match!** For example:
- Just Privy → Wallet auth works, everything else mocked
- Privy + Birdeye → Wallet + real market data, everything else mocked
- Everything → Full production setup

The app adapts automatically. No code changes needed.

---

## Manual Setup (without Claude Code)

If you prefer to set up manually:

**Prerequisites:**
- Node.js 18+
- pnpm (`npm install -g pnpm`)

**Commands:**
```bash
cd ui
pnpm install
pnpm run dev
```

Open http://localhost:3000

**To add environment variables:**
1. Create `ui/.env.local` file
2. Add your keys (see table above)
3. Restart the dev server

---

## Project Structure

```
zcombinator/
├── ui/                    # Main Next.js application
│   ├── app/              # Next.js 15 app router pages
│   ├── components/       # React components
│   ├── lib/              # Utilities and services
│   │   ├── mock/        # Mock implementations
│   │   └── db.ts        # Database functions
│   ├── .env.local       # Your local environment vars (create this)
│   └── package.json     # UI dependencies
└── guides/              # Documentation (you are here)
```

---

## Troubleshooting

**`pnpm: command not found`**
```bash
npm install -g pnpm
```

**Port 3000 already in use**
```bash
PORT=3001 pnpm run dev
```

**Mock Mode banner won't disappear after adding env vars**
- Verify `.env.local` is in the `ui/` directory (not root)
- Restart the dev server (`Ctrl+C` then `pnpm run dev`)
- Check that env values aren't empty strings

**Changes not showing up**
- Hard refresh: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows/Linux)

**Need to reset mock data**
- Mock data regenerates on each restart: `pnpm run dev`

---

## Next Steps

- **[Zero to PR Guide](./ZERO-TO-PR_GUIDE.md)** - Submit your first pull request
- **[ZC Prompting Guide](./ZC_PROMPTING_GUIDE.md)** - How to work effectively with Claude Code
- **[PR to Paid Guide](./PR-TO-PAID_GUIDE.md)** - Understand how payments work

**Need help?** Join the Discord: https://discord.gg/MQfcX9QM2r
