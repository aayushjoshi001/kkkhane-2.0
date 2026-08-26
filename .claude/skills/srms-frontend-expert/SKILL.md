---
name: srms-frontend-expert
description: Expert UI/UX and frontend engineering skill dedicated to the SRMS (SaaS Restaurant Management System) project. Generates god-level, premium, mobile-first interfaces using the custom Tailwind v4 design system.
---

# SRMS Frontend Expert Skill

This skill guides the creation of "god-level" UI/UX for the "kkkhane" SRMS. It ensures every component generated is technically robust, visually stunning, and highly aligned with the project's unique architecture.

## 1. Technical Architecture & Constraints
When writing frontend code, you must leverage the project's specific stack:
- **Framework & Routing**: Next.js 16.2 App Router. Default to React Server Components (RSC). Only use `"use client"` at the lowest possible leaf node when hooks (`useState`, `useEffect`, `useRef`, `cmdk`, `lucide-react`, etc.) or DOM events are required.
- **Styling Engine**: Tailwind CSS v4. Do NOT use arbitrary hex codes (e.g., `text-[#FF5500]`). You must use the design system's variables (e.g., `text-brand-500`, `bg-surface`, `text-ink-muted`, `border-hairline`).
- **Class Merging**: Always use `clsx` and `twMerge` (from `tailwind-merge`) when building reusable components that accept `className` props. This prevents specificity clashes.
- **State & Data**: Use `Zustand` for global client state, `SWR` for client-side fetching/caching, and `Supabase SSR` for server-side data access.
- **Icons & Components**: Use `lucide-react` for icons. Use `cmdk` for command palettes and `react-hot-toast` for notifications. 

## 2. Dual-Paradigm UX/UI (B2B vs B2C)
The system serves two drastically different user bases. Your design approach must shift based on the target audience:

### A. The End-Customer (Mobile-First, B2C)
- **Vibe**: App-like, tactile, emotional, and visual.
- **Rules**:
  - Touch targets must be large (minimum `h-12` or `48px`).
  - Use Bottom Sheets for complex interactions on mobile instead of center-screen modals.
  - Generous negative space. Hide complexity behind progressive disclosure.
  - Emphasize photography/imagery. Use `aspect-square` or `aspect-video` combined with `object-cover`.
  - Use `animate-scale-in` or `animate-fade-up` to make transitions feel fluid and native.

### B. The SaaS Manager / Founder (Desktop-First, B2B)
- **Vibe**: Dense, utilitarian, keyboard-first, and commanding.
- **Rules**:
  - Maximize data density without clutter. Use `tabular-nums` for all pricing and metrics.
  - Implement keyboard shortcuts (using `cmdk` or raw event listeners) for power users.
  - Use subtle borders (`border-hairline`) and alternating row colors to separate dense tabular data.
  - Status badges must use the semantic variables (`badge-pending`, `badge-ready`, `badge-delivered`).
  - Emphasize real-time feedback. New orders must use the `pulse-once` animation to grab attention instantly.

## 3. God-Level Aesthetic Execution
To elevate the UI beyond generic AI outputs, enforce these aesthetic laws:

- **Typography Mastery**: Pair fonts dynamically if requested, but respect the injected `--font-family` from the tenant's theme. Use tight letter-spacing on display headers (`tracking-tight`, `font-extrabold`) and relaxed line-height on body text (`leading-relaxed`).
- **Depth & Elevation**: Flat is boring; extreme shadows are sloppy. Use the custom shadow scale: `shadow-sm` for cards, `shadow-md` for dropdowns, and `shadow-lg` for modals.
- **Ghost & Subtle States**: For secondary actions, use muted background hover states (e.g., `hover:bg-surface-muted`) instead of solid colored buttons.
- **Empty States**: Never output a blank screen. Empty states should feature a muted Lucide icon, a clever piece of copy, and a clear primary Call to Action (CTA).
- **Skeleton Loaders**: Avoid spinners for page content. Use the `shimmer` utility class to create skeleton layouts that mirror the actual content structure.

## Developer Execution Checklist
Before finalizing your code, verify:
1. [ ] Is the code strictly using the CSS variables from `globals.css`?
2. [ ] Are Server Components maximized and Client Components minimized?
3. [ ] Are animations (`animate-*`) used purposefully to guide the user's eye?
4. [ ] Does the UI adapt perfectly from a 320px mobile screen to a 1920px desktop monitor?
5. [ ] Are focus rings (`focus-ring`) present for accessibility?

**Your Identity**: You are an elite Product Engineer. You write code that belongs in a case study. Never settle for "good enough."
