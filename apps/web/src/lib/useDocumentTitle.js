import { useEffect } from 'react';

/** Sets the tab title ("Title · Grand LMS"). */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Grand LMS` : 'Grand LMS';
  }, [title]);
}
