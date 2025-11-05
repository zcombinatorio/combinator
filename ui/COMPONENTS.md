# Component Library Documentation

## UI Components (`/components/ui/`)

### Button

A versatile button component with multiple variants and sizes.

#### Props

```typescript
interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  disabled?: boolean;
  // ...extends HTMLButtonElement attributes
}
```

#### Usage

```tsx
import { Button } from '@/components/ui/Button';

// Primary button (orange background)
<Button variant="primary" size="lg">
  Launch Token
</Button>

// Outline button (orange border, transparent background)
<Button variant="outline">
  Learn More
</Button>

// Secondary button (border, theme-aware)
<Button variant="secondary" size="sm">
  Cancel
</Button>

// Ghost button (minimal, no border)
<Button variant="ghost">
  Dismiss
</Button>
```

#### Accessibility

- Automatically includes focus-visible styles
- Disabled state reduces opacity and prevents interaction
- Proper cursor states (pointer, not-allowed)

---

### Card

Container component for grouped content with optional borders and elevation.

#### Props

```typescript
interface CardProps {
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  // ...extends HTMLDivElement attributes
}
```

#### Sub-components

- `CardHeader` - Top section for title and description
- `CardTitle` - Heading within card header
- `CardDescription` - Subtitle/description text
- `CardContent` - Main content area
- `CardFooter` - Bottom section for actions

#### Usage

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '@/components/ui/Card';

// Full card structure
<Card variant="bordered" padding="md">
  <CardHeader>
    <CardTitle>Feature Title</CardTitle>
    <CardDescription>
      A brief description of this feature
    </CardDescription>
  </CardHeader>
  <CardContent>
    <p>Main content goes here</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>

// Minimal card
<Card>
  <CardTitle>Quick Info</CardTitle>
  <p>Some information</p>
</Card>
```

#### Variants

- **default**: Basic rounded card with background
- **bordered**: Card with visible border
- **elevated**: Card with shadow for depth

---

### Callout

Alert-style component for important messages and notifications.

#### Props

```typescript
interface CalloutProps {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  className?: string;
  // ...extends HTMLDivElement attributes
}
```

#### Usage

```tsx
import { Callout } from '@/components/ui/Callout';

// Informational callout
<Callout variant="info" title="Note">
  This feature is currently in beta.
</Callout>

// Success message
<Callout variant="success" title="Success!">
  Your token has been launched successfully.
</Callout>

// Warning
<Callout variant="warning">
  Please ensure you have sufficient SOL for gas fees.
</Callout>

// Error
<Callout variant="error" title="Error">
  Transaction failed. Please try again.
</Callout>
```

#### Colors

- **info**: Blue tones
- **success**: Green tones
- **warning**: Orange tones
- **error**: Red tones

Each variant has appropriate icon, background, and border colors.

---

### Container

Responsive max-width container with consistent padding.

#### Props

```typescript
interface ContainerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
  // ...extends HTMLDivElement attributes
}
```

#### Usage

```tsx
import { Container } from '@/components/ui/Container';

// Default large container (max-w-5xl)
<Container>
  {children}
</Container>

// Extra large for wide layouts
<Container size="xl">
  {children}
</Container>

// Small for focused content
<Container size="sm">
  {children}
</Container>
```

#### Sizes

- **sm**: max-w-3xl (768px)
- **md**: max-w-4xl (896px)
- **lg**: max-w-5xl (1024px) - default
- **xl**: max-w-7xl (1280px)
- **full**: max-w-full (no limit)

---

### TopNav

Sticky navigation header with logo, links, theme toggle, and CTA.

#### Usage

```tsx
import { TopNav } from '@/components/ui/TopNav';

// No props needed - automatically configured
<TopNav />
```

#### Features

- Logo with site name
- Navigation links (Home, FAQ, Decisions, Contributions, Projects)
- Theme toggle button
- Dynamic CTA:
  - "Launch Token" button (when not authenticated)
  - "Portfolio" button (when authenticated)
- Mobile-responsive hamburger menu
- Active link indication

#### Customization

To modify navigation links, edit the `NAV_LINKS` array in `TopNav.tsx`:

```typescript
const NAV_LINKS = [
  { name: 'Home', href: '/' },
  { name: 'FAQ', href: '/faq' },
  // Add more links here
];
```

---

### SiteFooter

Comprehensive footer with links, social media, and branding.

#### Usage

```tsx
import { SiteFooter } from '@/components/ui/Footer';

