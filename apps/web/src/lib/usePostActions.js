import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { deletePost, discussionKeys, editPost, moderatePost, patchPages, removeFromPages, reportPost, votePost, voted } from './discussions.js';
import { errorMessage } from './forms.js';
import { toast } from './toast.js';

const MODERATION_DONE = {
  pinned: (on) => (on ? 'Pinned to the top' : 'Unpinned'),
  locked: (on) => (on ? 'Locked: no new replies' : 'Unlocked'),
  hidden: (on) => (on ? 'Hidden from everyone but its author and the moderators' : 'Shown again'),
  accepted: (on) => (on ? 'Marked as the answer' : 'No longer the answer'),
};

/** A post as the API returns it, or nothing to go on (some answers are empty). */
const asPost = (value) => (value && typeof value === 'object' && 'id' in value ? value : null);

/**
 * What can be done to posts (helpful, edit, delete, report, moderate), for the pages that show
 * them. `cache` says how a change reaches what's on screen: `patch(postId, patch)` and
 * `remove(postId)`; course thread lists are kept in step here too. Each action updates the page
 * at once where it's safe (a vote), or when the server agrees, and says so in a toast. Reporting
 * is once per person and post: the post's `reported` says so.
 */
export function usePostActions({ slug, courseSlug, cache }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);

  const patchEverywhere = (postId, patch) => {
    cache.patch(postId, patch);
    queryClient.setQueriesData({ queryKey: discussionKeys.lists(slug, courseSlug) }, (data) => patchPages(data, postId, patch));
  };

  // After moderating or deleting: what the server works out from it and its answer doesn't carry
  // (a thread's "answered" in the lists, reply and report counts, a deleted post's placeholder) is
  // fetched again, whether or not the live connection brings the change.
  const settle = () => queryClient.invalidateQueries({ queryKey: discussionKeys.course(slug, courseSlug) });

  const run = async (key, task) => {
    setBusy(key);
    try {
      return await task();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const vote = async (item) => {
    const on = !item.voted;
    const before = { voted: item.voted, voteCount: item.voteCount };
    patchEverywhere(item.id, voted(item, on));
    try {
      const result = await votePost(slug, courseSlug, item.id, on);
      if (result && typeof result.voteCount === 'number') patchEverywhere(item.id, { voteCount: result.voteCount, voted: result.voted });
    } catch (error) {
      patchEverywhere(item.id, before);
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  const edit = (item, input) =>
    run(`edit:${item.id}`, async () => {
      const saved = asPost(await editPost(slug, courseSlug, item.id, input));
      patchEverywhere(item.id, saved ?? { ...input, editedAt: new Date().toISOString() });
      toast('Saved');
      return true;
    });

  const remove = (item) =>
    run(`delete:${item.id}`, async () => {
      await deletePost(slug, courseSlug, item.id);
      cache.remove(item.id);
      queryClient.setQueriesData({ queryKey: discussionKeys.lists(slug, courseSlug) }, (data) => removeFromPages(data, item.id));
      settle();
      toast('Deleted');
      return true;
    });

  const moderate = (item, change) =>
    run(`moderate:${item.id}`, async () => {
      const saved = asPost(await moderatePost(slug, courseSlug, item.id, change));
      patchEverywhere(item.id, saved ?? change);
      const [field, on] = Object.entries(change)[0];
      toast(MODERATION_DONE[field](on));
      settle();
      return true;
    });

  const report = (item, input) =>
    run(`report:${item.id}`, async () => {
      try {
        await reportPost(slug, courseSlug, item.id, input);
      } catch (error) {
        // Reported before (on another device, say): that's what they wanted anyway.
        if (error?.status !== 409) throw error;
      }
      patchEverywhere(item.id, { reported: true });
      toast("Reported. The course's moderators will take a look.");
      return true;
    });

  return { busy, vote, edit, remove, moderate, report };
}
