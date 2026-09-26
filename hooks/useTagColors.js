import useRanchState from './useRanchState';
import { tagColorStyle } from '../shared/ranch-configuration.js';

export default function useTagColors() {
  const { configuration } = useRanchState();
  return count => tagColorStyle(configuration.modes, count.lastTagColor, count.lastTagType);
}
