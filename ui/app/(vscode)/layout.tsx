'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { LineNumbers } from '@/components/LineNumbers';
import { Footer } from '@/components/Footer';
import { TabProvider } from '@/contexts/TabContext';

function VscodeLayoutContent({
  children,
}: {
  children: React.ReactNode;
}) {
  const [lineCount, setLineCount] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const updateLineCount = () => {
      if (contentRef.current) {
        const contentHeight = contentRef.current.scrollHeight;
        const lineHeight = 24;
        const calculatedLines = Math.max(Math.ceil(contentHeight / lineHeight), 1);
        setLineCount(calculatedLines);
      }
    };

    // Initial update
    const frameId = requestAnimationFrame(updateLineCount);

    // Recalculate on window resize
    window.addEventListener('resize', updateLineCount);

    // Watch for DOM changes (when content loads dynamically)
    let observer: MutationObserver | null = null;
    if (contentRef.current) {
      observer = new MutationObserver(updateLineCount);
      observer.observe(contentRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    }

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', updateLineCount);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [pathname, children]);

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: '#1F1F1F' }}>
      <Sidebar />

      {/* Main Content */}
      <main
        className="h-screen overflow-y-auto ml-[40px] md:ml-[300px]"
      >
        <Header />

        {/* Content Area with Line Numbers */}
        <div className="flex">
          <LineNumbers lineCount={lineCount} />

          {/* Main Content Column */}
          <div ref={contentRef} className="flex-1 px-4 md:px-8 py-12">
            {children}
          </div>
        </div>
      </main>

      <Footer />
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