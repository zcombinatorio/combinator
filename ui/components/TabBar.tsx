'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useWallet } from './WalletProvider';
import { useTabContext } from '@/contexts/TabContext';

const BASE_TABS = [
  { name: 'landing-page.zc', href: '/' },
  { name: 'faq.zc', href: '/faq' },
  { name: 'decisions.zc', href: '/decisions' },
  { name: 'contributions.zc', href: '/contributions' },
  { name: 'projects.zc', href: '/projects' },
  { name: 'launch.zc', href: '/launch' },
  { name: 'swap.zc', href: '/swap' },
  { name: 'stake.zc', href: '/stake' },
  { name: 'claim.zc', href: '/claim' }
];

const PORTFOLIO_TAB = { name: 'portfolio.zc', href: '/portfolio' };

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { isPrivyAuthenticated } = useWallet();
  const { dynamicTabs, closeTab } = useTabContext();

  // When authenticated: add portfolio tab and remove claim tab
  // When not authenticated: show all BASE_TABS including claim
  const tabs = isPrivyAuthenticated
    ? [...BASE_TABS.slice(0, 5), PORTFOLIO_TAB, ...BASE_TABS.slice(5, 8)] // excludes claim (index 8)
    : BASE_TABS;

  const handleStaticTabClick = (href: string) => {
    router.push(href);
  };

  const handleDynamicTabClick = (type: 'history' | 'holders' | 'burn' | 'transfer' | 'presale' | 'vesting', tokenAddress: string) => {
    // Both presale and vesting tabs navigate to the same /presale/ route
    const route = type === 'vesting' ? 'presale' : type;
    router.push(`/${route}/${tokenAddress}`);
  };

  const handleCloseTab = (e: React.MouseEvent, id: string, tab: any) => {
    e.stopPropagation();
    closeTab(id);

    // If closing the current tab, navigate to origin route
    const currentPath = `/${tab.type}/${tab.tokenAddress}`;
    if (pathname === currentPath) {
      router.push(tab.originRoute || '/portfolio');
    }
  };

  return (
    <div
      className="flex items-center overflow-x-auto [&::-webkit-scrollbar]:hidden"
      style={{
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        fontSize: '13px',
        backgroundColor: 'var(--background)',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none'
      }}
    >
      {/* Static tabs */}
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <button
            key={tab.name}
            onClick={() => handleStaticTabClick(tab.href)}
            className="px-4 py-2 whitespace-nowrap transition-colors cursor-pointer"
            style={{
              backgroundColor: isActive ? '#474748' : 'transparent',
              color: isActive ? '#E9E9E3' : '#858585',
              borderBottom: isActive ? '2px solid #FFFFFF' : 'none',
            }}
          >
            {tab.name}
          </button>
        );
      })}

      {/* Dynamic tabs */}
      {dynamicTabs.map((tab) => {
        const tabPath = `/${tab.type}/${tab.tokenAddress}`;
        const isActive = pathname === tabPath;
        const tabName = `${tab.tokenSymbol}-${tab.type}.zc`;

        return (
          <div
            key={tab.id}
            className="flex items-center px-4 py-2 whitespace-nowrap transition-colors"
            style={{
              backgroundColor: isActive ? '#474748' : 'transparent',
              color: isActive ? '#E9E9E3' : '#858585',
              borderBottom: isActive ? '2px solid #FFFFFF' : 'none',
            }}
          >
            <button
              onClick={() => handleDynamicTabClick(tab.type, tab.tokenAddress)}
              className="mr-2"
            >
              {tabName}
            </button>
            <button
              onClick={(e) => handleCloseTab(e, tab.id, tab)}
              className="transition-opacity hover:text-white"
              title="Close tab"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
