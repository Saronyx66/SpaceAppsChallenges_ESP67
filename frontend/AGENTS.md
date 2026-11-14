# Frontend development

React 19 + TypeScript + Vite 8 + Tailwind CSS v4.
Entry: src/main.tsx; UI: src/App.tsx; styles: src/index.css.
Use Node 22.12+ (22.x) or Node 24+.
Run npm ci, npm run dev, npm run typecheck, and npm run build.
The development server must be started locally; it is not managed by an external platform.
Use Tailwind v4 utilities or existing CSS. Keep CSS imports first and global element defaults in @layer base so utilities can override them.
Preserve the existing typography, responsive layout, map controls, and panel dragging/resizing.
Keep dependencies and their lockfile synchronized.
Do not commit generated output, secrets, large terrain datasets, or external repositories.
