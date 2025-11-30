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

import { useTheme } from '@/contexts/ThemeContext';

export default function LaunchPage() {
  const { theme } = useTheme();
  const textColor = theme === 'dark' ? '#ffffff' : '#0a0a0a';

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] px-[20px]">
      <p
        className="text-[18px] leading-[1.5] text-center"
        style={{ fontFamily: 'Inter, sans-serif', color: textColor }}
      >
        Please reach out to @handsdiff on X or Telegram to discuss launching
      </p>
    </div>
  );
}
