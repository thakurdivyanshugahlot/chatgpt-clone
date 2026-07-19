# ChatGPT — ChatGPT Clone

A ChatGPT-style AI chat app built with Next.js, Clerk auth, Prisma/Postgres, and the Vercel AI SDK (Gemini). Supports streaming responses, web search, and per-message conversation branching (fork a chat from any earlier point without losing the original thread).

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Auth | Clerk |
| Database | Postgres via Prisma 7 (`@prisma/adapter-pg`) |
| AI | Vercel AI SDK (`ai`, `@ai-sdk/react`) + Gemini (`@ai-sdk/google`) |
| Data fetching | TanStack Query |
| UI | shadcn/ui, Tailwind CSS 4, `streamdown` for markdown rendering |

## Getting started

### 1. Install dependencies

```bash
npm install
# or bun install — the repo has a bun.lock
```

### 2. Environment variables

Create `.env` in the project root (loaded automatically via `prisma.config.ts` → `dotenv/config`, and by Next.js itself):

```bash
# Postgres connection string (e.g. Neon, Supabase, local Postgres)
DATABASE_URL="postgresql://..."

# Clerk — from your Clerk dashboard
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_..."
CLERK_SECRET_KEY="sk_..."

# Gemini — from Google AI Studio
GOOGLE_GENERATIVE_AI_API_KEY="..."


#TAVILY API Key
TAVILY_API_KEY=
```

If you're using the (currently unpushed, local-only) web search tool, add whatever key it requires alongside these.

### 3. Database

```bash
npx prisma generate
npx prisma migrate dev
```

### 4. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to Clerk sign-in for any route except `/sign-in`.

---

## Auth (Clerk)

