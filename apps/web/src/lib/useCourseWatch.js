import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { discussionKeys } from './discussions.js';
import { useLiveSocket } from './live.js';
import { holdRoom } from './socketRooms.js';

/**
 * Follows a course's discussions over the real-time connection while a course page is open
 * (`course:watch`, for its editors and enrolled students): when `discussion:changed` says a thread
 * or a lesson's comments changed, what's cached of them is refreshed (the open ones refetch). It
 * watches again after a reconnection, refreshing everything once, since changes sent while the
 * connection was down are lost. `onChange(event)` hears each change too.
 */
export function useCourseWatch({ slug, courseSlug, courseId, enabled = true, onChange }) {
  const socket = useLiveSocket();
  const queryClient = useQueryClient();
  const handler = useRef(onChange);
  useEffect(() => {
    handler.current = onChange;
  });

  useEffect(() => {
    if (!socket || !enabled || !courseId) return undefined;
    const room = holdRoom(socket, `course:${courseId}`);
    let active = true;
    let watchedBefore = false;

    const watch = () =>
      room.ready().then(() => {
        if (!active || !socket.connected) return;
        socket.emit('course:watch', { courseId }, (ack) => {
          if (!active || !ack?.ok) return;
          if (watchedBefore) queryClient.invalidateQueries({ queryKey: discussionKeys.course(slug, courseSlug) });
          watchedBefore = true;
        });
      });

    const onChanged = (event) => {
      if (!event || event.courseId !== courseId) return;
      const refresh = (queryKey) => queryClient.invalidateQueries({ queryKey });
      refresh(discussionKeys.thread(slug, courseSlug, event.threadId));
      if (event.postId !== event.threadId) refresh(discussionKeys.thread(slug, courseSlug, event.postId));
      refresh(event.lessonId ? discussionKeys.lessonComments(slug, courseSlug, event.lessonId) : discussionKeys.lists(slug, courseSlug));
      refresh(discussionKeys.reports(slug, courseSlug));
      handler.current?.(event);
    };

    watch();
    socket.on('connect', watch);
    socket.on('discussion:changed', onChanged);
    return () => {
      active = false;
      socket.off('connect', watch);
      socket.off('discussion:changed', onChanged);
      room.release((done) => socket.emit('course:unwatch', { courseId }, done));
    };
  }, [socket, enabled, courseId, slug, courseSlug, queryClient]);
}
