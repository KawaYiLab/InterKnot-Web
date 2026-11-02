let postModalHandler: (() => void) | null = null;

export function dispatchPostModalPopState() {
  postModalHandler?.();
}

export function registerPostModalPopState(handler: () => void) {
  postModalHandler = handler;
  return () => {
    if (postModalHandler === handler) postModalHandler = null;
  };
}
