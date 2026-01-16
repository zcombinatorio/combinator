'use client';
/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2026 Spice Finance Inc.
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

import { usePathname } from 'next/navigation';
import { useWallet } from './WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { useTheme } from '@/contexts/ThemeContext';
import Image from 'next/image';

function ConnectWalletButton() {
  const { connecting, externalWallet } = useWallet();
  const { login, authenticated, linkWallet, ready } = usePrivy();
  const { theme } = useTheme();

  const handleClick = async () => {
    try {
      if (!authenticated) {
        await login();
      } else {
        await linkWallet();
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
    }
  };

  const buttonColor = theme === 'dark' ? '#5A5798' : '#403d6d';

  if (!ready) {
    return (
      <div className="rounded-[8px] px-4 py-3 text-white font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize opacity-50" style={{ fontFamily: 'Inter, sans-serif', backgroundColor: buttonColor }}>
        Loading...
      </div>
    );
  }

  if (externalWallet) {
    return (
      <div className="text-[14px]" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
        {externalWallet.toString().slice(0, 6)}...{externalWallet.toString().slice(-6)}
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      disabled={connecting}
      className="rounded-[8px] px-4 py-3 text-white font-semibold text-[16px] leading-[16px] tracking-[0.32px] capitalize disabled:opacity-50 cursor-pointer hover:opacity-90 transition-opacity"
      style={{ fontFamily: 'Inter, sans-serif', backgroundColor: buttonColor }}
    >
      {connecting ? 'Connecting...' : 'Connect a wallet'}
    </button>
  );
}

function PageTitle() {
  const pathname = usePathname();
  const { theme } = useTheme();
  
  // Landing page - show "Combinator" with logo
  if (pathname === '/') {
    const logoColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
    return (
      <h1 className="text-7xl font-bold flex items-center gap-4" style={{ fontFamily: 'Inter, sans-serif', color: logoColor }}>
        <Image
          src="/logos/z-logo-white.png"
          alt="Z"
          width={56}
          height={56}
          className="mr-2"
          style={{
            filter: theme === 'dark' ? 'none' : 'brightness(0)',
          }}
        />
        <span>Combinator</span>
      </h1>
    );
  }
  
  // Check if it's a project detail page
  const isProjectDetailPage = pathname?.startsWith('/projects/') && pathname !== '/projects';
  
  const titles: Record<string, string> = {
    '/faq': 'FAQ',
    '/launch': 'Launch a token',
    '/swap': 'Swap',
    '/stake': 'Stake',
    '/claim': 'Claim',
    '/portfolio': 'Portfolio',
    '/projects': 'Projects',
    '/decisions': 'Zcombinator decision markets',
    '/contributions': 'Contributions',
  };

  const subtitles: Record<string, string> = {
    '/faq': 'Frequently asked questions about ZC protocol',
    '/swap': 'Swap ZC tokens',
    '/launch': 'Launch a ZC token for your project here',
    '/projects': 'See ZC launched projects here',
    '/decisions': 'Explore Zcombinator\'s projects proposals and decision markets based on them.',
    '/stake': 'Stake to earn yield and get rewarded more for your contributions',
    '/portfolio': 'See ZC launched projects here',
  };

  let title = titles[pathname] || '';
  let subtitle = subtitles[pathname] || '';

  // Override for project detail page
  if (isProjectDetailPage) {
    title = 'Project page';
    subtitle = 'See ZC launched projects here';
  }

  if (!title) return null;

  const titleColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
  const subtitleColor = theme === 'dark' ? '#B8B8B8' : '#717182';

  return (
    <div className="flex flex-col">
      <h1 className="font-medium text-[24px] leading-[1.2] tracking-[-0.24px]" style={{ fontFamily: 'Inter, sans-serif', color: titleColor }}>
        {title}
      </h1>
      {subtitle && (
        <p className="font-normal text-[14px] leading-[1.2]" style={{ fontFamily: 'Inter, sans-serif', color: subtitleColor }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

export function Header() {
  const { theme } = useTheme();

  const headerBg = theme === 'dark' ? '#292929' : '#ffffff';

  return (
    <header
      className="sticky top-0 z-10"
      style={{
        backgroundColor: headerBg,
        borderBottom: 'none',
      }}
    >
      <div className="flex items-center justify-between px-[40px] py-5">
        <PageTitle />
        <ConnectWalletButton />
      </div>
    </header>
  );
}