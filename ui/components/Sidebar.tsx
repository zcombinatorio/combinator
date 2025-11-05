'use client';

import { ActivityBar } from './ActivityBar';
import { FileExplorer } from './FileExplorer';

export function Sidebar() {
  return (
    <aside
      className="fixed left-0 top-0 h-screen overflow-hidden flex w-[40px] md:w-[300px]"
      style={{
        borderRight: '1px solid var(--border)'
      }}
    >
      <ActivityBar />
      <FileExplorer className="hidden md:block" />
    </aside>
  );
}
