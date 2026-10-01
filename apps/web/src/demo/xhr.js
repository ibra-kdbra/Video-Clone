import { server } from './server.js';

/**
 * The demo's stand-in for the XMLHttpRequest that sends a handed-in file to storage (see
 * uploadSubmissionFile in lib/assignments.js): the "upload" keeps the file in this tab's memory,
 * with progress events along the way, so the panel behaves as it does for real. After a reload the
 * file's name and size remain, but not the file itself.
 */
export function createDemoRequest() {
  let url = '';
  let timers = [];
  const clear = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const request = {
    status: 0,
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    ontimeout: null,
    onabort: null,
    open(_method, address) {
      url = String(address);
    },
    setRequestHeader() {},
    getResponseHeader: (name) => (name.toLowerCase() === 'etag' ? '"demo"' : null),
    send(body) {
      const fileId = url.replace(/^demo-upload:/, '');
      const size = body?.size ?? 0;
      // A few steps of progress, quicker for small files.
      const steps = 6;
      const total = Math.min(1600, 300 + size / 20_000);
      for (let step = 1; step <= steps; step++) {
        timers.push(
          setTimeout(
            () => {
              request.upload.onprogress?.({ loaded: Math.round((size * step) / steps), total: size, lengthComputable: true });
              if (step === steps) {
                server.files.put(fileId, body);
                request.status = 200;
                request.onload?.();
              }
            },
            (total * step) / steps,
          ),
        );
      }
    },
    abort() {
      clear();
      request.onabort?.();
    },
  };
  return request;
}
