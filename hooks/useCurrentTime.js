const useCurrentTime = () => {
  const [currentTime, setCurrentTime] = useState(
    new Date().toLocaleString().split(" ")[1]
  );
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleString().split(" ")[1]);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  return currentTime;
};

export default useCurrentTime;
