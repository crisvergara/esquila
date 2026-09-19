import useRanchState, { refreshRanchState } from './useRanchState';

export default function useCounts() {
  const { counts, error } = useRanchState();
  return { counts, error, refreshCounts: refreshRanchState };
}
