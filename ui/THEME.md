# Theme System Documentation

## Overview

The Z Combinator UI now features a modern dual-theme system supporting both light and dark modes. The default theme is light mode, with an easy-to-use toggle for switching between themes.

## Color Scheme

### Accent Color

The primary accent color has been updated from blue to orange:
- **Previous**: `#b2e9fe` (light blue)
- **Current**: `#EF6400` (rgb(239, 100, 0) - vibrant orange)

### Light Theme (Default)

```css
--background: #FFFFFF
--background-secondary: #F5F5F5
--background-tertiary: #E5E5E5
--foreground: #1A1A1A
--foreground-secondary: #666666
--border: #E0E0E0
--border-secondary: #D0D0D0
--accent: #EF6400
--accent-hover: #D55700
--accent-light: #FF8533
```

### Dark Theme

```css
--background: #181818
--background-secondary: #1F1F1F
--background-tertiary: #2B2B2B
--foreground: #F7FCFE
--foreground-secondary: #B0B0B0
--border: #2B2B2B
--border-secondary: #3A3A3A
--accent: #EF6400
--accent-hover: #FF7519
--accent-light: #FF8533
```

## Theme Toggle

The theme toggle button is located at the bottom of the Activity Bar (left sidebar). It displays:
- 🌙 Moon icon when in light mode (click to switch to dark)
- ☀️ Sun icon when in dark mode (click to switch to light)

## Implementation

### Theme Context

The theme system is powered by a React Context (`ThemeContext`) that:
- Manages the current theme state (light/dark)
- Persists the user's preference in localStorage
- Provides a `toggleTheme()` function for switching themes
- Sets the `data-theme` attribute on the document root

### Using Theme Colors in Components

Components should use CSS variables to respect the current theme:

```tsx
// Good - Theme-aware
<div style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}>
  Content
</div>

// Avoid - Hardcoded colors
<div style={{ backgroundColor: '#181818', color: '#F7FCFE' }}>
  Content
</div>
```

### Available CSS Variables

All theme colors are available as CSS variables:

- `var(--background)` - Primary background color
- `var(--background-secondary)` - Secondary background (slightly different shade)
- `var(--background-tertiary)` - Tertiary background (borders, dividers)
- `var(--foreground)` - Primary text color
- `var(--foreground-secondary)` - Secondary text color (muted)
- `var(--border)` - Primary border color
- `var(--border-secondary)` - Secondary border color
- `var(--accent)` - Accent color (orange)
- `var(--accent-hover)` - Accent color for hover states
- `var(--accent-light)` - Lighter accent color variant

### Using the Theme Hook

```tsx
import { useTheme } from '@/contexts/ThemeContext';

function MyComponent() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <p>Current theme: {theme}</p>
      <button onClick={toggleTheme}>Toggle Theme</button>
    </div>
  );
}
```

## Tailwind Classes

The following Tailwind utility classes are theme-aware:

- `.bg-black` - Uses `var(--background-secondary)`
- `.text-white` - Uses `var(--foreground)`
- `.text-accent` - Uses `var(--accent)`
- `.bg-accent` - Uses `var(--accent)`
- `.border-accent` - Uses `var(--accent)`
- `.hover:bg-accent:hover` - Uses `var(--accent-hover)`
- `.hover:text-accent:hover` - Uses `var(--accent-hover)`

## Smooth Transitions

The body element includes smooth transitions for theme changes:

```css
body {
  transition: background-color 0.3s ease, color 0.3s ease;
}
```

This ensures a pleasant visual experience when switching between light and dark modes.

## Browser Compatibility

The theme system:
- Uses modern CSS variables (supported in all modern browsers)
- Falls back gracefully in older browsers
- Persists user preference across sessions using localStorage
- Respects the user's system preference on first visit (defaults to light)

## Future Enhancements

Potential improvements to the theme system:
- System preference detection (prefers-color-scheme media query)
- Additional theme variants (e.g., high contrast, colorblind modes)
- Per-component theme overrides
- Custom theme builder for users
