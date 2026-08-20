# TimeDoco Blog & Content Authoring Guide

This guide explains how to write, format, and publish articles for the TimeDoco MDX blog.

---

## 🚀 Quick Start: How to Add a New Blog Post

### Step 1: Create the MDX File
1. Copy the template from `src/blog/templates/post-template.mdx` to `src/blog/your-post-slug.mdx`.
2. Ensure the filename matches your desired URL slug (e.g. `src/blog/time-management-tips.mdx` will be accessible at `/blog/time-management-tips`).

### Step 2: Define Metadata
At the top of your `.mdx` file, define the exported `meta` object:

```tsx
export const meta = {
  title: "Mastering Time Management as a Freelancer",
  date: "2026-09-15",
  tags: ["productivity", "freelancing", "guides"],
  description: "Learn actionable strategies for tracking hours, setting billable rates, and maintaining work-life balance."
};
```

---

## 🎨 Adding Rich Media & Extras in MDX

Because posts use **MDX**, you can seamlessly mix standard Markdown with inline React components, custom Tailwind CSS utility classes, and HTML elements.

### 1. Images
You can embed images using standard Markdown syntax or by importing image files directly:

#### Standard Markdown Image Syntax:
```markdown
![Dashboard screenshot showing weekly summary hours](../assets/screenshot-summary.png)
```

#### Styled JSX Image with Caption:
```jsx
<figure className="my-6 text-center">
  <img
    src="/TimeTag/og-image.png"
    alt="TimeDoco Dashboard"
    className="rounded-panel border border-graphite/20 dark:border-white/20 shadow-md mx-auto"
  />
  <figcaption className="text-xs text-gray-500 mt-2">
    Figure 1: TimeDoco 100% local time tracker dashboard.
  </figcaption>
</figure>
```

---

### 2. YouTube & Video Embeds
Embed YouTube videos responsively using Tailwind's `aspect-video` utility class:

```jsx
<div className="my-8">
  <iframe
    className="w-full aspect-video rounded-panel border border-graphite/20 dark:border-white/20 shadow-md"
    src="https://www.youtube-nocookie.com/embed/YOUR_YOUTUBE_VIDEO_ID"
    title="TimeDoco Feature Walkthrough"
    frameBorder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
    allowFullScreen
  ></iframe>
</div>
```

---

### 3. Callout Boxes & Alert Cards
You can embed inline callout cards using TimeDoco's Instrument Panel design tokens (`signal`, `graphite`, `stone`, `panel`):

#### Pro-Tip / Note Callout:
```jsx
<div className="p-4 my-6 rounded-panel bg-signal/10 border border-signal/30 text-graphite dark:text-stone">
  <strong className="text-signal-dim dark:text-signal">💡 Pro Tip:</strong> All time log calculations in TimeDoco run 100% locally in browser memory and IndexedDB.
</div>
```

#### Warning Callout:
```jsx
<div className="p-4 my-6 rounded-panel bg-rust/10 border border-rust/30 text-graphite dark:text-stone">
  <strong className="text-rust">⚠️ Important:</strong> Back up your data periodically using the JSON export feature in Settings.
</div>
```

---

### 4. Interactive React Components
You can import and render interactive React components inside any blog post!

```tsx
import { SocialLinks } from '../components/SocialLinks';

# Connect With Us

Check out our official social channels:

<div className="p-6 my-6 bg-stone/50 dark:bg-graphite/40 rounded-panel border border-graphite/10 dark:border-white/10 flex justify-center">
  <SocialLinks />
</div>
```

---

### 5. Code Snippets
Format code blocks with language identifiers:

```typescript
const calculateBilling = (hours: number, rate: number) => {
  return hours * rate;
};
```

---

## 🌐 Static Site Shell Generation (SEO & Direct Page Loads)

To ensure search engines crawl full article metadata and GitHub Pages serves direct URL requests (e.g. `https://lukeafullard.github.io/TimeTag/blog/your-post-slug/`) without 404 errors:

1. Create a static shell directory: `blog/your-post-slug/index.html`.
2. Include Open Graph / Twitter meta tags and the React SPA mount script:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="../../favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Post Title — TimeDoco</title>
    <meta name="description" content="Your short article description." />
    <link rel="canonical" href="https://lukeafullard.github.io/TimeTag/blog/your-post-slug/" />
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body class="min-h-screen bg-stone dark:bg-ink text-gray-900 dark:text-gray-100 font-sans antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

3. Add the entry to `vite.config.ts`:

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // ... existing inputs
        blogYourSlug: resolve(import.meta.dirname, 'blog/your-post-slug/index.html'),
      },
    },
  },
});
```

---

## 🧪 Verification & Building

Run the build and test suite to confirm your post compiles cleanly:

```bash
npm run build
npm test
```
