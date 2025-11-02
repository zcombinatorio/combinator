'use client';

import { useState } from 'react';

export function FileExplorer({ className }: { className?: string }) {
  const [isFileHovered, setIsFileHovered] = useState(false);

  return (
    <div
      className={`flex-1 overflow-y-auto ${className || ''}`}
      style={{
        backgroundColor: '#181818',
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        fontSize: '13px'
      }}
    >
      {/* Explorer Header */}
      <div className="px-3 py-2 text-xs text-gray-400 font-semibold tracking-wider">
        EXPLORER
      </div>

      {/* File Tree */}
      <div className="px-2">
        {/* Project Folder - Expanded */}
        <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
          <div className="flex items-center py-1 cursor-pointer" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
            <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
              <path d="M6 4L10 8L6 12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
            </svg>
            <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
              <path d="M1 2H6L7 3H15V14H1V2Z" fill="#C5C5C5"/>
            </svg>
            <span className="text-white">z-combinator</span>
          </div>
        </a>

        {/* Nested Files */}
        <div>
          {/* app folder */}
          <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
            <div className="flex items-center py-1 cursor-pointer pl-4" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M6 4L10 8L6 12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
              </svg>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M1 2H6L7 3H15V14H1V2Z" fill="#C5C5C5"/>
              </svg>
              <span className="text-white">app</span>
            </div>
          </a>

          {/* Files inside app */}
          <div>
            <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
              <div className="flex items-center py-1 cursor-pointer pl-9" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
                <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                  <rect x="3" y="2" width="10" height="12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
                  <line x1="5" y1="5" x2="11" y2="5" stroke="#C5C5C5"/>
                  <line x1="5" y1="8" x2="11" y2="8" stroke="#C5C5C5"/>
                  <line x1="5" y1="11" x2="9" y2="11" stroke="#C5C5C5"/>
                </svg>
                <span className="text-gray-300">page.tsx</span>
              </div>
            </a>
            <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
              <div className="flex items-center py-1 cursor-pointer pl-9" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
                <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                  <rect x="3" y="2" width="10" height="12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
                  <line x1="5" y1="5" x2="11" y2="5" stroke="#C5C5C5"/>
                  <line x1="5" y1="8" x2="11" y2="8" stroke="#C5C5C5"/>
                  <line x1="5" y1="11" x2="9" y2="11" stroke="#C5C5C5"/>
                </svg>
                <span className="text-gray-300">layout.tsx</span>
              </div>
            </a>
            <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
              <div className="flex items-center py-1 cursor-pointer pl-9" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
                <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                  <rect x="3" y="2" width="10" height="12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
                  <line x1="5" y1="5" x2="11" y2="5" stroke="#C5C5C5"/>
                  <line x1="5" y1="8" x2="11" y2="8" stroke="#C5C5C5"/>
                  <line x1="5" y1="11" x2="9" y2="11" stroke="#C5C5C5"/>
                </svg>
                <span className="text-gray-300">globals.css</span>
              </div>
            </a>
          </div>

          {/* components folder */}
          <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
            <div className="flex items-center py-1 cursor-pointer pl-4 mt-1" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M6 4L10 8L6 12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
              </svg>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M1 2H6L7 3H15V14H1V2Z" fill="#C5C5C5"/>
              </svg>
              <span className="text-white">components</span>
            </div>
          </a>

          {/* public folder */}
          <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
            <div className="flex items-center py-1 cursor-pointer pl-4 mt-1" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M6 4L10 8L6 12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
              </svg>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <path d="M1 2H6L7 3H15V14H1V2Z" fill="#C5C5C5"/>
              </svg>
              <span className="text-white">public</span>
            </div>
          </a>

          {/* package.json */}
          <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
            <div className="flex items-center py-1 cursor-pointer pl-4 mt-1" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <rect x="3" y="2" width="10" height="12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
                <line x1="5" y1="5" x2="11" y2="5" stroke="#C5C5C5"/>
                <line x1="5" y1="8" x2="11" y2="8" stroke="#C5C5C5"/>
                <line x1="5" y1="11" x2="9" y2="11" stroke="#C5C5C5"/>
              </svg>
              <span className="text-gray-300">package.json</span>
            </div>
          </a>

          {/* README.md */}
          <a href="https://github.com/zcombinatorio/zcombinator" target="_blank" rel="noopener noreferrer" className="block">
            <div className="flex items-center py-1 cursor-pointer pl-4" style={{ transition: 'background-color 0.1s' }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#474748'; setIsFileHovered(true); }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; setIsFileHovered(false); }}>
              <svg width="16" height="16" viewBox="0 0 16 16" className="mr-1">
                <rect x="3" y="2" width="10" height="12" stroke="#C5C5C5" strokeWidth="1" fill="none"/>
                <line x1="5" y1="5" x2="11" y2="5" stroke="#C5C5C5"/>
                <line x1="5" y1="8" x2="11" y2="8" stroke="#C5C5C5"/>
                <line x1="5" y1="11" x2="9" y2="11" stroke="#C5C5C5"/>
              </svg>
              <span className="text-gray-300">README.md</span>
            </div>
          </a>
        </div>
      </div>

      {/* Hover Info Box */}
      {isFileHovered && (
        <div
          className="absolute text-white"
          style={{
            backgroundColor: '#474748',
            left: '48px',
            right: '8px',
            bottom: '36px',
            fontSize: '13px',
            lineHeight: '1.4',
            padding: '12px 8px 12px 8px'
          }}
        >
          Z Combinator is open source! Click and submit a good quality PR to earn $ZC.
        </div>
      )}
    </div>
  );
}
