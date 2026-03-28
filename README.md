# abt-aniqbintlutpi

`abt-aniqbintlutpi` is a React component that turns an uploaded image into a soft blur-gradient background and lets users download the final styled image.

## Install

### npm
```bash
npm install abt-aniqbintlutpi
```

### pnpm
```bash
pnpm add abt-aniqbintlutpi
```

### yarn
```bash
yarn add abt-aniqbintlutpi
```

### bun
```bash
bun add abt-aniqbintlutpi
```

## Usage

```tsx
"use client";

import { ImageGradientUpload } from "abt-aniqbintlutpi";

export default function Page() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#efece3]">
      <ImageGradientUpload />
    </main>
  );
}
```

## Props

- `className?: string`
- `title?: string`
- `description?: string`

## Styling Note

This component uses Tailwind utility classes. For best results, use it in a project with Tailwind CSS configured.

## Publish (Maintainer)

1. Login to npm:
```bash
npm login
```

2. Build package:
```bash
npm run build:package
```

3. Publish:
```bash
npm publish --access public
```

## Local Development

Run demo app:
```bash
npm run dev
```

Build Next.js app:
```bash
npm run build
```
