import modes from '../tagger/modeschema.json';
import useRanchState from './useRanchState';

export default function useTaggingMode() {
  const { mode } = useRanchState();
  return modes.find(item => item.type === mode) || modes[0];
}
