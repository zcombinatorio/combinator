'use client';

import { TopNav } from '@/components/ui/TopNav';
import { SiteFooter } from '@/components/ui/Footer';
import { TabProvider } from '@/contexts/TabContext';

export default function ModernLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TabProvider>
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
        <TopNav />
        <main className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </TabProvider>
  );
}