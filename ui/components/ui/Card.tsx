import { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  className = '',
  ...props
}: CardProps) {
  const paddingStyles = {
    none: '',
    sm: 'p-4',
    md: 'p-5',
    lg: 'p-6',
  };

  const variantStyles = {
    default: 'rounded-2xl',
    bordered: 'rounded-2xl border focus-visible:ring-2 focus-visible:ring-offset-2',
    elevated: 'rounded-2xl shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2',
  };

  return (
    <div
      className={`${variantStyles[variant]} ${paddingStyles[padding]} ${className}`}
      style={{
        backgroundColor: 'var(--background-secondary)',
        ...(variant === 'bordered' && { borderColor: 'var(--border)' }),
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-xl font-semibold ${className}`} style={{ color: 'var(--foreground)' }} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = '', ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`text-sm mt-1.5 ${className}`} style={{ color: 'var(--foreground-secondary)' }} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mt-6 ${className}`} {...props}>
      {children}
    </div>
  );
}
