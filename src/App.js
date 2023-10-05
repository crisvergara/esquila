import TaggingApp from "./TaggingApp";
import MonitorApp from "./MonitorApp";

const App = () => {
  if (window.location.hash === "#monitor") {
    return <MonitorApp />;
  }
  return <TaggingApp />;
};

export default App;
