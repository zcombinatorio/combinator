import { ButtonHTMLAttributes, forwardRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
    };

    const variantStyles = {
      primary: 'hover:opacity-90 focus-visible:ring-accent shadow-sm',
      secondary: 'border border-border hover:bg-background-tertiary focus-visible:ring-accent',
      ghost: 'hover:bg-background-tertiary focus-visible:ring-accent',
      outline: 'border-2 border-accent text-accent hover:bg-accent focus-visible:ring-accent',
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className} ${variant === 'primary' ? 'btn-primary' : ''} ${variant === 'outline' ? 'btn-outline-hover' : ''}`}
        disabled={disabled}
        style={{
          ...(variant === 'primary' && {
            backgroundColor: 'var(--accent)'
          }),
          ...(variant === 'secondary' && {
            borderColor: 'var(--border)',
            color: 'var(--foreground)'
          }),
          ...(variant === 'ghost' && {
            color: 'var(--foreground)'
          }),
          ...(variant === 'outline' && {
            borderColor: 'var(--accent)',
            color: 'var(--accent)'
          }),
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
