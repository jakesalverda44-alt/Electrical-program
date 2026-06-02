import { useState, useCallback } from 'react';
import { Toast } from '../types';

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const showToast = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 4200);
  }, []);
  return { toast, showToast };
}
