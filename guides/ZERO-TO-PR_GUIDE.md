# Zero to PR: Complete Beginner's Guide

A step-by-step guide to submit your first pull request to Z Combinator. No coding experience required.

## 1. Download VS Code

1. Go to https://code.visualstudio.com/download
2. Download for your operating system
3. Install and open VS Code

## 2. Set Up Claude Code

### Installation
1. Open VS Code on your computer
2. Click the Extensions icon (left sidebar, looks like building blocks)
3. Search for "Claude Code"
4. Click **Install**
5. Click **Reload** if prompted

### Authentication
1. Open Command Palette in VS Code (search bar at top center of VS Code): `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Claude Code: Sign In" and press Enter
3. Follow the browser prompts to authenticate with your Anthropic account (make an Anthropic acc if you don't have one)
4. Return to VS Code once complete

### Start Chatting with Claude Code
1. Open Command Palette: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Claude Code: Open" and press Enter
3. The Claude Code panel will open on the right side
4. You'll see a text input box at the bottom—this is where you type your prompts
5. Type a message and press Enter to start chatting
6. Leave this for now and continue to fork the ZC respository

## 3. Fork the Repository

1. Go to https://github.com/zcombinatorio/zcombinator.git (make an Github acc if you don't have one)
2. Click the **Fork** dropdown button (top right)
3. Click **Create fork**
4. On the fork creation page:
   - Keep the repository name as **zcombinator**
   - Leave the description as is (optional to edit)
   - Make sure "Copy the main branch only" is checked
5. Click **Create fork** (green button at the bottom)
6. You now have your own copy at `github.com/YOUR-USERNAME/zcombinator`

## 4. Clone Your Fork Locally

**Prompt Claude Code:**
Type into Claude from Step 2:

```
Clone my fork of the zcombinator repository from https://github.com/YOUR-USERNAME/zcombinator.git to my local machine
```

(Replace YOUR-USERNAME with your actual GitHub username)

Claude Code will handle the git commands for you.

**After cloning, open the codebase:**
1. Check the Claude Code output—it will show you the path where it cloned the repo (e.g., `/Users/yourname/zcombinator`)
2. In VS Code, go to **File > Open Folder** (or **File > Open** on Mac)
3. Navigate to that path.
   - If you can't find it, prompt Claude Code: "Where did you clone the zcombinator repo?"
4. Select the `zcombinator` folder and click **Open**
5. The codebase is now loaded in VS Code—you'll see all the files in the left sidebar

**Set up the project:**

Follow the **[Codebase Setup Guide](./CODEBASE_SETUP_GUIDE.md)** to install dependencies and start the dev server. It has copy/paste prompts for Claude Code that will get you running in under 2 minutes.

## 5. Make Your Changes

**Prompt Claude Code with what you want to build or fix:**

**Important:** Before submitting each prompt, press `Shift+Tab` to switch to planning mode. This lets Claude Code create a plan first before executing changes and improve the quality of your code.

Examples:
- "Add a dark mode toggle to the navbar"
- "Fix the typo in the README where it says 'teh' instead of 'the'"
- "Create a new component that displays user statistics"

Claude Code will:
- Find the right files
- Make the changes
- Test if needed
- Explain what it did

## 6. Create a Pull Request

**Prompt Claude Code:**

```
Create a pull request to the main zcombinator repository with my changes
```

Claude Code will:
- Commit your changes with a proper message
- Push to your fork
- Create the PR with a description
- Give you the PR link

**Verify your PR was created:**
1. Go to https://github.com/zcombinatorio/zcombinator/pulls
2. You should see your PR listed under the "Pull requests" tab
3. Click on it to view the details and any feedback from maintainers

**Verify your PR meets these standards:**
- [ ] **Documentation updated** in the same PR
- [ ] **No merge conflicts** (rebase on main before submission)
- [ ] **Tests passing** (if applicable)
- [ ] **Conventional commits** (semantic commit messages)
- [ ] **License agreement** (by submitting, you agree to [LICENSE])

**Edit your PR (optional but recommended):**
1. On your PR page, click the **three dots (...)** next to the title
2. Select **Edit** to modify the title if needed
3. Click **Edit** next to the description to add more details
4. Include (if available):
   - **Video demos** - Show your feature in action
   - **Screenshots** - Visual proof of what changed
   - **Detailed description** - Explain what your feature/code does
   - **Impact on $ZC** - How you think this will improve $ZC price
   - Any other relevant context
5. Click **Update comment** to save your changes

## 7. Start the Decision Market

Once your PR is submitted, notify the ZC and/or Percent team to spin up a decision market to merge your PR and get paid.

**Contact via Discord:**
- Join the Z Combinator Discord: https://discord.gg/MQfcX9QM2r
- Share your PR link and request a decision market
- The team will review and potentially create a market for your contribution

This step will be automated in the future.

## Common Issues

**"Permission denied" errors**: Prompt Claude Code to help set up SSH keys or use HTTPS authentication

**Merge conflicts**: Prompt Claude Code: "Help me resolve the merge conflict with the main branch"

**PR rejected**: Read the feedback, then prompt: "Update my PR based on this review: [paste feedback]"

---

That's it! You've gone from zero to submitting a pull request. Welcome to open source.
