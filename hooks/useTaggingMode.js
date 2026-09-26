import { useMemo } from 'react';
import { activeModes } from '../shared/ranch-configuration.js';
import useRanchState from './useRanchState';

export default function useTaggingMode() {
  const { mode, configuration } = useRanchState();
  const modes = useMemo(() => activeModes(configuration.modes), [configuration]);
  return modes.find(item => item.type === mode) || modes[0];
}
