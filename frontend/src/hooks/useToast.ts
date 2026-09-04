import { useCallback, useEffect, useRef, useState } from 'react';
import { Toast } from '../types';

const SUCCESS_MS = 4200;
// A failure usually names a cause worth reading, and the user has to decide
// what to do about it — 4.2s is not enough for that.
const ERROR_MS = 7000;

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((t: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), t.variant === 'error' ? ERROR_MS : SUCCESS_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { toast, showToast };
}
