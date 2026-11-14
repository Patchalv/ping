import { useCallback, useEffect, useRef, useState } from 'react';
import type { Resource } from './api-error';

/**
 * Loads a Resource whenever `key` changes, and again on reload(). A load that finishes
 * after the key has moved on is dropped, so a fast click between Channels never shows the
 * wrong one. Keeps the last ready data while reloading, so lists don't flash empty.
 */
export function useResource<T>(
  key: string,
  load: () => Promise<Resource<T>>,
): [Resource<T>, () => void] {
  const [state, setState] = useState<{ key: string; resource: Resource<T> }>({
    key,
    resource: { status: 'loading' },
  });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: version triggers a reload.
  useEffect(() => {
    let current = true;
    void loadRef
      .current()
      .catch((): Resource<T> => ({ status: 'error', message: 'Can’t reach Ping. Try again.' }))
      .then((resource) => {
        if (current) setState({ key, resource });
      });
    return () => {
      current = false;
    };
  }, [key, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return [state.key === key ? state.resource : { status: 'loading' }, reload];
}
