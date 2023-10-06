import TaggingApp from "./TaggingApp";
import MonitorApp from "./MonitorApp";
import BulkLambApp from "./BulkLambApp";
import RamApp from "./RamApp";

const App = () => {
  if (window.location.hash === "#monitor") {
    return <MonitorApp />;
  } else if (window.location.hash === "#bulk") {
    return <BulkLambApp />;
  } else if (window.location.hash === "#ram") {
    return <RamApp />;
  }
  return <TaggingApp />;
};

export default App;
