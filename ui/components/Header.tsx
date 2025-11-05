'use client';

import { TabBar } from './TabBar';

export function Header() {
  return (
    <header
      className="sticky top-0 z-10"
      style={{
        backgroundColor: 'var(--background)',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <TabBar />
    </header>
  );
}
