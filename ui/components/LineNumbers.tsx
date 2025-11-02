'use client';

interface LineNumbersProps {
  lineCount: number;
}

export function LineNumbers({ lineCount }: LineNumbersProps) {
  return (
    <div
      style={{
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        fontSize: '13px',
        color: '#858585',
        userSelect: 'none',
        width: '48px',
        flexShrink: 0,
        borderRight: '1px solid #2B2B2B',
        paddingTop: '3px',
        minHeight: 'calc(100vh - 28px - 44px)'
      }}
    >
      {Array.from({ length: lineCount }, (_, i) => (
        <div
          key={i + 1}
          style={{
            paddingTop: '6px',
            paddingBottom: '6px',
            paddingRight: '12px',
            textAlign: 'right',
            lineHeight: '12px'
          }}
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
