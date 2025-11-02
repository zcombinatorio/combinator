'use client';

import { TabBar } from './TabBar';

export function Header() {
  return (
    <header
      className="sticky top-0 z-10"
      style={{
        backgroundColor: '#181818',
        borderBottom: '1px solid #2B2B2B'
      }}
    >
      <TabBar />
    </header>
  );
}
