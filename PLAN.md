# Plan: Prevent AI Infinite Loops & Add New Agents to Groups

## Problem 1: AI Infinite Loop

When AI-A sends a message in a group:
1. Message is forwarded to AI-B and AI-C
2. AI-B and AI-C respond
3. Their responses are forwarded to each other
4. Infinite loop ensues

### Solution Options

#### Option A: Don't Forward AI-to-AI Messages (Recommended)
- Only forward messages from **users** to AI members
- AI messages are just displayed in the group chat UI but NOT forwarded to other AIs
- AIs can still "see" messages via the group chat history if needed
- **Pros**: Simple, prevents all loops
- **Cons**: AIs won't see each other's messages in real-time unless explicitly mentioned

#### Option B: @Mention System
- Only forward messages when explicitly @mentioned
- User sends: "@Claude @Gemini please discuss this topic"
- AI replies are NOT forwarded unless they also @mention another AI
- **Pros**: Controlled interaction, allows AI-to-AI when needed
- **Cons**: Already partially implemented but still allows loops

#### Option C: Rate Limiting / Cooldown
- Track last message time per session per group
- Don't forward if AI responded within last N seconds
- **Pros**: Allows some interaction
- **Cons**: Complex, may still cause limited loops

#### Option D: Message Origin Tracking (Recommended Combined with A)
- Add `isGroupForwarded: true` flag to forwarded messages
- Don't sync responses to messages that were already group-forwarded
- **Pros**: Prevents cascade while allowing user-initiated AI interaction
- **Cons**: Requires message metadata tracking

### Recommended Implementation
Combine Option A + D:
1. **Default**: Don't auto-forward AI messages to other AIs
2. **User broadcast**: User messages via `/broadcast` endpoint ARE forwarded to AIs
3. **@Mention**: Only forward to specifically @mentioned AIs
4. Track `isGroupForwarded` to prevent cascade responses

## Problem 2: Add New Agents to Groups

Current limitation: Can only add existing sessions to groups.

### Solution
Add a "Create New Agent" button in AddMemberSheet that:
1. Shows a dialog to select:
   - Agent type (Claude, Gemini, Codex, Grok, etc.)
   - Project/directory to work in
   - Machine to run on
2. Calls `spawnSession` to create new session
3. Automatically adds the new session to the group

### Implementation Steps

1. **Server: Modify `syncEngine.ts`**
   - In `syncAgentMessageToGroups`, check if the message was forwarded from another AI
   - Don't forward AI replies to other AI members (only to SSE for UI)
   - Add `sentFrom: 'group-forward'` marker to distinguish forwarded messages

2. **Server: Add endpoint for spawning agent into group**
   - POST `/groups/:id/spawn-member`
   - Spawn session and add to group in one call

3. **Web: Create `SpawnAgentSheet.tsx`**
   - Machine selector
   - Agent type selector
   - Project/directory selector
   - Spawn and add to group

4. **Web: Update `AddMemberSheet.tsx`**
   - Add "Create New Agent" tab/button
   - Open SpawnAgentSheet on click

## Files to Modify

1. `server/src/sync/syncEngine.ts` - Prevent AI-to-AI forwarding
2. `server/src/web/routes/groups.ts` - Add spawn-member endpoint
3. `web/src/components/GroupChat/AddMemberSheet.tsx` - Add create agent option
4. `web/src/components/GroupChat/SpawnAgentSheet.tsx` - New file for spawning
