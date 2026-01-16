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
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { TabProvider } from '@/contexts/TabContext';
import { useTheme } from '@/contexts/ThemeContext';

function VscodeLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { theme } = useTheme();

  const isFaqPage = pathname === '/faq';
  const isSwapPage = pathname === '/swap';
  const isLaunchPage = pathname === '/launch';
  const isProjectsPage = pathname === '/projects' || pathname?.startsWith('/projects/');
  const isProposalsPage = pathname === '/decisions';
  const isStakePage = pathname === '/stake';
  const isPortfolioPage = pathname === '/portfolio';
  const isLightPage = isFaqPage || isSwapPage || isLaunchPage || isProjectsPage || isProposalsPage || isStakePage || isPortfolioPage;

  const backgroundColor = theme === 'dark' ? '#292929' : '#ffffff';

  return (
    <div 
      className="min-h-screen" 
      style={{ 
        backgroundColor,
        color: theme === 'dark' ? '#ffffff' : '#0a0a0a'
      }}
    >
      <Sidebar />

      {/* Main Content */}
      <main
        className="h-screen overflow-y-auto ml-[228px]"
        style={{
          backgroundColor
        }}
      >
        <Header />

        {/* Content Area */}
        <div className="flex">
          {/* Main Content Column */}
          <div 
            className="flex-1"
            style={{
              paddingLeft: '20px',
              paddingRight: '20px',
              paddingTop: '20px',
              paddingBottom: '20px'
            }}
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function VscodeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TabProvider>
      <VscodeLayoutContent>{children}</VscodeLayoutContent>
    </TabProvider>
  );
}