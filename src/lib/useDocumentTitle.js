import { useEffect } from 'react';

/** Sets the tab title ("Title · FundaStream"). */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · FundaStream` : 'FundaStream';
  }, [title]);
}
