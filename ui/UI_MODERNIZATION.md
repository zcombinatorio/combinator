# UI Modernization Guide

## Overview

The Z Combinator UI has been modernized from a VSCode/terminal-style interface to a clean, product-grade design system while maintaining all functionality, routes, and the orange brand color (#EF6400).

## Key Changes

### Layout Transformation

**Before**: VSCode-style editor layout with sidebar, activity bar, line numbers, tab bar, and monospace fonts throughout.

**After**: Modern product layout with:
- Sticky top navigation
- Clean content areas
- Professional footer
- Responsive design
- San-serif typography for readability

### Typography System

**Body Font**: Changed from Monaco/Courier to system sans-serif stack
```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', 'Helvetica Neue', Arial, sans-serif
```

**Type Scale**:
- H1: 2.5rem (40px), bold, tight leading
- H2: 2rem (32px), semi-bold
- H3: 1.5rem (24px), semi-bold
- H4: 1.25rem (20px), semi-bold
- Body: Base size with 1.6 line-height

**Monospace**: Reserved only for inline code elements and technical terms (use `<code>` tag)

### Color System

All colors use CSS variables for theme support:

```css
--background: Light/Dark backgrounds
--foreground: Text colors
--accent: #EF6400 (orange)
--border: Border colors
```

**Light Theme** (default):
- Background: #FFFFFF
- Text: #1A1A1A
- Accent: #EF6400

**Dark Theme**:
- Background: #181818
- Text: #F7FCFE
- Accent: #EF6400

## New Component Library

### Layout Components

#### TopNav
Sticky header with logo, navigation links, theme toggle, and CTA button.

```tsx
import { TopNav } from '@/components/ui/TopNav';

// Automatically includes:
// - Logo and site name
// - Navigation links (Home, FAQ, Decisions, etc.)
// - Theme toggle
// - "Launch Token" CTA or "Portfolio" button (when authenticated)
// - Mobile-responsive menu
```

#### Container
Responsive max-width container with padding.

```tsx
import { Container } from '@/components/ui/Container';

<Container size="lg">  {/* sm | md | lg | xl | full */}
  {children}
</Container>
```

#### Footer
Comprehensive site footer with links, social media, and branding.

```tsx
import { SiteFooter } from '@/components/ui/Footer';

// Automatically includes:
// - Product, Resources, Community link columns
// - Social media icons
// - Copyright and GitHub link
// - $ZC contract address copy button
```

### UI Primitives

#### Button
Versatile button component with variants and sizes.

```tsx
import { Button } from '@/components/ui/Button';

<Button variant="primary" size="lg">
  Launch Token
</Button>

// Variants: primary | secondary | ghost | outline
// Sizes: sm | md | lg
```

**Do's**:
- Use `primary` for main CTAs
- Use `outline` for secondary actions
- Use `ghost` for subtle actions
- Ensure sufficient padding for touch targets

**Don'ts**:
- Don't use multiple primary buttons in the same section
- Don't use buttons for navigation (use Link instead)

#### Card
Container component for grouping related content.

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '@/components/ui/Card';

<Card variant="bordered" padding="md">
  <CardHeader>
    <CardTitle>Why ZC?</CardTitle>
    <CardDescription>User-driven development</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Content here</p>
  </CardContent>
  <CardFooter>
    <Button>Learn More</Button>
  </CardFooter>
</Card>

// Variants: default | bordered | elevated
// Padding: none | sm | md | lg
```

**Use Cases**:
- Feature highlights
- FAQ items
- Project cards
- Information sections

#### Callout
Alert-style component for important information.

```tsx
import { Callout } from '@/components/ui/Callout';

<Callout variant="info" title="Important">
  This is an informational message.
</Callout>

// Variants: info | success | warning | error
```

**Use Cases**:
- Important notices
- Success messages
- Warnings
- Error states

## Page Structure Pattern

All modernized pages follow this structure:

```tsx
import { Container } from '@/components/ui/Container';
import { Card, Button, Callout } from '@/components/ui/...';

export default function Page() {
  return (
    <Container>
      {/* Hero/Header Section */}
      <div className="mb-12">
        <h1>Page Title</h1>
        <p className="text-lg">Subtitle or description</p>
      </div>

      {/* Main Content Sections */}
      <div className="mb-20">
        <h2>Section Title</h2>
        {/* Section content */}
      </div>

      {/* CTA Section */}
      <div className="text-center py-12 rounded-2xl">
        <h2>Call to Action</h2>
        <Button>Primary Action</Button>
      </div>
    </Container>
  );
}
```

## Accessibility Features

### Focus Management
All interactive elements have visible focus states:
```css
*:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### Keyboard Navigation
- All buttons and links are keyboard accessible
- Mobile menu can be toggled with keyboard
- Focus indicators are clearly visible

### Reduced Motion
Respects user's motion preferences:
```css
@media (prefers-reduced-motion: reduce) {
  /* Animations disabled */
}
```

### Color Contrast
- All text meets WCAG AA standards (4.5:1 minimum)
- Interactive elements have clear states
- Theme-aware colors ensure contrast in both modes

## Responsive Design

### Breakpoints
- Mobile: < 640px
- Tablet: 640px - 1024px
- Desktop: > 1024px

### Mobile-First Approach
All components are designed mobile-first and scale up:

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {/* 1 column on mobile, 2 on tablet, 3 on desktop */}
</div>
```

## Migration Guide

### Removing VSCode Elements

**Don't use**:
- Monospace fonts for body text
- `//` comment-style headings
- `>` for bullet points
- Line numbers
- Editor-style gutters
- Terminal-like blocks

**Use instead**:
- Proper semantic headings (H1, H2, H3)
- Standard lists (`<ul>`, `<ol>`)
- Card components for sections
- Clean whitespace and padding

### Typography Migration

**Before**:
```tsx
<p style={{ fontFamily: 'Monaco, Menlo, "Courier New", monospace' }}>
  {'//'}Section title
</p>
```

**After**:
```tsx
<h2 style={{ color: 'var(--foreground)' }}>
  Section Title
</h2>
```

### Color Migration

**Before**:
```tsx
<div className="text-gray-300">Content</div>
```

**After**:
```tsx
<p style={{ color: 'var(--foreground-secondary)' }}>Content</p>
```

## Completed Refactors

- ✅ Landing Page (`app/(vscode)/page.tsx`)
- ✅ FAQ Page (`app/(vscode)/faq/page.tsx`)
- ✅ Layout (`app/(vscode)/layout.tsx`)
- ✅ Core UI Components (Button, Card, Callout, Container)
- ✅ Navigation (TopNav, Footer)
- ✅ Typography System
- ✅ Theme System Integration

## Remaining Work

Pages that still need modernization:
- Decisions Page
- Contributions Page
- Projects Page
- Portfolio Page
- Launch Page (complex form)
- Swap Page (complex form)
- Stake Page (complex form)
- Claim Page

**Pattern to follow**: Use the Landing and FAQ pages as reference for structure, spacing, and component usage.

## Best Practices

### DO ✅

- Use semantic HTML (proper headings, lists, etc.)
- Apply consistent spacing (mb-20 for sections, mb-12 for subsections)
- Use theme-aware CSS variables for colors
- Use Card components for grouped content
- Provide clear focus states
- Use descriptive alt text for images
- Keep line length readable (max-w-prose)

### DON'T ❌

- Use monospace fonts for body content
- Hardcode colors (use CSS variables)
- Create dense text blocks
- Skip heading levels (H1 -> H3)
- Use `//` or `>` for headings/bullets
- Forget mobile responsiveness
- Neglect keyboard navigation

## Testing Checklist

When updating a page:

- [ ] Check light and dark themes
- [ ] Test on mobile, tablet, desktop
- [ ] Verify keyboard navigation
- [ ] Check color contrast
- [ ] Test with screen reader
- [ ] Verify all links work
- [ ] Check button states (hover, focus, active)
- [ ] Ensure proper heading hierarchy
- [ ] Test reduced motion mode

## Support

For questions or issues with the new UI system:
- Review this documentation
- Check example pages (Landing, FAQ)
- Refer to component prop types
- Test in both themes before committing

## Version History

**v2.0.0** - Major UI Modernization
- Replaced VSCode-style layout with modern product design
- Created comprehensive component library
- Improved accessibility and responsiveness
- Enhanced typography system
- Maintained all functionality and routes
