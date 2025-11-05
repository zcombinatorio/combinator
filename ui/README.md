This is the Z Combinator UI - a modern, product-grade interface built with [Next.js](https://nextjs.org).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/(vscode)/page.tsx`. The page auto-updates as you edit the file.

## Features

- **Modern Product Design**: Clean, professional interface with card-based layouts and proper typography
- **Dual Theme System**: Seamless light and dark mode with toggle in top navigation
- **Orange Accent Color**: Vibrant orange (`#EF6400`) brand color used throughout
- **Responsive Layout**: Mobile-first design that scales beautifully across all devices
- **Accessibility First**: WCAG AA compliant with full keyboard navigation and screen reader support
- **Component Library**: Reusable UI components (Button, Card, Callout, Container)
- **Tailwind CSS v4**: Latest Tailwind CSS for modern styling

## UI System

The application features a modern component-based design system. See documentation:

- **[UI_MODERNIZATION.md](./UI_MODERNIZATION.md)**: Complete modernization guide
  - Overview of changes from VSCode-style to product design
  - Component usage patterns
  - Migration guide
  - Best practices

- **[COMPONENTS.md](./COMPONENTS.md)**: Detailed component documentation
  - Props and usage for each component
  - Code examples
  - Layout patterns
  - Accessibility notes

- **[THEME.md](./THEME.md)**: Theme system documentation
  - Light and dark color schemes
  - CSS variable usage
  - Implementation details

## Theme System

**Default Theme**: Light mode
**Theme Toggle**: Located in the top navigation bar (next to login/portfolio button)

Light and dark themes with:
- Proper contrast ratios (WCAG AA)
- Smooth transitions
- Persistent user preference
- CSS variable-based system

## Color Scheme

- **White/Light Gray**: Light theme backgrounds
- **Dark Gray/Black**: Dark theme backgrounds
- **Orange** (`#EF6400`): Primary accent color for:
  - Buttons and CTAs
  - Links and interactive elements
  - Focus indicators
  - Brand highlights

## Component Library

Core UI components in `/components/ui/`:

- **Button**: Primary, secondary, ghost, and outline variants
- **Card**: Content containers with headers, descriptions, and footers
- **Callout**: Info, success, warning, and error notifications
- **Container**: Responsive max-width wrappers
- **TopNav**: Sticky navigation header
- **SiteFooter**: Comprehensive site footer

See [COMPONENTS.md](./COMPONENTS.md) for detailed usage.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
