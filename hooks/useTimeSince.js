const timeSinceISO = (isoString) => {
  if (!isoString) return "00:00:00";
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const elapsed = now - then;
  const hours = Math.floor(elapsed / 1000 / 60 / 60);
  const minutes = Math.floor(elapsed / 1000 / 60) % 60;
  const seconds = Math.floor(elapsed / 1000) % 60;

  const hoursString = "00".slice(hours.toString().length) + hours;
  const minutesString = "00".slice(minutes.toString().length) + minutes;
  const secondsString = "00".slice(seconds.toString().length) + seconds;
  return `${hoursString}:${minutesString}:${secondsString}`;
};

const useTimeSince = (isoString) => {
  const [timeSince, setTimeSince] = useState("00:00:00");
  useEffect(() => {
    setTimeSince(timeSinceISO(isoString));
    const interval = setInterval(() => {
      setTimeSince(timeSinceISO(isoString));
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [isoString]);
  return timeSince;
};

export default useTimeSince;
