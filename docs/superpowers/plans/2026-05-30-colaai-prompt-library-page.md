# ColaAI Prompt Library Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the ColaAI `提示词` view into a richer Rova-style prompt inspiration library with real search, category filtering, pagination, copy, and generate actions.

**Architecture:** Keep the change local to `web/src/app/ColaAI/components/cola-ai-workbench.tsx` and the existing render tests. Add small helper data and state inside `PromptLibrary`; do not introduce backend calls or change prompt-market modal behavior.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind utilities, lucide-react icons, Bun tests with `react-dom/server`.

---

### Task 1: Lock Prompt Library Render Contract

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.test.tsx`

- [ ] **Step 1: Write the failing test**

Add expectations to the existing `renders the prompt discovery library as its own view` test:

```tsx
expect(markup).toContain('data-cola-design="rova-prompt-library"');
expect(markup).toContain('data-cola-control="prompt-search"');
expect(markup).toContain('data-cola-panel="prompt-result-summary"');
expect(markup).toContain('data-cola-action="clear-prompt-filters"');
expect(markup).toContain('data-cola-action="load-more-prompts"');
expect(markup).toContain('data-cola-card="prompt-template"');
expect(markup).toContain('data-cola-action="use-library-prompt"');
expect(markup).toContain('data-cola-action="copy-library-prompt"');
expect(markup).toContain("适合");
expect(markup).toContain("无匹配灵感");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "renders the prompt discovery library as its own view"`

Expected: FAIL because the new data attributes and empty-state copy do not exist yet.

### Task 2: Implement Rova-Style Prompt Library

**Files:**
- Modify: `web/src/app/ColaAI/components/cola-ai-workbench.tsx`

- [ ] **Step 1: Expand prompt card data**

Update `PromptCard` data so each card includes enough gallery metadata:

```ts
type PromptCard = {
  id: string;
  title: string;
  prompt: string;
  author: string;
  tags: string[];
  tone: string;
  ratio: string;
  category: string;
  useCase: string;
};
```

Add at least 12 cards covering poster, product, ui, portrait, fashion, 3d, branding, character, illustration, game, food, and architecture.

- [ ] **Step 2: Add local filter state**

Inside `PromptLibrary`, add:

```ts
const [query, setQuery] = useState("");
const [activeTag, setActiveTag] = useState("all");
const [visiblePage, setVisiblePage] = useState(1);
```

Use `useMemo` to compute `promptLibraryTags`, `filteredPromptCards`, `visiblePromptCards`, and `hasMorePrompts`. Reset `visiblePage` to `1` when `query` or `activeTag` changes.

- [ ] **Step 3: Replace decorative search and tags**

Render a real input:

```tsx
<input
  data-cola-control="prompt-search"
  value={query}
  onChange={(event) => setQuery(event.target.value)}
  placeholder="搜索提示词、风格、作者或元素..."
/>
```

Render chips as buttons with `aria-pressed` and `data-cola-tag`.

- [ ] **Step 4: Render gallery cards and states**

Render each visible card with:

```tsx
<article data-cola-card="prompt-template" data-cola-prompt-id={card.id}>
```

Include title, category, ratio, author, use case, prompt excerpt, tags, `data-cola-action="copy-library-prompt"`, and `data-cola-action="use-library-prompt"`.

Render an empty state that includes `无匹配灵感` and a reset button with `data-cola-action="clear-prompt-filters"`.

Render load-more only when `hasMorePrompts` is true.

- [ ] **Step 5: Run focused test to verify it passes**

Run: `bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx -t "renders the prompt discovery library as its own view"`

Expected: PASS.

### Task 3: Verify Integration

**Files:**
- Verify only.

- [ ] **Step 1: Run component and helper tests**

Run: `bun test src/app/ColaAI/components/cola-ai-workbench.test.tsx src/app/ColaAI/components/prompt-library-state.test.ts`

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Browser verify**

Open `http://localhost:3000/ColaAI/`, navigate to `提示词`, confirm the richer gallery renders, search changes visible cards, a category chip filters cards, load-more reveals more items, and desktop/mobile layouts do not overlap.
