# ColaAI Prompt Library Page Design

## Goal

Improve the standalone ColaAI prompt page at `/ColaAI` when the user selects `提示词`. The page should feel closer to Rova's browsable prompt inspiration surface while staying inside the existing ColaAI workbench and generation flow.

## Scope

- Only change the ColaAI standalone prompt library view.
- Keep the Studio prompt market modal unchanged.
- Do not change backend prompt-template APIs.
- Preserve the existing side navigation, mobile navigation, copy behavior, and `去生成` behavior.

## Direction

Use a Rova-like inspiration gallery:

- Expand the built-in prompt set from a tiny static sample into a richer curated gallery.
- Make the search box a real controlled input.
- Let category chips filter cards.
- Show visible result counts and active filter context.
- Make `加载更多灵感` reveal more cards instead of being decorative.
- Provide an empty state with a clear reset action.

## Page Structure

The page keeps a light, airy ColaAI visual language with a focused content width and existing sidebar offset.

Top section:

- Eyebrow: curated prompt library.
- H1: direct discovery message.
- Supporting copy: tells users they can browse, copy, or generate.
- Stats: total curated prompts, visible results, category count.

Controls:

- Search input with real typing and a clear button when active.
- Horizontal category chips with selected state.
- Compact result summary showing active query/tag.

Gallery:

- Responsive card grid.
- Each card has a visual preview block, title, author, category, ratio, prompt excerpt, tags, copy action, and primary generate action.
- Cards should remain stable in height and spacing across desktop and mobile.

States:

- Empty state appears when no card matches the current search/filter.
- Load-more button appears only when hidden matching cards remain.

## Interaction

- Typing filters by title, prompt text, author, and tags.
- Category selection filters by exact tag; selecting `精选` clears tag filtering.
- Search and tag filters combine.
- Changing search or tag resets pagination to the first page.
- `复制提示词` calls the existing copy handler.
- `去生成` calls the existing use-prompt handler and keeps the rest of the workbench behavior unchanged.

## Testing

Add focused static render tests for:

- Prompt page renders the richer Rova-style gallery shell.
- Search input, category chips, result summary, and load-more controls exist.
- Cards expose copy and generate actions with stable data attributes.
- Empty-state copy and reset action are present in the component markup path.

Manual verification:

- Open `http://localhost:3000/ColaAI/`.
- Navigate to `提示词`.
- Check desktop layout and mobile width.
- Type a search, choose a tag, clear filters, load more, copy prompt, and use a prompt.
