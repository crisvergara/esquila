import TaggingApp from "./TaggingApp";
import MonitorApp from "./MonitorApp";
import BulkLambApp from "./BulkLambApp";

const App = () => {
  if (window.location.hash === "#monitor") {
    return <MonitorApp />;
  } else if (window.location.hash === "#bulk") {
    return <BulkLambApp />;
  }
  return <TaggingApp />;
};

export default App;
