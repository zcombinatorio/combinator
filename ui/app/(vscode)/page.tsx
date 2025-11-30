'use client';
/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useTheme } from '@/contexts/ThemeContext';

export default function LandingPage() {
  const { theme } = useTheme();
  const headingColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
  const textColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';

  return (
    <div className="max-w-5xl p-[20px]">
      <p className="font-semibold text-[20px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>
        Z Combinator has rebranded to <a href="https://zcombinator.io" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">Combinator</a> after merging with Percent Markets.
      </p>
      <h2 className="mt-7 font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>What is ZC?</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>A launchpad that helps founders hit PMF</p>
      <h2 className="mt-[26px] font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>Thesis</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>The highest signal product feedback is a ready-to-merge PR made and selected by your users.</p>
      <h2 className="mt-[26px] font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>What problems are ZC solving for you as a founder?</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>&gt; I don&apos;t know what the right thing to build is b/c</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>&gt; I&apos;m getting no feedback (at worst) and bad feedback (at best) b/c</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>&gt; I&apos;m poorly incentivizing my users to give me good feedback b/c</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>&gt; I don&apos;t know how valueable each piece of feedback is</p>
      <h2 className="mt-7 font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>How does ZC solve these problems?</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>From Zero to PMF with ZC:</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>1. Come up with an idea and build the MVP.</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>2. Open source your code and <a href="https://www.zcombinator.io/launch" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">launch a ZC token</a> for it.</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>3. ZC spins up a <a href="https://percent.markets" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Percent</a> <a href="https://www.paradigm.xyz/2025/06/quantum-markets" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">Quantum Market</a> (QM) for selecting the best user-submitted PR to merge.</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>4. Invite your users to submit PRs and trade the QM.</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>5. When the QM ends, the best performing PR gets merged and tokens get minted to pay the user who made the PR an amount proportional to how much the PR increased your token price.</p>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>6. Rerun steps 3-5 (ZC does this) while you build until you hit PMF.</p>
      <h2 className="mt-7 font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>Want to help build ZC?</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>Submit PRs to the <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">ZC codebase</a> and trade the <a href="https://zc.percent.markets/" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">ZC QMs</a> to shape the future of the protocol.</p>
      <h2 className="mt-7 font-medium text-[20px] leading-[1.34] tracking-[-0.2px]" style={{ fontFamily: 'Inter, sans-serif', color: headingColor }}>Have questions?</h2>
      <p className="font-normal text-[14px] leading-[1.4] max-w-[680px] mt-[10px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>Join <a href="https://discord.gg/MQfcX9QM2r" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">our discord</a> and ask them!</p>
    </div>
  );
}