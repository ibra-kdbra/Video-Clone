import { useQuery } from '@tanstack/react-query';

import { discussionKeys, getReports } from './discussions.js';

/** Open reports, for a course's moderators: the count on the Discussion tab, and the reports page's list. */
export function useOpenReports(slug, courseSlug, enabled) {
  return useQuery({
    queryKey: discussionKeys.reports(slug, courseSlug),
    queryFn: ({ signal }) => getReports(slug, courseSlug, signal),
    enabled,
    staleTime: 60_000,
    refetchInterval: enabled ? 5 * 60_000 : false,
  });
}
