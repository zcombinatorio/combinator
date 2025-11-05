import { HTMLAttributes, ReactNode } from 'react';

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
}

export function Callout({
  children,
  variant = 'info',
  title,
  className = '',
  ...props
}: CalloutProps) {
  const icons = {
    info: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    success: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    error: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  };

  const colors = {
    info: {
      bg: 'rgba(59, 130, 246, 0.1)',
      border: 'rgba(59, 130, 246, 0.3)',
      text: '#3B82F6',
    },
    success: {
      bg: 'rgba(34, 197, 94, 0.1)',
      border: 'rgba(34, 197, 94, 0.3)',
      text: '#22C55E',
    },
    warning: {
      bg: 'rgba(251, 146, 60, 0.1)',
      border: 'rgba(251, 146, 60, 0.3)',
      text: '#FB923C',
    },
    error: {
      bg: 'rgba(239, 68, 68, 0.1)',
      border: 'rgba(239, 68, 68, 0.3)',
      text: '#EF4444',
    },
  };

  return (
    <div
      className={`rounded-lg border p-4 ${className}`}
      style={{
        backgroundColor: colors[variant].bg,
        borderColor: colors[variant].border,
      }}
      {...props}
    >
      <div className="flex gap-3">
        <div style={{ color: colors[variant].text }}>
          {icons[variant]}
        </div>
        <div className="flex-1 space-y-1">
          {title && (
            <h4 className="font-semibold text-sm" style={{ color: colors[variant].text }}>
              {title}
            </h4>
          )}
          <div className="text-sm" style={{ color: 'var(--foreground)' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