**Route protection** happens in `proxy.ts` (Next's middleware) via `clerkMiddleware`. Every route except `/sign-in(.*)` requires a session — `auth.protect()` runs for everything else, including all API routes.

**User sync**: Clerk owns identity, but the app keeps its own `User` row (for FK relations to `Conversation`, etc.). The flow:

1. `app/(root)/layout.tsx` — the authenticated layout — calls `auth.protect()` then `onBoard()` on every request.
2. `features/auth/action/onboard.ts` — `onBoard()` reads the current Clerk user and **upserts** a matching `User` row keyed on `clerkId`, syncing email/name/avatar on every load. This means editing your name/photo in Clerk reflects in the app on next page load, no webhook needed.
3. `features/auth/action/require-user.ts` — `requireUser()` is what every server action actually calls. It runs `auth.protect()`, looks up the local `User` by `clerkId`, and throws if onboarding hasn't happened yet. This is the guard used everywhere data is read or written — conversations, messages, and branches are always scoped to `requireUser()`'s result, never to a raw Clerk ID.

```
Request → proxy.ts (session required) → layout.tsx (auth.protect + onBoard)
                                              → server action (requireUser) → Prisma, scoped to local User.id
```

---

## Data model

```
User
 └─ Conversation (title, model override, systemPrompt, pin/archive, activeBranchId)
     ├─ Branch (name, isMain, leafMessageId)
     └─ Message (role, content, parts, parentId → tree structure)
```

Full schema: `prisma/schema.prisma`.

---

## Phase 1 — Conversations & streaming chat

- **`features/conversation/actions/conversation-actions.ts`** — CRUD for conversations (`listConversations`, `createConversation`, `updateConversation` for rename/pin/archive, `deleteConversation`), all scoped via `requireUser()` + an `assertOwnsConversation` ownership check.
- **`features/home/actions/start-new-chat.ts`** — `startNewChat()` creates a bare `Conversation` and returns its id; `app/(root)/page.tsx` calls this and redirects to `/c/{id}`.
- **`app/api/chat/route.ts`** — the streaming endpoint. Receives `{ id, message }`, loads prior history, streams a response from Gemini via `streamText`, and persists both the user's message and the streamed assistant reply.
- **`features/ai/actions/chat-store.ts`** — the actual message read/write layer used by the API route (`loadChatMessages`, `saveChatMessages`). This is the real data path for chat — not `features/messages/*`, which is unused legacy code left over from before branching existed and isn't on the live call path.
- **`features/ai/utils/model.ts`** — model selection. `getChatModel(modelId?)` returns a Gemini model instance, falling back to `DEFAULT_CHAT_MODEL` (`gemini-flash-latest`) if a conversation has no per-thread override. Using the `-latest` alias instead of a pinned snapshot avoids the chat breaking every time Google deprecates a specific model id.
- **Web search** — wired into `route.ts` as a tool (`webSearchTool`) with `stopWhen: stepCountIs(5)` to allow multi-step search-then-answer turns. Tool-call parts are stored as part of the assistant message's `parts` JSON, same as plain text.

---

## Phase 2 — Chat branching

Lets you fork a conversation from any earlier message and continue independently, without duplicating or losing the original thread.

**Core idea:** messages form a tree (`Message.parentId`), and a `Branch` is a lightweight named pointer at a leaf message. Two branches sharing history just point through the same ancestor messages — nothing is copied on fork.

```
msg1 → msg2 → msg3          ("main" branch leaf)
         └──→ msg3b → msg4b  ("explore-alt" branch leaf, forked from msg2)
```

### Backend

- **`chat-store.ts`** (extended) — `loadChatMessages(conversationId, branchId?)` walks a branch's leaf back to the root (one query for the whole conversation, then an in-memory walk — not one query per message). `saveChatMessages` chains new messages via `parentId` starting from the branch's current leaf, and advances `Branch.leafMessageId`. `getOrCreateMainBranch` / `resolveActiveBranch` lazily backfill a `main` branch for conversations created before branching existed.
- **`features/conversation/actions/branch-actions.ts`** — `listBranches`, `createBranch` (fork + auto-switch), `switchBranch`, `renameBranch`, `deleteBranch` (removes the `Branch` pointer only — **never** the underlying `Message` rows, since they may be shared ancestors of other branches; refuses to delete `main`; falls back `activeBranchId` to `main` if the deleted branch was active).
- **`app/api/chat/route.ts`** (extended) — accepts `branchId` in the request body; reads/writes against that specific branch instead of the whole flat conversation.

### Frontend

- **`features/conversation/hooks/use-branches.ts`** — React Query hooks for the actions above. Branch-switching mutations call `router.refresh()`, since the conversation page resolves the active branch server-side — a client-only DB write isn't enough on its own.
- **`features/conversation/components/branch-switcher.tsx`** — header dropdown (switch / rename / delete). Hides itself while a conversation only has `main`.
- **`features/conversation/components/chat-messages.tsx`** — hover any message to reveal a "Branch from here" button.
- **`features/conversation/components/conversation-view.tsx`** — `useChat` is keyed by `` `${conversationId}:${branchId}` `` so switching branches remounts chat state cleanly instead of showing stale streaming state from the previous branch.

### Schema additions

```prisma
model Message {
  // ...
  parentId       String?
  parent         Message?  @relation("MessageTree", fields: [parentId], references: [id], onDelete: Restrict)
  children       Message[] @relation("MessageTree")
  branchesAtLeaf Branch[]  @relation("BranchLeaf")
}

model Branch {
  id             String   @id @default(cuid())
  conversationId String
  name           String   @default("main")
  isMain         Boolean  @default(false)
  leafMessageId  String?
  leafMessage    Message? @relation("BranchLeaf", fields: [leafMessageId], references: [id], onDelete: SetNull)
  @@unique([conversationId, name])
}

model Conversation {
  // ...
  activeBranchId String?
  branches       Branch[]
}
```

`Message.parentId` uses `onDelete: Restrict` rather than `SetNull` — deleting a message with children would otherwise silently orphan them into fake root messages and break the tree. There's no message-deletion UI today, so this is a safety net rather than an active constraint.

Full details, setup, and a manual test checklist: [`docs/BRANCHING.md`](./docs/BRANCHING.md).

---

## Project structure

```
app/
  (auth)/sign-in/        Clerk sign-in page
  (root)/                 Authenticated shell: layout does auth.protect() + onBoard()
    page.tsx               "New chat" → creates conversation, redirects to /c/{id}
    c/[id]/page.tsx         Conversation page: resolves active branch, loads its history
  api/chat/route.ts       Streaming chat endpoint (branch-aware)

features/
  auth/                   Clerk session + local User sync
  home/                   New-chat creation
  conversation/
    actions/               conversation-actions.ts, branch-actions.ts
    hooks/                  use-conversation.ts, use-branches.ts
    components/             ChatShell, ConversationView, ChatMessages, BranchSwitcher, ...
  ai/
    actions/chat-store.ts  Branch-aware message load/save — the real chat data path
    utils/model.ts         Gemini model selection
  messages/               ⚠️ legacy/unused — predates branching, not on the live call path

prisma/
  schema.prisma
  migrations/

docs/
  BRANCHING.md            Phase 2 deep-dive + test checklist
```

## Known gaps / follow-ups

- `features/messages/*` is dead code and should eventually be deleted.
- No visual branch-tree view — the switcher is a flat dropdown list, fine for a handful of branches but won't scale indefinitely.
- No webhook-based Clerk sync — user data updates only on next page load (via `onBoard()`), not instantly.
- No message editing/regeneration UI yet (the tree model supports it — a "regenerate" is just "create a sibling message with the same parent" — but no UI calls this today).
