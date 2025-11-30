'use client';
/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
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

import { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';

interface ProjectCardProps {
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenAddress: string;
  creatorTwitter?: string | null;
  creatorGithub?: string | null;
  metadata?: {
    name: string;
    symbol: string;
    image: string;
    website?: string;
    twitter?: string;
    discord?: string;
    github?: string;
    description?: string;
  } | null;
  launchTime?: string;
  marketCap?: number;
  priceChange?: number;
  verified?: boolean;
  onClick?: () => void;
}

export function ProjectCard({
  tokenName,
  tokenSymbol,
  tokenAddress,
  creatorTwitter,
  creatorGithub,
  metadata,
  launchTime,
  marketCap,
  priceChange,
  verified = false,
  onClick,
}: ProjectCardProps) {
  const [copiedAddress, setCopiedAddress] = useState(false);
  const { theme } = useTheme();
  const textColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';
  const mutedTextColor = theme === 'dark' ? '#B8B8B8' : '#717182';
  const cardBg = theme === 'dark' ? '#222222' : '#ffffff';
  const cardBorder = theme === 'dark' ? '#1C1C1C' : '#e5e5e5';
  const cardHover = theme === 'dark' ? '#2a2a2a' : '#F9F9F9';
  const socialButtonBg = theme === 'dark' ? '#303030' : '#ffffff';

  const formatAddress = (address: string) => {
    if (!address) return '';
    const start = address.slice(0, 4);
    const end = address.slice(-4);
    return `${start}...${end}`;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return `${diffDays} days ago`;
  };

  const formatMarketCap = (marketCap: number | undefined) => {
    if (!marketCap || marketCap === 0) return '-';
    if (marketCap >= 1_000_000) {
      const value = marketCap / 1_000_000;
      if (value >= 1) {
        return `$${value.toFixed(1)}m`;
      }
      return `$${(value * 1000).toFixed(0)}k`;
    } else if (marketCap >= 1_000) {
      return `$${(marketCap / 1_000).toFixed(1)}k`;
    }
    return `$${marketCap.toFixed(2)}`;
  };

  const formatPriceChange = (change: number | undefined) => {
    if (change === undefined || change === null) return null;
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  };

  const handleCopyAddress = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(tokenAddress);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const displayName = tokenName || metadata?.name || 'Unknown';
  const displaySymbol = tokenSymbol || metadata?.symbol || '';
  const displayImage = metadata?.image || '/zcombinator-logo.png';

  // Prepare social links - explicit checks to ensure Discord is included
  const websiteUrl = metadata?.website;
  const twitterUrl = metadata?.twitter || (creatorTwitter ? `https://x.com/${creatorTwitter.replace('@', '')}` : null);
  const discordUrl = metadata?.discord;
  const githubUrl = metadata?.github || (creatorGithub ? (creatorGithub.startsWith('http') ? creatorGithub : `https://github.com/${creatorGithub}`) : null);

  // Build array of social buttons in order: Website, X, Discord, GitHub
  const socialButtons: Array<{ type: 'website' | 'twitter' | 'discord' | 'github'; url: string }> = [];
  
  if (websiteUrl) {
    socialButtons.push({ type: 'website', url: websiteUrl });
  }
  if (twitterUrl) {
    socialButtons.push({ type: 'twitter', url: twitterUrl });
  }
  if (discordUrl) {
    socialButtons.push({ type: 'discord', url: discordUrl });
  }
  if (githubUrl) {
    socialButtons.push({ type: 'github', url: githubUrl });
  }

  const shadowStyle = theme === 'dark' 
    ? '0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)'
    : '0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)';

  return (
    <div
      onClick={onClick}
      className={`rounded-[12px] px-[12px] py-[20px] flex flex-col gap-[10px] ${
        onClick ? 'cursor-pointer' : ''
      } transition-colors`}
      style={{ 
        fontFamily: 'Inter, sans-serif',
        backgroundColor: cardBg,
        border: `1px solid ${cardBorder}`,
        boxShadow: shadowStyle,
        ...(onClick && { '--hover-bg': cardHover } as React.CSSProperties)
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = cardHover;
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.backgroundColor = cardBg;
        }
      }}
    >
      <div className="flex items-center justify-between pl-[12px] pr-[20px] py-0 w-full">
        {/* Left: Token Info */}
        <div className="flex gap-[14px] items-center">
          {/* Token Image */}
          <div className="relative rounded-[12px] shrink-0 size-[80px] overflow-hidden">
            <img
              src={displayImage}
              alt={displayName}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Token Name, Symbol, Address, Time */}
          <div className="flex flex-col gap-[10px] items-start w-[148px]">
            {/* Name, Symbol, Verified Badge */}
            <div className="flex gap-[6px] items-center w-full">
              <p className="font-medium text-[16px] leading-[1.4] whitespace-nowrap" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>
                {displayName}
              </p>
              <p className="font-medium text-[16px] leading-[1.4] uppercase whitespace-nowrap" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                {displaySymbol}
              </p>
              {verified && (
                <div className="relative shrink-0 size-[16px]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M10.5214 2.6239L11.0759 3.1289L11.076 3.12877L10.5214 2.6239ZM12.0004 1.97021V2.72021V1.97021ZM13.4794 2.6239L12.9248 3.12877L12.9249 3.1289L13.4794 2.6239ZM14.4994 3.7439L13.9449 4.2489L13.9449 4.24896L14.4994 3.7439ZM16.0714 4.3949L16.0367 3.6457L16.0363 3.64572L16.0714 4.3949ZM17.5844 4.3249L17.6191 5.0741L17.6197 5.07407L17.5844 4.3249ZM19.6764 6.4149L20.4256 6.45004L20.4256 6.44948L19.6764 6.4149ZM19.6054 7.9289L18.8562 7.89377L18.8562 7.89386L19.6054 7.9289ZM20.2564 9.5009L19.7513 10.0554L19.7514 10.0554L20.2564 9.5009ZM21.3764 10.5209L20.8714 11.0754L20.8715 11.0755L21.3764 10.5209ZM21.3764 13.4789L20.8715 12.9243L20.8714 12.9244L21.3764 13.4789ZM20.2564 14.4989L19.7514 13.9444L19.7513 13.9444L20.2564 14.4989ZM19.6054 16.0709L20.3546 16.0362L20.3546 16.0359L19.6054 16.0709ZM19.6754 17.5839L18.9262 17.6186L18.9262 17.6192L19.6754 17.5839ZM17.5854 19.6759L17.5503 20.4251L17.5508 20.4251L17.5854 19.6759ZM16.0714 19.6049L16.1065 18.8557L16.1064 18.8557L16.0714 19.6049ZM14.4994 20.2559L13.9449 19.7508L13.9449 19.7509L14.4994 20.2559ZM13.4794 21.3759L12.9249 20.8709L12.9248 20.871L13.4794 21.3759ZM10.5214 21.3759L11.076 20.871L11.0759 20.8709L10.5214 21.3759ZM9.50139 20.2559L10.0559 19.7509L10.0558 19.7508L9.50139 20.2559ZM7.92939 19.6049L7.96405 20.3541L7.96444 20.3541L7.92939 19.6049ZM6.41639 19.6749L6.38173 18.9257L6.38109 18.9257L6.41639 19.6749ZM4.32439 17.5849L3.57521 17.5498L3.57519 17.5503L4.32439 17.5849ZM4.39539 16.0709L5.14457 16.106L5.14457 16.1059L4.39539 16.0709ZM3.74439 14.4989L4.24945 13.9444L4.24939 13.9444L3.74439 14.4989ZM2.62439 13.4789L3.12939 12.9244L3.12926 12.9243L2.62439 13.4789ZM1.9707 11.9999H2.7207H1.9707ZM2.62439 10.5209L3.12926 11.0755L3.12939 11.0754L2.62439 10.5209ZM3.74439 9.5009L4.24939 10.0554L4.24945 10.0554L3.74439 9.5009ZM4.39539 7.9289L3.64619 7.96356L3.64621 7.96395L4.39539 7.9289ZM4.32539 6.4159L5.07459 6.38124L5.07456 6.3806L4.32539 6.4159ZM6.41539 4.3239L6.45052 3.57472L6.44997 3.5747L6.41539 4.3239ZM7.92939 4.3949L7.89426 5.14408L7.89434 5.14408L7.92939 4.3949ZM9.50139 3.7439L10.0558 4.24896L10.0559 4.2489L9.50139 3.7439ZM9.53072 11.4696C9.23783 11.1767 8.76295 11.1767 8.47006 11.4696C8.17717 11.7625 8.17717 12.2373 8.47006 12.5302L9.00039 11.9999L9.53072 11.4696ZM11.0004 13.9999L10.4701 14.5302C10.763 14.8231 11.2378 14.8231 11.5307 14.5302L11.0004 13.9999ZM15.5307 10.5302C15.8236 10.2373 15.8236 9.76247 15.5307 9.46957C15.2378 9.17668 14.763 9.17668 14.4701 9.46957L15.0004 9.9999L15.5307 10.5302ZM10.5214 2.6239L11.076 3.12877C11.1932 3.00007 11.3359 2.89726 11.4951 2.82691L11.1919 2.14092L10.8887 1.45494C10.5385 1.60971 10.2245 1.83591 9.96676 2.11903L10.5214 2.6239ZM11.1919 2.14092L11.4951 2.82691C11.6542 2.75655 11.8264 2.72021 12.0004 2.72021V1.97021V1.22021C11.6175 1.22021 11.2389 1.30016 10.8887 1.45494L11.1919 2.14092ZM12.0004 1.97021V2.72021C12.1744 2.72021 12.3465 2.75655 12.5057 2.82691L12.8089 2.14092L13.1121 1.45494C12.7619 1.30016 12.3833 1.22021 12.0004 1.22021V1.97021ZM12.8089 2.14092L12.5057 2.82691C12.6649 2.89726 12.8076 3.00007 12.9248 3.12877L13.4794 2.6239L14.034 2.11903C13.7763 1.83591 13.4623 1.60971 13.1121 1.45494L12.8089 2.14092ZM13.4794 2.6239L12.9249 3.1289L13.9449 4.2489L14.4994 3.7439L15.0539 3.2389L14.0339 2.1189L13.4794 2.6239ZM14.4994 3.7439L13.9449 4.24896C14.2172 4.5479 14.5521 4.78312 14.9258 4.93784L15.2127 4.24491L15.4997 3.55197C15.3298 3.48165 15.1776 3.37473 15.0538 3.23885L14.4994 3.7439ZM15.2127 4.24491L14.9258 4.93784C15.2994 5.09256 15.7025 5.16298 16.1064 5.14408L16.0714 4.3949L16.0363 3.64572C15.8527 3.65431 15.6695 3.6223 15.4997 3.55197L15.2127 4.24491ZM16.0714 4.3949L16.1061 5.1441L17.6191 5.0741L17.5844 4.3249L17.5497 3.5757L16.0367 3.6457L16.0714 4.3949ZM17.5844 4.3249L17.6197 5.07407C17.7935 5.06588 17.967 5.09406 18.1293 5.15679L18.3997 4.45725L18.6702 3.75771C18.3132 3.6197 17.9314 3.55772 17.5491 3.57573L17.5844 4.3249ZM18.3997 4.45725L18.1293 5.15679C18.2915 5.21952 18.4389 5.31543 18.562 5.43838L19.0921 4.9078L19.6221 4.37721C19.3514 4.10672 19.0272 3.89572 18.6702 3.75771L18.3997 4.45725ZM19.0921 4.9078L18.562 5.43838C18.685 5.56133 18.7811 5.70862 18.844 5.87081L19.5433 5.59969L20.2425 5.32856C20.1042 4.97172 19.8929 4.6477 19.6221 4.37721L19.0921 4.9078ZM19.5433 5.59969L18.844 5.87081C18.9069 6.03301 18.9352 6.20655 18.9272 6.38032L19.6764 6.4149L20.4256 6.44948C20.4432 6.06717 20.3809 5.68539 20.2425 5.32856L19.5433 5.59969ZM19.6764 6.4149L18.9272 6.37977L18.8562 7.89377L19.6054 7.9289L20.3546 7.96404L20.4256 6.45004L19.6764 6.4149ZM19.6054 7.9289L18.8562 7.89386C18.8373 8.2978 18.9077 8.70093 19.0625 9.07454L19.7554 8.78758L20.4483 8.50062C20.378 8.3308 20.346 8.14755 20.3546 7.96395L19.6054 7.9289ZM19.7554 8.78758L19.0625 9.07454C19.2172 9.44815 19.4524 9.78304 19.7513 10.0554L20.2564 9.5009L20.7614 8.94645C20.6256 8.82267 20.5186 8.67045 20.4483 8.50062L19.7554 8.78758ZM20.2564 9.5009L19.7514 10.0554L20.8714 11.0754L21.3764 10.5209L21.8814 9.96639L20.7614 8.9464L20.2564 9.5009ZM21.3764 10.5209L20.8715 11.0755C21.0002 11.1927 21.103 11.3354 21.1734 11.4946L21.8594 11.1914L22.5454 10.8882C22.3906 10.538 22.1644 10.224 21.8813 9.96628L21.3764 10.5209ZM21.8594 11.1914L21.1734 11.4946C21.2437 11.6538 21.2801 11.8259 21.2801 11.9999H22.0301H22.7801C22.7801 11.617 22.7001 11.2384 22.5454 10.8882L21.8594 11.1914ZM22.0301 11.9999H21.2801C21.2801 12.1739 21.2437 12.346 21.1734 12.5052L21.8594 12.8084L22.5454 13.1116C22.7001 12.7614 22.7801 12.3828 22.7801 11.9999H22.0301ZM21.8594 12.8084L21.1734 12.5052C21.103 12.6644 21.0002 12.8071 20.8715 12.9243L21.3764 13.4789L21.8813 14.0335C22.1644 13.7758 22.3906 13.4618 22.5454 13.1116L21.8594 12.8084ZM21.3764 13.4789L20.8714 12.9244L19.7514 13.9444L20.2564 14.4989L20.7614 15.0534L21.8814 14.0334L21.3764 13.4789ZM20.2564 14.4989L19.7513 13.9444C19.4524 14.2168 19.2172 14.5517 19.0625 14.9253L19.7554 15.2122L20.4483 15.4992C20.5186 15.3294 20.6256 15.1771 20.7614 15.0534L20.2564 14.4989ZM19.7554 15.2122L19.0625 14.9253C18.9077 15.2989 18.8373 15.702 18.8562 16.1059L19.6054 16.0709L20.3546 16.0359C20.346 15.8522 20.378 15.669 20.4483 15.4992L19.7554 15.2122ZM19.6054 16.0709L18.8562 16.1056L18.9262 17.6186L19.6754 17.5839L20.4246 17.5492L20.3546 16.0362L19.6054 16.0709ZM19.6754 17.5839L18.9262 17.6192C18.9344 17.793 18.9062 17.9665 18.8435 18.1288L19.543 18.3992L20.2426 18.6697C20.3806 18.3127 20.4426 17.9309 20.4246 17.5486L19.6754 17.5839ZM19.543 18.3992L18.8435 18.1288C18.7808 18.291 18.6849 18.4384 18.5619 18.5615L19.0925 19.0916L19.6231 19.6216C19.8936 19.3509 20.1046 19.0267 20.2426 18.6697L19.543 18.3992ZM19.0925 19.0916L18.5619 18.5615C18.439 18.6846 18.2917 18.7806 18.1295 18.8435L18.4006 19.5428L18.6717 20.2421C19.0286 20.1037 19.3526 19.8924 19.6231 19.6216L19.0925 19.0916ZM18.4006 19.5428L18.1295 18.8435C17.9673 18.9064 17.7937 18.9347 17.62 18.9267L17.5854 19.6759L17.5508 20.4251C17.9331 20.4428 18.3149 20.3804 18.6717 20.2421L18.4006 19.5428ZM17.5854 19.6759L17.6205 18.9267L16.1065 18.8557L16.0714 19.6049L16.0363 20.3541L17.5503 20.4251L17.5854 19.6759ZM16.0714 19.6049L16.1064 18.8557C15.7025 18.8368 15.2994 18.9072 14.9258 19.062L15.2127 19.7549L15.4997 20.4478C15.6695 20.3775 15.8527 20.3455 16.0363 20.3541L16.0714 19.6049ZM15.2127 19.7549L14.9258 19.062C14.5521 19.2167 14.2172 19.4519 13.9449 19.7508L14.4994 20.2559L15.0538 20.761C15.1776 20.6251 15.3298 20.5182 15.4997 20.4478L15.2127 19.7549ZM14.4994 20.2559L13.9449 19.7509L12.9249 20.8709L13.4794 21.3759L14.0339 21.8809L15.0539 20.7609L14.4994 20.2559ZM13.4794 21.3759L12.9248 20.871C12.8076 20.9997 12.6649 21.1025 12.5057 21.1729L12.8089 21.8589L13.1121 22.5449C13.4623 22.3901 13.7763 22.1639 14.034 21.8808L13.4794 21.3759ZM12.8089 21.8589L12.5057 21.1729C12.3465 21.2432 12.1744 21.2796 12.0004 21.2796V22.0296V22.7796C12.3833 22.7796 12.7619 22.6996 13.1121 22.5449L12.8089 21.8589ZM12.0004 22.0296V21.2796C11.8264 21.2796 11.6542 21.2432 11.4951 21.1729L11.1919 21.8589L10.8887 22.5449C11.2389 22.6996 11.6175 22.7796 12.0004 22.7796V22.0296ZM11.1919 21.8589L11.4951 21.1729C11.3359 21.1025 11.1932 20.9997 11.076 20.871L10.5214 21.3759L9.96676 21.8808C10.2245 22.1639 10.5385 22.3901 10.8887 22.5449L11.1919 21.8589ZM10.5214 21.3759L11.0759 20.8709L10.0559 19.7509L9.50139 20.2559L8.94688 20.7609L9.96688 21.8809L10.5214 21.3759ZM9.50139 20.2559L10.0558 19.7508C9.78353 19.4519 9.44864 19.2167 9.07503 19.062L8.78807 19.7549L8.50111 20.4478C8.67094 20.5182 8.82316 20.6251 8.94694 20.761L9.50139 20.2559ZM8.78807 19.7549L9.07503 19.062C8.70142 18.9072 8.29828 18.8368 7.89434 18.8557L7.92939 19.6049L7.96444 20.3541C8.14804 20.3455 8.33129 20.3775 8.50111 20.4478L8.78807 19.7549ZM7.92939 19.6049L7.89473 18.8557L6.38173 18.9257L6.41639 19.6749L6.45105 20.4241L7.96405 20.3541L7.92939 19.6049ZM6.41639 19.6749L6.38109 18.9257C6.20732 18.9339 6.03376 18.9057 5.8715 18.843L5.60105 19.5426L5.33059 20.2421C5.68756 20.3801 6.0694 20.4421 6.45169 20.4241L6.41639 19.6749ZM5.60105 19.5426L5.8715 18.843C5.70925 18.7803 5.56187 18.6844 5.4388 18.5614L4.90873 19.092L4.37865 19.6226C4.6494 19.8931 4.97363 20.1041 5.33059 20.2421L5.60105 19.5426ZM4.90873 19.092L5.4388 18.5614C5.31573 18.4385 5.21968 18.2912 5.1568 18.129L4.45752 18.4001L3.75824 18.6712C3.89659 19.0281 4.1079 19.3521 4.37865 19.6226L4.90873 19.092ZM4.45752 18.4001L5.1568 18.129C5.09391 17.9668 5.06557 17.7933 5.07359 17.6195L4.32439 17.5849L3.57519 17.5503C3.55754 17.9326 3.61989 18.3144 3.75824 18.6712L4.45752 18.4001ZM4.32439 17.5849L5.07357 17.62L5.14457 16.106L4.39539 16.0709L3.64621 16.0358L3.57521 17.5498L4.32439 17.5849ZM4.39539 16.0709L5.14457 16.1059C5.16347 15.702 5.09305 15.2989 4.93833 14.9253L4.24539 15.2122L3.55246 15.4992C3.62279 15.669 3.6548 15.8522 3.64621 16.0359L4.39539 16.0709ZM4.24539 15.2122L4.93833 14.9253C4.78361 14.5517 4.54839 14.2168 4.24945 13.9444L3.74439 14.4989L3.23933 15.0534C3.37522 15.1771 3.48213 15.3294 3.55246 15.4992L4.24539 15.2122ZM3.74439 14.4989L4.24939 13.9444L3.12939 12.9244L2.62439 13.4789L2.11939 14.0334L3.23939 15.0534L3.74439 14.4989ZM2.62439 13.4789L3.12926 12.9243C3.00056 12.8071 2.89775 12.6644 2.8274 12.5052L2.14141 12.8084L1.45543 13.1116C1.6102 13.4618 1.83639 13.7758 2.11952 14.0335L2.62439 13.4789ZM2.14141 12.8084L2.8274 12.5052C2.75704 12.346 2.7207 12.1739 2.7207 11.9999H1.9707H1.2207C1.2207 12.3828 1.30065 12.7614 1.45543 13.1116L2.14141 12.8084ZM1.9707 11.9999H2.7207C2.7207 11.8259 2.75704 11.6538 2.8274 11.4946L2.14141 11.1914L1.45543 10.8882C1.30065 11.2384 1.2207 11.617 1.2207 11.9999H1.9707ZM2.14141 11.1914L2.8274 11.4946C2.89775 11.3354 3.00056 11.1927 3.12926 11.0755L2.62439 10.5209L2.11952 9.96628C1.83639 10.224 1.6102 10.538 1.45543 10.8882L2.14141 11.1914ZM2.62439 10.5209L3.12939 11.0754L4.24939 10.0554L3.74439 9.5009L3.23939 8.9464L2.11939 9.96639L2.62439 10.5209ZM3.74439 9.5009L4.24945 10.0554C4.54839 9.78304 4.78361 9.44815 4.93833 9.07454L4.24539 8.78758L3.55246 8.50062C3.48213 8.67045 3.37522 8.82267 3.23933 8.94645L3.74439 9.5009ZM4.24539 8.78758L4.93833 9.07454C5.09305 8.70093 5.16347 8.29779 5.14457 7.89386L4.39539 7.9289L3.64621 7.96395C3.6548 8.14756 3.62279 8.3308 3.55246 8.50062L4.24539 8.78758ZM4.39539 7.9289L5.14459 7.89424L5.07459 6.38124L4.32539 6.4159L3.57619 6.45056L3.64619 7.96356L4.39539 7.9289ZM4.32539 6.4159L5.07456 6.3806C5.06637 6.20684 5.09455 6.03327 5.15728 5.87102L4.45774 5.60056L3.7582 5.3301C3.62019 5.68707 3.55821 6.06891 3.57622 6.4512L4.32539 6.4159ZM4.45774 5.60056L5.15728 5.87102C5.22001 5.70876 5.31592 5.56138 5.43887 5.43831L4.90828 4.90824L4.3777 4.37816C4.10721 4.64891 3.89621 4.97314 3.7582 5.3301L4.45774 5.60056ZM4.90828 4.90824L5.43887 5.43831C5.56182 5.31525 5.7091 5.2192 5.8713 5.15631L5.60017 4.45703L5.32905 3.75775C4.97222 3.8961 4.64819 4.10741 4.3777 4.37816L4.90828 4.90824ZM5.60017 4.45703L5.8713 5.15631C6.0335 5.09342 6.20703 5.06508 6.38081 5.0731L6.41539 4.3239L6.44997 3.5747C6.06766 3.55705 5.68588 3.6194 5.32905 3.75775L5.60017 4.45703ZM6.41539 4.3239L6.38026 5.07308L7.89426 5.14408L7.92939 4.3949L7.96452 3.64573L6.45052 3.57473L6.41539 4.3239ZM7.92939 4.3949L7.89434 5.14408C8.29828 5.16298 8.70142 5.09256 9.07503 4.93784L8.78807 4.24491L8.50111 3.55197C8.33129 3.6223 8.14805 3.65431 7.96444 3.64572L7.92939 4.3949ZM8.78807 4.24491L9.07503 4.93784C9.44864 4.78312 9.78353 4.5479 10.0558 4.24896L9.50139 3.7439L8.94694 3.23885C8.82316 3.37473 8.67093 3.48165 8.50111 3.55197L8.78807 4.24491ZM9.50139 3.7439L10.0559 4.2489L11.0759 3.1289L10.5214 2.6239L9.96688 2.1189L8.94688 3.2389L9.50139 3.7439ZM9.00039 11.9999L8.47006 12.5302L10.4701 14.5302L11.0004 13.9999L11.5307 13.4696L9.53072 11.4696L9.00039 11.9999ZM11.0004 13.9999L11.5307 14.5302L15.5307 10.5302L15.0004 9.9999L14.4701 9.46957L10.4701 13.4696L11.0004 13.9999Z" fill="#327755"/>
                  </svg>
                </div>
              )}
            </div>

            {/* Address with Copy */}
            <button
              onClick={handleCopyAddress}
              className="flex gap-[4px] items-center hover:opacity-80 transition-opacity cursor-pointer"
            >
              <p className="font-medium text-[14px] leading-[14px] capitalize" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                {formatAddress(tokenAddress)}
              </p>
                {copiedAddress ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                    <path d="M11.6667 3.5L5.25 9.91667L2.33333 7" stroke="#327755" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
                  <path d="M15.002 6.96045L15 4.60049C15 4.44136 14.9368 4.28875 14.8243 4.17622C14.7117 4.0637 14.5591 4.00049 14.4 4.00049H4.6C4.44087 4.00049 4.28826 4.0637 4.17574 4.17622C4.06321 4.28875 4 4.44136 4 4.60049V14.4005C4 14.5596 4.06321 14.7122 4.17574 14.8248C4.28826 14.9373 4.44087 15.0005 4.6 15.0005H7.00195M19.4 20.0005H9.6C9.44087 20.0005 9.28826 19.9373 9.17574 19.8248C9.06321 19.7122 9 19.5596 9 19.4005V9.60049C9 9.44136 9.06321 9.28875 9.17574 9.17622C9.28826 9.0637 9.44087 9.00049 9.6 9.00049H19.4C19.5591 9.00049 19.7117 9.0637 19.8243 9.17622C19.9368 9.28875 20 9.44136 20 9.60049V19.4005C20 19.5596 19.9368 19.7122 19.8243 19.8248C19.7117 19.9373 19.5591 20.0005 19.4 20.0005Z" stroke={theme === 'dark' ? '#B8B8B8' : '#717182'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

            {/* Time */}
            {launchTime && (
              <p className="font-medium text-[14px] leading-[14px] tracking-[0.0923px]" style={{ fontFamily: 'Inter, sans-serif', color: mutedTextColor }}>
                {formatTime(launchTime)}
              </p>
            )}
          </div>
        </div>

        {/* Market Cap */}
        <div className="flex flex-col gap-[10px] items-start w-[60px]">
          <div className="flex gap-[6px] items-center w-full">
            <p className="font-medium text-[16px] leading-[14px] capitalize tracking-[0.0923px]" style={{ fontFamily: 'Inter, sans-serif', color: textColor }}>
              {formatMarketCap(marketCap)}
            </p>
          </div>
          {priceChange !== undefined && priceChange !== null && (
            <p
              className={`font-medium text-[14px] leading-[1.2] ${
                priceChange >= 0 ? 'text-[#327755]' : 'text-[#d84141]'
              }`}
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {formatPriceChange(priceChange)}
            </p>
          )}
        </div>

        {/* Social Buttons */}
        <div className="flex gap-[12px] items-center w-[218px]">
          {socialButtons.map((button) => {
            if (button.type === 'website') {
              return (
            <a
                  key="website"
                  href={button.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
                  className="rounded-[6.75px] h-[32px] w-[40px] flex items-center justify-center p-px hover:opacity-80 transition-opacity cursor-pointer"
                  style={{ backgroundColor: socialButtonBg, border: `1px solid ${cardBorder}` }}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ color: textColor }}>
                <path d="M3.338 17.0005C4.21552 18.5212 5.47811 19.784 6.9987 20.6617C8.5193 21.5395 10.2443 22.0012 12 22.0005C13.7557 22.0012 15.4807 21.5395 17.0013 20.6617C18.5219 19.784 19.7845 18.5212 20.662 17.0005M3.338 7.00049C4.21552 5.47977 5.47811 4.217 6.9987 3.33926C8.5193 2.46152 10.2443 1.99978 12 2.00049C13.7557 1.99978 15.4807 2.46152 17.0013 3.33926C18.5219 4.217 19.7845 5.47977 20.662 7.00049M13 21.9505C13 21.9505 14.408 20.0975 15.295 17.0005M13 2.05049C13 2.05049 14.408 3.90249 15.295 7.00049M11 21.9505C11 21.9505 9.592 20.0985 8.705 17.0005M11 2.05049C11 2.05049 9.592 3.90249 8.705 7.00049M9 10.0005L10.5 15.0005L12 10.0005L13.5 15.0005L15 10.0005M1 10.0005L2.5 15.0005L4 10.0005L5.5 15.0005L7 10.0005M17 10.0005L18.5 15.0005L20 10.0005L21.5 15.0005L23 10.0005" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
              );
            }

            if (button.type === 'twitter') {
              return (
            <a
                  key="twitter"
                  href={button.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
                  className="rounded-[6.75px] h-[32px] w-[40px] flex items-center justify-center p-px hover:opacity-80 transition-opacity cursor-pointer"
                  style={{ backgroundColor: socialButtonBg, border: `1px solid ${cardBorder}` }}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ color: textColor }}>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" fill="currentColor"/>
              </svg>
            </a>
              );
            }

            if (button.type === 'discord') {
              return (
            <a
                  key="discord"
                  href={button.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
                  className="rounded-[6.75px] h-[32px] w-[40px] flex items-center justify-center p-px hover:opacity-80 transition-opacity cursor-pointer"
                  style={{ backgroundColor: socialButtonBg, border: `1px solid ${cardBorder}` }}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ color: textColor }}>
                <path d="M5.50027 16.0005C10.5003 18.5005 13.5003 18.5005 18.5003 16.0005M15.5003 17.5005L16.5003 19.5005C16.5003 19.5005 20.6713 18.1725 22.0003 16.0005C22.0003 15.0005 22.5303 7.85349 19.0003 5.50049C17.5003 4.50049 15.0003 4.00049 15.0003 4.00049L14.0003 6.00049H12.0003M8.52827 17.5005L7.52827 19.5005C7.52827 19.5005 3.35727 18.1725 2.02827 16.0005C2.02827 15.0005 1.49827 7.85349 5.02827 5.50049C6.52827 4.50049 9.02827 4.00049 9.02827 4.00049L10.0283 6.00049H12.0283M8.50027 14.0005C7.67227 14.0005 7.00027 13.1055 7.00027 12.0005C7.00027 10.8955 7.67227 10.0005 8.50027 10.0005C9.32827 10.0005 10.0003 10.8955 10.0003 12.0005C10.0003 13.1055 9.32827 14.0005 8.50027 14.0005ZM15.5003 14.0005C14.6723 14.0005 14.0003 13.1055 14.0003 12.0005C14.0003 10.8955 14.6723 10.0005 15.5003 10.0005C16.3283 10.0005 17.0003 10.8955 17.0003 12.0005C17.0003 13.1055 16.3283 14.0005 15.5003 14.0005Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
              );
            }

            if (button.type === 'github') {
              return (
            <a
                  key="github"
                  href={button.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
                  className="rounded-[6.75px] h-[32px] w-[40px] flex items-center justify-center p-px hover:opacity-80 transition-opacity cursor-pointer"
                  style={{ backgroundColor: socialButtonBg, border: `1px solid ${cardBorder}` }}
            >
              <svg className="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ color: textColor }}>
                <path d="M16 22.0273V19.1573C16.0375 18.6804 15.9731 18.2011 15.811 17.7511C15.6489 17.3011 15.3929 16.8907 15.06 16.5473C18.2 16.1973 21.5 15.0073 21.5 9.54728C21.4997 8.15111 20.9627 6.80848 20 5.79728C20.4559 4.57579 20.4236 3.22563 19.91 2.02728C19.91 2.02728 18.73 1.67728 16 3.50728C13.708 2.8861 11.292 2.8861 9 3.50728C6.27 1.67728 5.09 2.02728 5.09 2.02728C4.57638 3.22563 4.54414 4.57579 5 5.79728C4.03013 6.81598 3.49252 8.17074 3.5 9.57728C3.5 14.9973 6.8 16.1873 9.94 16.5773C9.611 16.9173 9.35726 17.3227 9.19531 17.7672C9.03335 18.2117 8.96681 18.6853 9 19.1573V22.0273M9 20.0273C6 21.0003 3.5 20.0273 2 17.0273" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
              );
            }
            
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

