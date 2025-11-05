'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '../ThemeToggle';
import { useWallet } from '../WalletProvider';
import { usePrivy } from '@privy-io/react-auth';
import { useState } from 'react';

const NAV_LINKS = [
  { name: 'Home', href: '/' },
  { name: 'Projects', href: '/projects' },
  { name: 'Swap', href: '/swap' },
  { name: 'Stake', href: '/stake' },
  { name: 'FAQ', href: '/faq' },
];

export function TopNav() {
  const pathname = usePathname();
  const { isPrivyAuthenticated } = useWallet();
  const { login } = usePrivy();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (href: string) => pathname === href;

  return (
    <nav className="sticky top-0 z-50 border-b transition-all duration-300" style={{
      backgroundColor: 'var(--background)',
      borderColor: 'var(--border)'
    }}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <Image
              src="/logos/z-logo-white.png"
              alt="Z"
              width={32}
              height={32}
              className="theme-logo"
            />
            <span className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
              Combinator
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium transition-colors hover:text-accent relative group"
                style={{
                  color: isActive(link.href) ? 'var(--accent)' : 'var(--foreground-secondary)'
                }}
              >
                {link.name}
                {isActive(link.href) && (
                  <span className="absolute -bottom-[21px] left-0 right-0 h-0.5 bg-accent" style={{ backgroundColor: 'var(--accent)' }} />
                )}
              </Link>
            ))}
          </div>

          {/* Right side actions */}
          <div className="flex items-center gap-4">
            <ThemeToggle />

            <Link
              href="/launch"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90 border"
              style={{
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              }}
            >
              Launch Token
            </Link>

            {isPrivyAuthenticated ? (
              <Link
                href="/portfolio"
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90 btn-primary"
                style={{
                  backgroundColor: 'var(--accent)'
                }}
              >
                Portfolio
              </Link>
            ) : (
              <button
                onClick={login}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all hover:opacity-90 btn-primary"
                style={{
                  backgroundColor: 'var(--accent)'
                }}
              >
                Connect Wallet
              </button>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg"
              style={{ color: 'var(--foreground)' }}
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="px-4 py-4 space-y-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-base font-medium transition-colors"
                style={{
                  color: isActive(link.href) ? 'var(--accent)' : 'var(--foreground-secondary)',
                  backgroundColor: isActive(link.href) ? 'var(--background-tertiary)' : 'transparent'
                }}
              >
                {link.name}
              </Link>
            ))}
            <div className="pt-3 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
              <Link
                href="/launch"
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-lg text-base font-medium text-center border"
                style={{
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)'
                }}
              >
                Launch Token
              </Link>
              {isPrivyAuthenticated ? (
                <Link
                  href="/portfolio"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-base font-medium text-center btn-primary"
                  style={{
                    backgroundColor: 'var(--accent)'
                  }}
                >
                  Portfolio
                </Link>
              ) : (
                <button
                  onClick={() => {
                    login();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-base font-medium btn-primary"
                  style={{
                    backgroundColor: 'var(--accent)'
                  }}
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
