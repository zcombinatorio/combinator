'use client';

import { ThemeToggle } from './ThemeToggle';

export function ActivityBar() {
  return (
    <div
      className="flex flex-col items-center justify-between pt-2 pb-2"
      style={{
        width: '40px',
        backgroundColor: '#0E0E0E',
        flexShrink: 0
      }}
    >
      <div className="flex flex-col items-center">
      {/* Files Icon - Active */}
      <div className="relative mb-2">
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-white"></div>
        <div className="w-10 h-10 flex items-center justify-center opacity-100">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14.5 2H7L5.5 0.5H1.5C0.948 0.5 0.5 0.948 0.5 1.5V14.5C0.5 15.052 0.948 15.5 1.5 15.5H14.5C15.052 15.5 15.5 15.052 15.5 14.5V3.5C15.5 2.948 15.052 2.5 14.5 2.5V2Z" fill="#C5C5C5"/>
          </svg>
        </div>
      </div>

      {/* Search Icon */}
      <div className="w-10 h-10 flex items-center justify-center opacity-40 mb-2">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11.5 6.5C11.5 9.26142 9.26142 11.5 6.5 11.5C3.73858 11.5 1.5 9.26142 1.5 6.5C1.5 3.73858 3.73858 1.5 6.5 1.5C9.26142 1.5 11.5 3.73858 11.5 6.5ZM10.5 11.5L14.5 15.5" stroke="#C5C5C5" strokeWidth="1"/>
        </svg>
      </div>

      {/* Source Control Icon */}
      <div className="w-10 h-10 flex items-center justify-center opacity-40 mb-2">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="3" cy="3" r="2" stroke="#C5C5C5" strokeWidth="1"/>
          <circle cx="13" cy="8" r="2" stroke="#C5C5C5" strokeWidth="1"/>
          <circle cx="3" cy="13" r="2" stroke="#C5C5C5" strokeWidth="1"/>
          <path d="M5 3H8C9 3 11 4 11 6V8M5 13H8C9 13 11 12 11 10V8" stroke="#C5C5C5" strokeWidth="1"/>
        </svg>
      </div>

      {/* Debug Icon */}
      <div className="w-10 h-10 flex items-center justify-center opacity-40 mb-2">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 1L4 5L8 9L12 5L8 1Z" stroke="#C5C5C5" strokeWidth="1"/>
          <path d="M4 11L8 15L12 11" stroke="#C5C5C5" strokeWidth="1"/>
        </svg>
      </div>

      {/* Extensions Icon */}
      <div className="w-10 h-10 flex items-center justify-center opacity-40">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="6" height="6" stroke="#C5C5C5" strokeWidth="1"/>
          <rect x="9" y="1" width="6" height="6" stroke="#C5C5C5" strokeWidth="1"/>
          <rect x="1" y="9" width="6" height="6" stroke="#C5C5C5" strokeWidth="1"/>
          <rect x="9" y="9" width="6" height="6" fill="#C5C5C5"/>
        </svg>
      </div>
      </div>

      {/* Theme Toggle at Bottom */}
      <div className="w-10 flex items-center justify-center">
        <ThemeToggle />
      </div>
    </div>
  );
}
