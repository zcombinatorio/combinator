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

import { usePathname, useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { useTheme } from '@/contexts/ThemeContext';

// Icon components based on Figma design
function ProjectsIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6.28571 2H2.71429C2.3198 2 2 2.34822 2 2.77778V8.22222C2 8.65178 2.3198 9 2.71429 9H6.28571C6.6802 9 7 8.65178 7 8.22222V2.77778C7 2.34822 6.6802 2 6.28571 2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15.2857 2H11.7143C11.3198 2 11 2.35817 11 2.8V5.2C11 5.64183 11.3198 6 11.7143 6H15.2857C15.6802 6 16 5.64183 16 5.2V2.8C16 2.35817 15.6802 2 15.2857 2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15.2857 9H11.7143C11.3198 9 11 9.34822 11 9.77778V15.2222C11 15.6518 11.3198 16 11.7143 16H15.2857C15.6802 16 16 15.6518 16 15.2222V9.77778C16 9.34822 15.6802 9 15.2857 9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M6.28571 12H2.71429C2.3198 12 2 12.3582 2 12.8V15.2C2 15.6418 2.3198 16 2.71429 16H6.28571C6.6802 16 7 15.6418 7 15.2V12.8C7 12.3582 6.6802 12 6.28571 12Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function LaunchIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 2V11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 6L9 2L5 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 11V14.3333C16 14.7754 15.8361 15.1993 15.5444 15.5118C15.2527 15.8244 14.857 16 14.4444 16H3.55556C3.143 16 2.74733 15.8244 2.45561 15.5118C2.16389 15.1993 2 14.7754 2 14.3333V11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SwapIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0_22_1625)">
          <path d="M6.76449 6.75024C6.6879 5.75703 6.91742 4.76419 7.42215 3.90537C7.92689 3.04654 8.6826 2.36296 9.58759 1.94662C10.4926 1.53028 11.5034 1.40118 12.484 1.57668C13.4645 1.75219 14.3678 2.22389 15.0722 2.92828C15.7766 3.63267 16.2483 4.53595 16.4238 5.51652C16.5993 6.4971 16.4702 7.50791 16.0539 8.4129C15.6375 9.31788 14.9539 10.0736 14.0951 10.5783C13.2363 11.0831 12.2435 11.3126 11.2502 11.236M16.5002 12.7502C16.5002 13.347 16.2632 13.9193 15.8412 14.3412C15.4193 14.7632 14.847 15.0002 14.2502 15.0002H12.7502M12.7502 15.0002L14.2502 13.5002M12.7502 15.0002L14.2502 16.5002M1.50024 5.25024C1.50024 4.65351 1.7373 4.08121 2.15925 3.65925C2.58121 3.2373 3.15351 3.00024 3.75024 3.00024H5.25024M5.25024 3.00024L3.75024 4.50024M5.25024 3.00024L3.75024 1.50024M6.37524 16.5002C5.08231 16.5002 3.84234 15.9866 2.9281 15.0724C2.01386 14.1581 1.50024 12.9182 1.50024 11.6252C1.50024 10.3323 2.01386 9.09234 2.9281 8.1781C3.84234 7.26386 5.08231 6.75024 6.37524 6.75024C7.66817 6.75024 8.90815 7.26386 9.82239 8.1781C10.7366 9.09234 11.2502 10.3323 11.2502 11.6252C11.2502 12.9182 10.7366 14.1581 9.82239 15.0724C8.90815 15.9866 7.66817 16.5002 6.37524 16.5002Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <defs>
          <clipPath id="clip0_22_1625">
            <rect width="18" height="18" fill="white" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function StakeIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 12.0005H17.4C17.5591 12.0005 17.7117 12.0637 17.8243 12.1762C17.9368 12.2887 18 12.4414 18 12.6005V19.4005C18 19.5596 17.9368 19.7122 17.8243 19.8248C17.7117 19.9373 17.5591 20.0005 17.4 20.0005H6.6C6.44087 20.0005 6.28826 19.9373 6.17574 19.8248C6.06321 19.7122 6 19.5596 6 19.4005V12.6005C6 12.4414 6.06321 12.2887 6.17574 12.1762C6.28826 12.0637 6.44087 12.0005 6.6 12.0005H8M16 12.0005V8.00049C16 6.66749 15.2 4.00049 12 4.00049C8.8 4.00049 8 6.66749 8 8.00049V12.0005M16 12.0005H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function PortfolioIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 18.0004H2.25H3ZM5 7.00045L5 6.25045L5 7.00045ZM19 7.00045V6.25045V7.00045ZM16.1464 13.854L16.6768 13.3237L16.6768 13.3237L16.1464 13.854ZM16 13.5004L15.25 13.5004L16 13.5004ZM16.1464 13.1469L16.6768 13.6772L16.6768 13.6772L16.1464 13.1469ZM16.8536 13.1469L16.3232 13.6772L16.3232 13.6772L16.8536 13.1469ZM18 5.60345L18.75 5.60345L18.75 5.60324L18 5.60345ZM15.485 3.67145L15.2919 2.94674L15.2918 2.94677L15.485 3.67145ZM4.485 6.60445L4.67813 7.32916L4.67823 7.32913L4.485 6.60445ZM3 8.53745L3.75 8.53745L3.75 8.53728L3 8.53745ZM19 20.0004V19.2504H5V20.0004V20.7504H19V20.0004ZM5 20.0004V19.2504C4.66848 19.2504 4.35054 19.1188 4.11612 18.8843L3.58579 19.4147L3.05546 19.945C3.57118 20.4607 4.27066 20.7504 5 20.7504V20.0004ZM3.58579 19.4147L4.11612 18.8843C3.8817 18.6499 3.75 18.332 3.75 18.0004H3H2.25C2.25 18.7298 2.53973 19.4293 3.05546 19.945L3.58579 19.4147ZM3 18.0004H3.75V9.00045H3H2.25V18.0004H3ZM3 9.00045H3.75C3.75 8.66893 3.8817 8.35098 4.11612 8.11656L3.58579 7.58623L3.05546 7.0559C2.53973 7.57163 2.25 8.2711 2.25 9.00045H3ZM3.58579 7.58623L4.11612 8.11656C4.35054 7.88214 4.66848 7.75045 5 7.75045L5 7.00045L5 6.25045C4.27065 6.25045 3.57118 6.54018 3.05546 7.0559L3.58579 7.58623ZM5 7.00045V7.75045H19V7.00045V6.25045H5V7.00045ZM19 7.00045V7.75045C19.3315 7.75045 19.6495 7.88214 19.8839 8.11656L20.4142 7.58623L20.9445 7.0559C20.4288 6.54018 19.7293 6.25045 19 6.25045V7.00045ZM20.4142 7.58623L19.8839 8.11656C20.1183 8.35098 20.25 8.66893 20.25 9.00045H21H21.75C21.75 8.2711 21.4603 7.57163 20.9445 7.0559L20.4142 7.58623ZM21 9.00045H20.25V18.0004H21H21.75V9.00045H21ZM21 18.0004H20.25C20.25 18.332 20.1183 18.6499 19.8839 18.8843L20.4142 19.4147L20.9445 19.945C21.4603 19.4293 21.75 18.7298 21.75 18.0004H21ZM20.4142 19.4147L19.8839 18.8843C19.6495 19.1188 19.3315 19.2504 19 19.2504V20.0004V20.7504C19.7293 20.7504 20.4288 20.4607 20.9445 19.945L20.4142 19.4147ZM16.5 14.0004V13.2504C16.5663 13.2504 16.6299 13.2768 16.6768 13.3237L16.1464 13.854L15.6161 14.3843C15.8505 14.6188 16.1685 14.7504 16.5 14.7504V14.0004ZM16.1464 13.854L16.6768 13.3237C16.7237 13.3706 16.75 13.4341 16.75 13.5004L16 13.5004L15.25 13.5004C15.25 13.832 15.3817 14.1499 15.6161 14.3843L16.1464 13.854ZM16 13.5004L16.75 13.5004C16.75 13.5667 16.7237 13.6303 16.6768 13.6772L16.1464 13.1469L15.6161 12.6166C15.3817 12.851 15.25 13.1689 15.25 13.5004L16 13.5004ZM16.1464 13.1469L16.6768 13.6772C16.6299 13.7241 16.5663 13.7504 16.5 13.7504V13.0004V12.2504C16.1685 12.2504 15.8505 12.3821 15.6161 12.6166L16.1464 13.1469ZM16.5 13.0004V13.7504C16.4337 13.7504 16.3701 13.7241 16.3232 13.6772L16.8536 13.1469L17.3839 12.6166C17.1495 12.3821 16.8315 12.2504 16.5 12.2504V13.0004ZM16.8536 13.1469L16.3232 13.6772C16.2763 13.6303 16.25 13.5667 16.25 13.5004H17H17.75C17.75 13.1689 17.6183 12.851 17.3839 12.6166L16.8536 13.1469ZM17 13.5004H16.25C16.25 13.4341 16.2763 13.3706 16.3232 13.3237L16.8536 13.854L17.3839 14.3843C17.6183 14.1499 17.75 13.832 17.75 13.5004H17ZM16.8536 13.854L16.3232 13.3237C16.3701 13.2768 16.4337 13.2504 16.5 13.2504V14.0004V14.7504C16.8315 14.7504 17.1495 14.6188 17.3839 14.3843L16.8536 13.854ZM18 7.00045H18.75V5.60345H18H17.25V7.00045H18ZM18 5.60345L18.75 5.60324C18.7499 5.18181 18.6529 4.76604 18.4666 4.38804L17.7939 4.71966L17.1212 5.05129C17.2059 5.22311 17.2499 5.41209 17.25 5.60366L18 5.60345ZM17.7939 4.71966L18.4666 4.38804C18.2802 4.01004 18.0095 3.67993 17.6753 3.42319L17.2184 4.01796L16.7615 4.61273C16.9134 4.72942 17.0365 4.87947 17.1212 5.05129L17.7939 4.71966ZM17.2184 4.01796L17.6753 3.42319C17.3411 3.16646 16.9523 2.98997 16.5391 2.90736L16.3921 3.64281L16.245 4.37826C16.4329 4.41581 16.6096 4.49603 16.7615 4.61273L17.2184 4.01796ZM16.3921 3.64281L16.5391 2.90736C16.1258 2.82475 15.6991 2.83822 15.2919 2.94674L15.485 3.67145L15.6781 4.39616C15.8632 4.34683 16.0572 4.3407 16.245 4.37826L16.3921 3.64281ZM15.485 3.67145L15.2918 2.94677L4.29177 5.87977L4.485 6.60445L4.67823 7.32913L15.6782 4.39613L15.485 3.67145ZM4.485 6.60445L4.29188 5.87974C3.7062 6.03581 3.18849 6.38101 2.81924 6.86166L3.41399 7.31857L4.00874 7.77549C4.17659 7.55701 4.41191 7.4001 4.67813 7.32916L4.485 6.60445ZM3.41399 7.31857L2.81924 6.86166C2.44998 7.34232 2.24987 7.9315 2.25 8.53761L3 8.53745L3.75 8.53728C3.74994 8.26177 3.8409 7.99396 4.00874 7.77549L3.41399 7.31857ZM3 8.53745L2.25 8.53745L2.25 9.00045L3 9.00045L3.75 9.00045L3.75 8.53745L3 8.53745Z" fill="currentColor"/>
      </svg>
    </div>
  );
}

function FAQIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0_22_1627)">
          <path d="M5.92529 6.06024C5.92529 2.48049 11.5503 2.48049 11.5503 6.06024C11.5503 8.61699 8.99354 8.10549 8.99354 11.1737M9.00029 14.2577L9.00779 14.2495" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <defs>
          <clipPath id="clip0_22_1627">
            <rect width="18" height="18" fill="white" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function DocsIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 7.00024H17M7 12.0002H17M7 17.0002H13M19 3.00024H5C4.46957 3.00024 3.96086 3.21096 3.58579 3.58603C3.21071 3.9611 3 4.46981 3 5.00024V19.0002C3 19.5307 3.21071 20.0394 3.58579 20.4145C3.96086 20.7895 4.46957 21.0002 5 21.0002H19C19.5304 21.0002 20.0391 20.7895 20.4142 20.4145C20.7893 20.0394 21 19.5307 21 19.0002V5.00024C21 4.46981 20.7893 3.9611 20.4142 3.58603C20.0391 3.21096 19.5304 3.00024 19 3.00024Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5.50027 16.0005C10.5003 18.5005 13.5003 18.5005 18.5003 16.0005M15.5003 17.5005L16.5003 19.5005C16.5003 19.5005 20.6713 18.1725 22.0003 16.0005C22.0003 15.0005 22.5303 7.85349 19.0003 5.50049C17.5003 4.50049 15.0003 4.00049 15.0003 4.00049L14.0003 6.00049H12.0003M8.52827 17.5005L7.52827 19.5005C7.52827 19.5005 3.35727 18.1725 2.02827 16.0005C2.02827 15.0005 1.49827 7.85349 5.02827 5.50049C6.52827 4.50049 9.02827 4.00049 9.02827 4.00049L10.0283 6.00049H12.0283M8.50027 14.0005C7.67227 14.0005 7.00027 13.1055 7.00027 12.0005C7.00027 10.8955 7.67227 10.0005 8.50027 10.0005C9.32827 10.0005 10.0003 10.8955 10.0003 12.0005C10.0003 13.1055 9.32827 14.0005 8.50027 14.0005ZM15.5003 14.0005C14.6723 14.0005 14.0003 13.1055 14.0003 12.0005C14.0003 10.8955 14.6723 10.0005 15.5003 10.0005C16.3283 10.0005 17.0003 10.8955 17.0003 12.0005C17.0003 13.1055 16.3283 14.0005 15.5003 14.0005Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function TwitterIcon({ className }: { className?: string }) {
  return (
    <div className={className}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
      </svg>
    </div>
  );
}

