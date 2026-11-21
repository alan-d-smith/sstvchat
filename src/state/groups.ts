// Group chats on the client: the /api/groups calls, and how a server group reads as a chat. The
// group list itself arrives with the friends poll (GET /api/friends → groups).

import { GROUP_ID_RE, MAX_GROUP, MAX_TITLE, MIN_GROUP, asGroup } from '../../api/_groups';
import type { Group } from '../../api/_groups';

export type { Group } from '../../api/_groups';
export { GROUP_ID_RE, MAX_GROUP, MAX_TITLE, MIN_GROUP };

/** A server group id (`g_` + 10 [a-z0-9]), as packets carry it in `chatId`. */
export const isGroupId = (id: string | undefined): id is string => !!id && GROUP_ID_RE.test(id);

/** The `groups` of a poll answer; undefined when the server sent none. */
export function parseGroups(v: unknown): Group[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map(asGroup).filter((g): g is Group => g !== null);
}

/** What a group chat is called: its title, else the other members' names. */
export function groupTitle(g: Pick<Group, 'title' | 'members'>, self: string): string {
  if (g.title) return g.title;
  return g.members.filter((m) => m !== self).join(', ') || 'Group';
}

/** "alan added you to Roomies". */
export const groupAddedText = (by: string, title: string) => `${by || 'Someone'} added you to ${title}`;

export type GroupResult =
  | { ok: true; group: Group | null }
  | { ok: false; status: number; error?: string; names?: string[] };

async function post(body: Record<string, unknown>): Promise<GroupResult> {
  try {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const names = Array.isArray(data?.names) ? data.names.filter((n): n is string => typeof n === 'string') : undefined;
      return { ok: false, status: res.status, error: typeof data?.error === 'string' ? data.error : undefined, names };
    }
    return { ok: true, group: asGroup(data) };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** POST /api/groups create: the group made of `members` and this user. */
export async function createGroupRequest(name: string, token: string, members: string[], title?: string): Promise<GroupResult> {
  const r = await post({ action: 'create', name, token, members, ...(title?.trim() ? { title: title.trim() } : {}) });
  return r.ok && !r.group ? { ok: false, status: 500 } : r;
}

/** POST /api/groups leave. */
export const leaveGroupRequest = (name: string, token: string, id: string) => post({ action: 'leave', name, token, id });

/** POST /api/groups rename ('' clears the title). */
export async function renameGroupRequest(name: string, token: string, id: string, title: string): Promise<GroupResult> {
  const r = await post({ action: 'rename', name, token, id, title: title.trim() });
  return r.ok && !r.group ? { ok: false, status: 500 } : r;
}

/** What to tell the user when a group action fails. */
export function groupErrorText(r: Extract<GroupResult, { ok: false }>): string {
  if (r.status === 404 && r.names?.length) return `No one is called ${r.names.join(', ')}.`;
  switch (r.status) {
    case 0: return 'Couldn’t reach the server. Try again.';
    case 400:
      if (r.error === 'too-few') return `A group needs you and at least ${MIN_GROUP - 1} others.`;
      if (r.error === 'too-many') return `Groups hold up to ${MAX_GROUP} people.`;
      if (r.error === 'invalid-title') return `Group names are up to ${MAX_TITLE} characters.`;
      return 'That didn’t look right. Try again.';
    case 401: return 'This device no longer holds your username.';
    case 404: return 'That group is gone.';
    case 503: return 'Group chats need the server’s database, which isn’t set up.';
    default: return 'Something went wrong. Try again.';
  }
}
