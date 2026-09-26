import useRanchState from './useRanchState';

export default function useShearers() {
  const { configuration, loaded } = useRanchState();
  return { shearers: configuration.shearers, loaded };
}