// No props needed - automatically configured
<SiteFooter />
```

#### Features

- Multi-column link sections:
  - Product (Home, Launch, Projects, Swap, Stake)
  - Resources (FAQ, Decisions, Contributions, Docs)
  - Community (Discord, Twitter, GitHub)
- Social media icons
- $ZC contract address with copy button
- Copyright and open source notice
- Responsive layout (stacks on mobile)

#### Customization

To modify footer links, edit the `FOOTER_LINKS` object in `Footer.tsx`:

```typescript
const FOOTER_LINKS = {
  Product: [
    { name: 'Home', href: '/' },
    // Add more links
  ],
  // Add more categories
};
```

---

## Layout Pattern

Standard page layout using the modern components:

```tsx
import { Container } from '@/components/ui/Container';
import { Card, Button, Callout } from '@/components/ui/...';

export default function ModernPage() {
  return (
    <Container>
      {/* Hero Section */}
      <div className="text-center mb-20">
        <h1 style={{ color: 'var(--foreground)' }}>
          Page Title
        </h1>
        <p className="text-xl" style={{ color: 'var(--foreground-secondary)' }}>
          Subtitle
        </p>
        <div className="flex gap-4 justify-center mt-8">
          <Button variant="primary" size="lg">
            Primary Action
          </Button>
          <Button variant="outline" size="lg">
            Secondary Action
          </Button>
        </div>
      </div>

      {/* Content Section */}
      <div className="mb-20">
        <h2 style={{ color: 'var(--foreground)' }}>Section Title</h2>
        <p style={{ color: 'var(--foreground-secondary)' }}>
          Section description
        </p>

        <div className="grid md:grid-cols-2 gap-6 mt-8">
          <Card variant="bordered">
            <CardHeader>
              <CardTitle>Feature</CardTitle>
              <CardDescription>Description</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      {/* Callout Section */}
      <Callout variant="info" title="Important">
        Key information for users
      </Callout>

      {/* CTA Section */}
      <div className="text-center py-12 rounded-2xl mt-20"
           style={{ backgroundColor: 'var(--background-secondary)' }}>
        <h2>Final Call to Action</h2>
        <Button variant="primary" size="lg">
          Get Started
        </Button>
      </div>
    </Container>
  );
}
```

## Spacing Guidelines

Use consistent spacing for visual hierarchy:

- **Section spacing**: `mb-20` (5rem / 80px)
- **Subsection spacing**: `mb-12` (3rem / 48px)
- **Element spacing**: `mb-8` (2rem / 32px)
- **Paragraph spacing**: `mb-4` (1rem / 16px)
- **Card grids**: `gap-6` (1.5rem / 24px)

## Color Usage

Always use CSS variables for theme-awareness:

```tsx
// Text colors
<h1 style={{ color: 'var(--foreground)' }}>Primary text</h1>
<p style={{ color: 'var(--foreground-secondary)' }}>Secondary text</p>

// Backgrounds
<div style={{ backgroundColor: 'var(--background)' }}>Main background</div>
<div style={{ backgroundColor: 'var(--background-secondary)' }}>Card background</div>

// Borders
<div style={{ borderColor: 'var(--border)' }}>Border</div>

// Accent (orange)
<span style={{ color: 'var(--accent)' }}>Highlighted text</span>
```

## Responsive Utilities

Common responsive classes:

```tsx
// Responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

// Responsive text size
<h1 className="text-4xl md:text-6xl">

// Responsive visibility
<div className="hidden md:block">Desktop only</div>
<div className="md:hidden">Mobile only</div>

// Responsive flex direction
<div className="flex flex-col sm:flex-row gap-4">
```

## Theme Integration

All components automatically support light/dark themes through CSS variables. No additional configuration needed.

To access theme programmatically:

```tsx
import { useTheme } from '@/contexts/ThemeContext';

function MyComponent() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <p>Current theme: {theme}</p>
      <button onClick={toggleTheme}>Toggle</button>
    </div>
  );
}
```

## Accessibility Notes

All components follow accessibility best practices:

- Semantic HTML elements
- Proper ARIA labels
- Keyboard navigation support
- Focus-visible indicators
- Color contrast compliance (WCAG AA)
- Reduced motion support

## Examples

See these pages for real-world usage:
- Landing Page: `app/(vscode)/page.tsx`
- FAQ Page: `app/(vscode)/faq/page.tsx`