interface NavButtonProps {
  icon: React.ReactNode;
  label: string;
  href: string;
  isActive: boolean;
  onClick: () => void;
}

function NavButton({ icon, label, href, isActive, onClick }: NavButtonProps) {
  const { theme } = useTheme();
  
  const backgroundColor = isActive
    ? (theme === 'dark' ? '#3C3C3D' : '#e4e4e8')
    : 'transparent';
  
  const hoverBackgroundColor = theme === 'dark' ? '#2B2B2B' : '#f6f6f7';

  return (
    <button
      onClick={onClick}
      className="box-border flex gap-[12px] h-[44px] items-center overflow-clip pl-[16px] pr-0 py-0 relative rounded-[10px] w-[192px] transition-colors cursor-pointer"
      style={{
        backgroundColor,
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = hoverBackgroundColor;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      <div className="relative shrink-0 size-[22px]" style={{ color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
        {icon}
      </div>
      <div className="capitalize flex flex-col font-normal justify-center leading-[0] not-italic relative shrink-0 text-[16px] text-center tracking-[0.32px] whitespace-nowrap" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
        <p className="leading-[14px]">{label}</p>
      </div>
    </button>
  );
}

interface FooterButtonProps {
  icon: React.ReactNode;
  label: string;
  href: string;
  external?: boolean;
}

function ThemeToggleButton() {
  const { theme, toggleTheme } = useTheme();
  const iconColor = theme === 'dark' ? '#7D7D7D' : '#949494';
  const textColor = theme === 'dark' ? '#7D7D7D' : '#949494';

  return (
    <button
      onClick={toggleTheme}
      className="box-border flex gap-[12px] h-[44px] items-center overflow-clip pl-[16px] pr-0 py-0 relative rounded-[10px] w-[192px] transition-colors cursor-pointer hover:opacity-80"
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
    >
      <div className="relative shrink-0 size-[22px] flex items-center justify-center" style={{ color: iconColor }}>
        {theme === 'light' ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="hover:opacity-80 transition-opacity">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="hover:opacity-80 transition-opacity">
            <g clipPath="url(#clip0_4064_321)">
              <path d="M22 12.0002H23M12 2.00024V1.00024M12 23.0002V22.0002M20 20.0002L19 19.0002M20 4.00024L19 5.00024M4 20.0002L5 19.0002M4 4.00024L5 5.00024M1 12.0002H2M12 18.0002C13.5913 18.0002 15.1174 17.3681 16.2426 16.2429C17.3679 15.1177 18 13.5915 18 12.0002C18 10.4089 17.3679 8.88282 16.2426 7.7576C15.1174 6.63239 13.5913 6.00024 12 6.00024C10.4087 6.00024 8.88258 6.63239 7.75736 7.7576C6.63214 8.88282 6 10.4089 6 12.0002C6 13.5915 6.63214 15.1177 7.75736 16.2429C8.88258 17.3681 10.4087 18.0002 12 18.0002Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </g>
            <defs>
              <clipPath id="clip0_4064_321">
                <rect width="24" height="24" fill="white"/>
              </clipPath>
            </defs>
          </svg>
        )}
      </div>
      <div className="capitalize flex flex-col font-normal justify-center leading-[0] not-italic relative shrink-0 text-[16px] text-center tracking-[0.32px] whitespace-nowrap" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>
        <p className="leading-[14px]">change theme</p>
      </div>
    </button>
  );
}

function FooterButton({ icon, label, href, external = false }: FooterButtonProps) {
  const { theme } = useTheme();
  const iconColor = theme === 'dark' ? '#7D7D7D' : '#949494';
  const textColor = theme === 'dark' ? '#7D7D7D' : '#949494';

  const content = (
    <>
      <div className="relative shrink-0 size-[22px]" style={{ color: iconColor }}>
        {icon}
      </div>
      <div className="capitalize flex flex-col font-normal justify-center leading-[0] not-italic relative shrink-0 text-[16px] text-center tracking-[0.32px] whitespace-nowrap" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>
        <p className="leading-[14px]">{label}</p>
      </div>
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="box-border flex gap-[12px] h-[44px] items-center overflow-clip pl-[16px] pr-0 py-0 relative rounded-[10px] w-[192px] transition-colors cursor-pointer hover:opacity-80"
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={href}
      className="box-border flex gap-[12px] h-[44px] items-center overflow-clip pl-[16px] pr-0 py-0 relative rounded-[10px] w-[192px] transition-colors cursor-pointer hover:opacity-80"
    >
      {content}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useTheme();

  const handleNavClick = (href: string) => {
    router.push(href);
  };

  // Navigation items based on Figma design
  const navItems = [
    { icon: <ProjectsIcon />, label: 'Projects', href: '/projects' },
    { icon: <LaunchIcon />, label: 'Launch', href: '/launch' },
    { icon: <SwapIcon />, label: 'Swap', href: '/swap' },
    { icon: <StakeIcon />, label: 'Stake', href: '/stake' },
    { icon: <PortfolioIcon />, label: 'Portfolio', href: '/portfolio' },
    { icon: <FAQIcon />, label: 'FAQ', href: '/faq' },
  ];

  return (
    <aside
      className="fixed left-0 top-0 h-screen overflow-hidden flex flex-col justify-between pb-[40px] pt-[20px] px-[16px] w-[228px]"
      style={{
        backgroundColor: theme === 'dark' ? '#222222' : '#fafafa',
        borderRight: `1px solid ${theme === 'dark' ? '#1C1C1C' : '#e5e5e5'}`,
      }}
    >
      {/* Top Section */}
      <div className="flex flex-col gap-[36px]">
        {/* Logo */}
        <button
          onClick={() => router.push('/')}
          className="flex gap-[4px] h-[39px] items-center cursor-pointer hover:opacity-80 transition-opacity"
        >
          <div className="bg-[#030213] relative rounded-[8.75px] shrink-0 size-[28px] flex items-center justify-center">
            <Image
              src="/logos/z-logo-white.png"
              alt="Z"
              width={18}
              height={18}
              className="w-[18px] h-[18px]"
            />
          </div>
          <div className="h-[39px] flex items-center justify-center">
            <p className="font-medium leading-[21px] not-italic text-[24px] tracking-[-0.1504px]" style={{ fontFamily: 'Inter, sans-serif', color: theme === 'dark' ? '#ffffff' : '#0a0a0a' }}>
              Combinator
            </p>
          </div>
        </button>

        {/* Navigation */}
        <div className="flex flex-col gap-[7px]">
          <div className="flex flex-col gap-[8px]">
            {navItems.map((item) => (
              <NavButton
                key={item.href}
                icon={item.icon}
                label={item.label}
                href={item.href}
                isActive={
                  pathname === item.href ||
                  (item.href === '/projects' && (pathname === '/projects' || pathname === '/tokens'))
                }
                onClick={() => handleNavClick(item.href)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer Section */}
      <div className="flex flex-col items-start gap-0">
        <FooterButton
          icon={<DocsIcon />}
          label="Docs"
          href="https://docs.zcombinator.io/"
          external
        />
        <FooterButton
          icon={<DiscordIcon />}
          label="Discord"
          href="https://discord.com/invite/MQfcX9QM2r"
          external
        />
        <FooterButton
          icon={<TwitterIcon />}
          label="X (Twitter)"
          href="https://x.com/zcombinatorio"
          external
        />
        <ThemeToggleButton />
      </div>
    </aside>
  );
}